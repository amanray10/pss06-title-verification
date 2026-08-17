"""
PSS06 - Symbolic rule engine.

This is the deterministic half of the neuro-symbolic system. It consumes the
neural evidence (semantic + reranker scores) plus the corpus indices, and
produces:

  * a list of Findings, each with a rule code, severity, human-readable
    message and the exact evidence that triggered it
  * a final decision: ACCEPT / REVIEW / REJECT
  * a verification probability

The LLM never gets to change any of this. It only reads the findings and
writes the covering letter. That is what makes the outcome reproducible: the
same title against the same registry always yields the same decision.

Rule catalogue
--------------
R01 EXACT_DUPLICATE             blocker   requirement 1
R02 DISALLOWED_WORD             blocker   requirement 3.a / 3.b
R03 TITLE_TOO_SHORT             major     sanity
R04 INVALID_CHARACTERS          minor     sanity
R05 SPELLING_VARIANT            blocker   requirement 1.c
R06 PHONETIC_COLLISION          major     requirement 1.a
R07 DISALLOWED_AFFIX            major     requirement 2.a / 2.b
R08 PERIODICITY_VARIANT         blocker   requirement 3.e
R09 TITLE_COMBINATION           blocker   requirement 3.c
R10 CROSS_LANGUAGE_EQUIVALENT   major     requirement 3.d
R11 CORE_TITLE_COLLISION        major     requirement 1.b
R12 HIGH_SIMILARITY             blocker   requirement 1.d
R13 MODERATE_SIMILARITY         major     requirement 1.d
R14 PENDING_APPLICATION_CONFLICT major    requirement 5.b
R15 SENSITIVE_WORD              minor     policy
R16 NONSENSE_TITLE              major     requirement 1.b / sanity
R17 OFFENSIVE_LANGUAGE          blocker   policy
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import config
from preprocessing.normalizer import NormalizedTitle, normalize_title
from retrieval.corpus import TitleCorpus
from retrieval.retriever import Candidate
from rules.lexicons import (
    DISALLOWED_AFFIXES,
    DISALLOWED_WORDS,
    FLAGGED_WORDS,
    GENERIC_PREFIXES,
    GENERIC_SUFFIXES,
    PERIODICITY_WORDS,
)

from rules.nonsense_detector import title_is_meaningless
from better_profanity import profanity
profanity.load_censor_words()

log = logging.getLogger("pss06.rules")

BLOCKER = "BLOCKER"
MAJOR = "MAJOR"
MINOR = "MINOR"
INFO = "INFO"

ACCEPT = "ACCEPT"
REVIEW = "REVIEW"
REJECT = "REJECT"


@dataclass
class Finding:
    """One rule that fired, with the evidence that fired it."""

    code: str
    rule: str
    severity: str
    message: str
    requirement: str = ""
    evidence: Dict[str, Any] = field(default_factory=dict)
    penalty: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "rule": self.rule,
            "severity": self.severity,
            "message": self.message,
            "requirement": self.requirement,
            "evidence": self.evidence,
            "penalty": round(self.penalty, 3),
        }


@dataclass
class RuleOutcome:
    decision: str
    findings: List[Finding]
    similarity: float                 # 0-1, the top combined similarity
    probability: float                # 0-1, likelihood of verification
    top_match: Optional[Candidate] = None
    checks_passed: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision": self.decision,
            "similarityScore": round(self.similarity * 100, 1),
            "verificationProbability": round(self.probability * 100, 1),
            "findings": [f.to_dict() for f in self.findings],
            "checksPassed": self.checks_passed,
        }


class RuleEngine:
    """Deterministic guideline enforcement over neural evidence."""

    def __init__(self, corpus: TitleCorpus):
        self.corpus = corpus
        self.t = config.THRESHOLDS
        self.penalties = config.RULE_PENALTIES

    # =====================================================================
    # Public entry point
    # =====================================================================
    def evaluate(self, norm: NormalizedTitle,
                 candidates: List[Candidate]) -> RuleOutcome:
        findings: List[Finding] = []
        passed: List[str] = []

        top = candidates[0] if candidates else None
        similarity = top.combined if top else 0.0

        # --- content guidelines (independent of the registry) ------------
        self._check_disallowed_words(norm, findings, passed)
        self._check_sensitive_words(norm, findings, passed)
        self._check_offensive_language(norm, findings, passed)
        self._check_structure(norm, findings, passed)
        self._check_nonsense_title(norm, findings, passed)

        # --- registry collision rules ------------------------------------
        self._check_exact_duplicate(norm, findings, passed)
        self._check_spelling_variant(norm, candidates, findings, passed)
        self._check_phonetic_collision(norm, candidates, findings, passed)
        self._check_affix_abuse(norm, findings, passed)
        self._check_periodicity_variant(norm, findings, passed)
        self._check_title_combination(norm, findings, passed)
        self._check_cross_language(norm, candidates, findings, passed)
        self._check_core_collision(norm, candidates, findings, passed)
        self._check_pending_conflict(candidates, findings, passed)

        # --- similarity thresholds ---------------------------------------
        self._check_similarity(similarity, top, findings, passed)

        decision = self._decide(findings, similarity)
        probability = self._probability(similarity, findings, decision)

        return RuleOutcome(
            decision=decision,
            findings=findings,
            similarity=similarity,
            probability=probability,
            top_match=top,
            checks_passed=passed,
        )

    # =====================================================================
    # R02 / R15 - disallowed and sensitive vocabulary
    # =====================================================================
    def _check_disallowed_words(self, norm, findings, passed):
        hits = sorted({t for t in norm.tokens if t in DISALLOWED_WORDS})
        # also catch them inside the raw string for scripts we do not tokenise
        lowered = norm.raw.lower()
        for word in DISALLOWED_WORDS:
            if len(word) > 3 and word in lowered and word not in hits:
                hits.append(word)

        if hits:
            findings.append(Finding(
                code="R02",
                rule="DISALLOWED_WORD",
                severity=BLOCKER,
                requirement="3.a / 3.b",
                message=(
                    "The title contains word(s) that PRGI guidelines prohibit "
                    f"in publication titles: {', '.join(sorted(set(hits))).upper()}."
                ),
                evidence={"words": sorted(set(hits))},
                penalty=self.penalties["DISALLOWED_WORD"],
            ))
        else:
            passed.append("No prohibited words (Police / Crime / CBI / Army ...)")

    def _check_sensitive_words(self, norm, findings, passed):
        hits = sorted({t for t in norm.tokens if t in FLAGGED_WORDS})
        if hits:
            findings.append(Finding(
                code="R15",
                rule="SENSITIVE_WORD",
                severity=MINOR,
                requirement="policy",
                message=(
                    "The title uses word(s) that imply official or governmental "
                    f"authority ({', '.join(hits).upper()}). Supporting "
                    "authorisation may be required."
                ),
                evidence={"words": hits},
                penalty=0.05 * len(hits),
            ))

    # =====================================================================
    # R03 / R04 - structural sanity
    # =====================================================================
    def _check_structure(self, norm, findings, passed):
        if len(norm.normalized.replace(" ", "")) < 3 or not norm.tokens:
            findings.append(Finding(
                code="R03",
                rule="TITLE_TOO_SHORT",
                severity=MAJOR,
                requirement="sanity",
                message="The title is too short or carries no distinctive word.",
                evidence={"normalized": norm.normalized},
                penalty=self.penalties["TITLE_TOO_SHORT"],
            ))
            return

        # Everything the applicant supplied is a generic word.
        distinctive = [
            t for t in norm.tokens
            if t not in GENERIC_PREFIXES and t not in GENERIC_SUFFIXES
            and t not in PERIODICITY_WORDS
        ]
        if not distinctive:
            findings.append(Finding(
                code="R03",
                rule="TITLE_TOO_SHORT",
                severity=MAJOR,
                requirement="1.b / sanity",
                message=(
                    "Every word in the title is a generic registry term "
                    "(e.g. The, India, News, Samachar, Daily). The title has "
                    "no distinctive element of its own."
                ),
                evidence={"tokens": norm.tokens},
                penalty=self.penalties["TITLE_TOO_SHORT"],
            ))
        else:
            passed.append("Title contains at least one distinctive word")

        if any(ch.isdigit() for ch in norm.normalized) and len(norm.tokens) <= 1:
            findings.append(Finding(
                code="R04",
                rule="INVALID_CHARACTERS",
                severity=MINOR,
                requirement="sanity",
                message="The title is numeric or near-numeric.",
                evidence={"normalized": norm.normalized},
                penalty=self.penalties["INVALID_CHARACTERS"],
            ))
    # =====================================================================
    # R16 - title carries no meaning at all (gibberish / keyboard mash)
    # =====================================================================
    def _check_nonsense_title(self, norm, findings, passed):
        model = getattr(self.corpus, "ngram_model", None)
        if model is None:
            # Model not built yet - skip rather than false-positive on
            # every title.
            return

        distinctive = [
            t for t in norm.tokens
            if t not in GENERIC_PREFIXES and t not in GENERIC_SUFFIXES
            and t not in PERIODICITY_WORDS
        ]
        if not distinctive:
            return  # R03 already handles "no distinctive word at all"

        is_meaningless, detail = title_is_meaningless(
            distinctive, model, self.t["nonsense_perplexity"]
        )

        if is_meaningless:
            findings.append(Finding(
                code="R16",
                rule="NONSENSE_TITLE",
                severity=MAJOR,
                requirement="1.b / sanity",
                message=(
                    "The title does not correspond to a recognisable word in "
                    "any language on record and does not follow the letter "
                    "patterns of a real word or name. A title must carry "
                    "some meaning or be a plausible coined name."
                ),
                evidence={
                    "tokens": distinctive,
                    "scores": {tok: round(score, 3) for tok, score in detail},
                    "threshold": self.t["nonsense_perplexity"],
                },
                penalty=self.penalties["NONSENSE_TITLE"],
            ))
        else:
            passed.append("Title tokens are recognisable words or plausible names")

    # =====================================================================
    # R17 - profane / abusive language
    # =====================================================================
    def _check_offensive_language(self, norm, findings, passed):
        if profanity.contains_profanity(norm.raw):
            findings.append(Finding(
                code="R17",
                rule="OFFENSIVE_LANGUAGE",
                severity=BLOCKER,
                requirement="policy",
                message=(
                    "The title contains profane or abusive language, which "
                    "is not permitted in a publication title regardless of "
                    "context."
                ),
                evidence={"raw": norm.raw},
                penalty=self.penalties["OFFENSIVE_LANGUAGE"],
            ))
        else:
            passed.append("No profane or abusive language detected")

    # =====================================================================
    # R01 - exact duplicate
    # =====================================================================
    def _check_exact_duplicate(self, norm, findings, passed):
        ids = self.corpus.exact_matches(norm)
        if ids:
            rec = self.corpus.get(ids[0])
            findings.append(Finding(
                code="R01",
                rule="EXACT_DUPLICATE",
                severity=BLOCKER,
                requirement="1",
                message=(
                    f'The title is already on the register as "{rec.title}" '
                    f"({rec.registration_number or 'no reg. no.'}"
                    f"{', ' + rec.publication_state if rec.publication_state else ''})."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "registrationNumber": rec.registration_number,
                    "publisher": rec.publisher,
                    "source": rec.source,
                },
                penalty=self.penalties["EXACT_DUPLICATE"],
            ))
        else:
            passed.append("No exact duplicate in the registry")

    # =====================================================================
    # R05 - spelling / transliteration variant  (Namaskar vs Namascar)
    # =====================================================================
    def _comparable(self, norm, rec, min_fuzzy: float) -> bool:
        """
        Gate shared by the phonetic and spelling rules.

        Both rules work on the *core* of a title, and a core match alone is not
        enough: "Amar" and "Aamir" collapse to the same skeleton, but
        "Dainik Bharat Ka Amar Samachar" and "Aamir Express" are plainly
        different titles. So we also require the full titles to look alike.
        """
        from rules.phonetics import fuzzy_similarity

        return (
            rec.norm.normalized != norm.normalized
            and rec.norm.core != norm.core
            and abs(len(rec.norm.core_tokens) - len(norm.core_tokens)) <= 1
            and norm.has_distinctive_core
            and rec.norm.has_distinctive_core
            and fuzzy_similarity(norm.normalized, rec.norm.normalized) >= min_fuzzy
        )

    def _check_spelling_variant(self, norm, candidates, findings, passed):
        from rules.phonetics import fuzzy_similarity

        hits = []

        # (a) identical transliteration skeleton - Namaskar / Namascar
        for rid in self.corpus.collapsed_matches(norm):
            rec = self.corpus.get(rid)
            if self._comparable(norm, rec, 0.75):
                hits.append(rec)

        # (b) near-identical literal strings the skeleton index missed
        for cand in candidates:
            rec = cand.record
            if (rec not in hits and self._comparable(norm, rec, 0.94)
                    and fuzzy_similarity(norm.normalized,
                                         rec.norm.normalized) >= 0.94):
                hits.append(rec)

        if hits:
            rec = hits[0]
            findings.append(Finding(
                code="R05",
                rule="SPELLING_VARIANT",
                severity=BLOCKER,
                requirement="1.c",
                message=(
                    f'The title is only a spelling variation of the registered '
                    f'title "{rec.title}". Changing the spelling of a word does '
                    "not make a title distinct."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "registrationNumber": rec.registration_number,
                    "proposedSkeleton": norm.collapsed,
                    "existingSkeleton": rec.norm.collapsed,
                    "otherVariants": [r.title for r in hits[1:4]],
                },
                penalty=self.penalties["PHONETIC_COLLISION"],
            ))
        else:
            passed.append("Not a spelling variation of an existing title")

    # =====================================================================
    # R06 - phonetic collision  (Soundex / Metaphone)
    # =====================================================================
    def _check_phonetic_collision(self, norm, candidates, findings, passed):
        # "Sounds like" only means something when the words are actually
        # written differently. Identical cores are handled by R07/R08/R11.
        def is_homophone(rec) -> bool:
            return self._comparable(norm, rec, 0.65)

        same_sound = [
            c for c in candidates
            if c.phonetic >= self.t["phonetic"] and is_homophone(c.record)
        ]
        bucket = [self.corpus.get(r) for r in self.corpus.phonetic_matches(norm)
                  if is_homophone(self.corpus.get(r))]

        if same_sound or bucket:
            rec = same_sound[0].record if same_sound else bucket[0]
            score = same_sound[0].phonetic if same_sound else 1.0
            findings.append(Finding(
                code="R06",
                rule="PHONETIC_COLLISION",
                severity=MAJOR,
                requirement="1.a",
                message=(
                    f'The title sounds the same as the registered title '
                    f'"{rec.title}" (phonetic agreement '
                    f"{round(score * 100)}%). Similar-sounding titles cause "
                    "reader confusion and are not accepted."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "phoneticScore": round(score, 3),
                    "proposedMetaphone": norm.phonetic_key,
                    "existingMetaphone": rec.norm.phonetic_key,
                },
                penalty=self.penalties["PHONETIC_COLLISION"],
            ))
        else:
            passed.append("No similar-sounding registered title (Soundex/Metaphone)")

    # =====================================================================
    # R07 - manufacturing a title by bolting on a generic affix
    # =====================================================================
    def _check_affix_abuse(self, norm, findings, passed):
        if not (norm.stripped_prefixes or norm.stripped_suffixes):
            passed.append("No disallowed prefix/suffix added to an existing title")
            return

        base_ids = self.corpus.token_string_matches(norm.core_tokens)
        added = [a for a in (norm.stripped_prefixes + norm.stripped_suffixes)
                 if a in DISALLOWED_AFFIXES]

        if base_ids and added:
            rec = self.corpus.get(base_ids[0])
            findings.append(Finding(
                code="R07",
                rule="DISALLOWED_AFFIX",
                severity=MAJOR,
                requirement="2.a / 2.b",
                message=(
                    f'The title is the registered title "{rec.title}" with the '
                    f"generic word(s) {', '.join(a.upper() for a in added)} "
                    "attached. Adding a common prefix or suffix does not create "
                    "a distinct title."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "registrationNumber": rec.registration_number,
                    "addedPrefixes": norm.stripped_prefixes,
                    "addedSuffixes": norm.stripped_suffixes,
                    "disallowedAffixes": added,
                },
                penalty=self.penalties["DISALLOWED_AFFIX"] + 0.35,
            ))
        elif base_ids:
            rec = self.corpus.get(base_ids[0])
            findings.append(Finding(
                code="R07",
                rule="DISALLOWED_AFFIX",
                severity=MAJOR,
                requirement="2.b",
                message=(
                    f'After removing generic registry words, the title reduces '
                    f'to the registered title "{rec.title}".'
                ),
                evidence={
                    "existingTitle": rec.title,
                    "core": norm.core,
                    "addedPrefixes": norm.stripped_prefixes,
                    "addedSuffixes": norm.stripped_suffixes,
                },
                penalty=self.penalties["DISALLOWED_AFFIX"],
            ))
        else:
            passed.append("No disallowed prefix/suffix added to an existing title")

    # =====================================================================
    # R08 - periodicity added to an existing title
    # =====================================================================
    def _check_periodicity_variant(self, norm, findings, passed):
        if not norm.periodicity_tokens:
            passed.append("No periodicity word appended to an existing title")
            return

        remainder = [t for t in norm.tokens if t not in PERIODICITY_WORDS]
        if not remainder:
            passed.append("No periodicity word appended to an existing title")
            return

        base_ids = self.corpus.token_string_matches(remainder)
        if not base_ids:
            # also try after removing generic affixes from the remainder
            from preprocessing.normalizer import strip_generic_affixes
            core_rem, _, _ = strip_generic_affixes(remainder)
            base_ids = self.corpus.token_string_matches(core_rem)

        if base_ids:
            rec = self.corpus.get(base_ids[0])
            findings.append(Finding(
                code="R08",
                rule="PERIODICITY_VARIANT",
                severity=BLOCKER,
                requirement="3.e",
                message=(
                    f'The title is the registered title "{rec.title}" with the '
                    f"periodicity word(s) "
                    f"{', '.join(p.upper() for p in norm.periodicity_tokens)} "
                    "added. Periodicity cannot be used to create a new title."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "registrationNumber": rec.registration_number,
                    "periodicityWords": norm.periodicity_tokens,
                    "baseTitleTokens": remainder,
                },
                penalty=self.penalties["PERIODICITY_VARIANT"],
            ))
        else:
            passed.append("No periodicity word appended to an existing title")

    # =====================================================================
    # R09 - combining two existing titles
    # =====================================================================
    def _check_title_combination(self, norm, findings, passed):
        tokens = norm.tokens
        n = len(tokens)
        if n < 2:
            passed.append("Not a combination of existing registered titles")
            return

        # Find every contiguous span that is itself a registered title.
        spans = []
        for length in range(n, 0, -1):
            for start in range(0, n - length + 1):
                span = tokens[start:start + length]
                if len(span) == n:
                    continue                     # that's the whole title
                ids = self.corpus.token_string_matches(span)
                if ids:
                    spans.append((start, start + length, span, ids[0]))

        # Greedily claim the longest non-overlapping spans.
        spans.sort(key=lambda s: (s[1] - s[0]), reverse=True)
        used = [False] * n
        claimed = []
        for start, end, span, rid in spans:
            if any(used[start:end]):
                continue
            rec = self.corpus.get(rid)
            # A single ultra-generic word being "a registered title" is noise.
            if len(span) == 1 and (span[0] in GENERIC_PREFIXES
                                   or span[0] in GENERIC_SUFFIXES):
                continue
            for i in range(start, end):
                used[i] = True
            claimed.append((span, rec))

        coverage = sum(used) / n if n else 0.0
        if len(claimed) >= 2 and coverage >= 0.75:
            names = [rec.title for _, rec in claimed]
            findings.append(Finding(
                code="R09",
                rule="TITLE_COMBINATION",
                severity=BLOCKER,
                requirement="3.c",
                message=(
                    "The title is a combination of titles that are already "
                    f"registered: {' + '.join(chr(34) + n2 + chr(34) for n2 in names)}. "
                    "Merging existing titles is not permitted."
                ),
                evidence={
                    "componentTitles": [
                        {
                            "title": rec.title,
                            "registrationNumber": rec.registration_number,
                            "matchedWords": span,
                        }
                        for span, rec in claimed
                    ],
                    "coverage": round(coverage, 3),
                },
                penalty=self.penalties["TITLE_COMBINATION"],
            ))
        else:
            passed.append("Not a combination of existing registered titles")

    # =====================================================================
    # R10 - same meaning in a different language
    # =====================================================================
    def _check_cross_language(self, norm, candidates, findings, passed):
        hits = []

        # (a) exact concept-string match, e.g. "DAILY EVENING" == "PRATIDIN SANDHYA"
        #     The literal cores must differ - otherwise it is the same words,
        #     not a translation of them.
        for rid in self.corpus.concept_matches(norm):
            rec = self.corpus.get(rid)
            if rec.norm.normalized != norm.normalized and rec.norm.core != norm.core:
                hits.append((rec, 1.0, "concept-identical"))

        # (b) high concept overlap while the literal words differ
        for cand in candidates:
            rec = cand.record
            if rec.norm.normalized == norm.normalized or rec.norm.core == norm.core:
                continue
            literal = cand.core_overlap
            conceptual = cand.concept_overlap
            if conceptual >= self.t["cross_language"] and conceptual > literal + 0.15:
                hits.append((rec, conceptual, "concept-overlap"))
            elif (cand.semantic >= self.t["cross_language"]
                  and literal <= 0.20
                  and rec.language and norm.raw
                  and cand.semantic > 0):
                hits.append((rec, cand.semantic, "multilingual-embedding"))

        if hits:
            hits.sort(key=lambda h: h[1], reverse=True)
            rec, score, how = hits[0]
            findings.append(Finding(
                code="R10",
                rule="CROSS_LANGUAGE_EQUIVALENT",
                severity=MAJOR,
                requirement="3.d",
                message=(
                    f'The title carries the same meaning as the registered '
                    f'title "{rec.title}"'
                    + (f" ({rec.language})" if rec.language else "")
                    + ". A translation of an existing title is treated as the "
                      "same title."
                ),
                evidence={
                    "existingTitle": rec.title,
                    "existingLanguage": rec.language,
                    "detectedBy": how,
                    "score": round(float(score), 3),
                    "proposedConcepts": norm.concept_tokens,
                    "existingConcepts": rec.norm.concept_tokens,
                },
                penalty=self.penalties["CROSS_LANGUAGE_EQUIVALENT"],
            ))
        else:
            passed.append("No same-meaning title in another language")

    # =====================================================================
    # R11 - same core after generic prefixes/suffixes are removed
    # =====================================================================
    def _check_core_collision(self, norm, candidates, findings, passed):
        already = {f.evidence.get("existingTitle") for f in findings}
        hits = [
            c for c in candidates
            if c.core_overlap >= self.t["core_overlap"]
            and c.record.norm.normalized != norm.normalized
            and c.record.title not in already
        ]
        if hits:
            c = hits[0]
            findings.append(Finding(
                code="R11",
                rule="CORE_TITLE_COLLISION",
                severity=MAJOR,
                requirement="1.b",
                message=(
                    "Once common registry words (The, India, News, Samachar ...) "
                    "are set aside, the distinctive part of the title is "
                    f'essentially the same as "{c.record.title}".'
                ),
                evidence={
                    "existingTitle": c.record.title,
                    "proposedCore": norm.core.upper(),
                    "existingCore": c.record.norm.core.upper(),
                    "overlap": round(c.core_overlap, 3),
                },
                penalty=0.30,
            ))
        else:
            passed.append("Distinctive core of the title is unique")

    # =====================================================================
    # R14 - conflict with an application already in the queue
    # =====================================================================
    def _check_pending_conflict(self, candidates, findings, passed):
        def conflicts(c) -> bool:
            """
            A queued application blocks a later one on any strong signal, not
            just the fused score - a translation of a pending title scores low
            on literal similarity but is exactly what we must catch.
            """
            return (c.combined >= self.t["review"]
                    or c.concept_overlap >= self.t["cross_language"]
                    or c.phonetic >= self.t["phonetic"]
                    or c.fuzzy >= self.t["fuzzy"]
                    or c.core_overlap >= self.t["core_overlap"])

        pending = [c for c in candidates
                   if c.record.source == "PENDING" and conflicts(c)]
        if pending:
            pending.sort(key=lambda c: max(c.combined, c.concept_overlap),
                         reverse=True)
            c = pending[0]
            findings.append(Finding(
                code="R14",
                rule="PENDING_APPLICATION_CONFLICT",
                severity=MAJOR,
                requirement="5.b",
                message=(
                    f'An earlier application for "{c.record.title}" is already '
                    "in the verification queue and conflicts with this title "
                    f"({round(max(c.combined, c.concept_overlap) * 100)}% "
                    "agreement). The earlier application has priority."
                ),
                evidence={
                    "pendingTitle": c.record.title,
                    "applicationRef": c.record.registration_number,
                    "similarity": round(c.combined * 100, 1),
                },
                penalty=self.penalties["PENDING_APPLICATION_CONFLICT"],
            ))
        else:
            passed.append("No conflict with applications already in the queue")

    # =====================================================================
    # R12 / R13 - similarity thresholds
    # =====================================================================
    def _check_similarity(self, similarity, top, findings, passed):
        if top is None:
            passed.append("No comparable title found in the registry")
            return

        if similarity >= self.t["reject"]:
            findings.append(Finding(
                code="R12",
                rule="HIGH_SIMILARITY",
                severity=BLOCKER,
                requirement="1.d",
                message=(
                    f"Combined similarity with the registered title "
                    f'"{top.record.title}" is {round(similarity * 100, 1)}%, '
                    f"above the {round(self.t['reject'] * 100)}% rejection "
                    "threshold."
                ),
                evidence={
                    "existingTitle": top.record.title,
                    "similarity": round(similarity * 100, 1),
                    "threshold": round(self.t["reject"] * 100, 1),
                    "signals": {
                        "semantic": round(top.semantic, 3),
                        "reranker": round(top.rerank, 3),
                        "fuzzy": round(top.fuzzy, 3),
                        "phonetic": round(top.phonetic, 3),
                        "token": round(top.token, 3),
                    },
                },
                penalty=0.0,   # already reflected in (1 - similarity)
            ))
        elif similarity >= self.t["review"]:
            findings.append(Finding(
                code="R13",
                rule="MODERATE_SIMILARITY",
                severity=MAJOR,
                requirement="1.d",
                message=(
                    f"Combined similarity with the registered title "
                    f'"{top.record.title}" is {round(similarity * 100, 1)}%, '
                    "which falls in the manual-review band "
                    f"({round(self.t['review'] * 100)}%-"
                    f"{round(self.t['reject'] * 100)}%)."
                ),
                evidence={
                    "existingTitle": top.record.title,
                    "similarity": round(similarity * 100, 1),
                    "reviewBand": [round(self.t["review"] * 100, 1),
                                   round(self.t["reject"] * 100, 1)],
                },
                penalty=0.0,
            ))
        else:
            passed.append(
                f"Highest similarity in the registry is only "
                f"{round(similarity * 100, 1)}%"
            )

    # =====================================================================
    # Decision and probability
    # =====================================================================
    @staticmethod
    def _decide(findings: List[Finding], similarity: float) -> str:
        if any(f.severity == BLOCKER for f in findings):
            return REJECT
        if any(f.severity == MAJOR for f in findings):
            return REVIEW
        if any(f.severity == MINOR for f in findings):
            return REVIEW if similarity >= config.THRESHOLDS["review"] else ACCEPT
        return ACCEPT

    def _probability(self, similarity: float, findings: List[Finding],
                     decision: str) -> float:
        """
        Expected-solution rule: a title that is X% similar cannot be more than
        (100 - X)% likely to be verified. Guideline violations subtract further.
        """
        base = 1.0 - similarity
        penalty = sum(f.penalty for f in findings)
        prob = base - penalty
        if decision == REJECT:
            prob = min(prob, 0.05)
        return max(0.0, min(1.0, prob))


# ---------------------------------------------------------------------------
def quick_guideline_check(title: str) -> List[Finding]:
    """
    Registry-free guideline check. Used by the /guidelines endpoint so the UI
    can warn the applicant while they are still typing.
    """
    norm = normalize_title(title)
    findings: List[Finding] = []
    hits = sorted({t for t in norm.tokens if t in DISALLOWED_WORDS})
    if hits:
        findings.append(Finding(
            code="R02", rule="DISALLOWED_WORD", severity=BLOCKER,
            requirement="3.a", penalty=1.0,
            message=f"Prohibited word(s): {', '.join(hits).upper()}",
            evidence={"words": hits},
        ))
    if norm.periodicity_tokens:
        findings.append(Finding(
            code="R08", rule="PERIODICITY_WORD_PRESENT", severity=INFO,
            requirement="3.e", penalty=0.0,
            message=(
                "The title contains a periodicity word "
                f"({', '.join(norm.periodicity_tokens).upper()}). It will be "
                "checked against the base title."
            ),
            evidence={"words": norm.periodicity_tokens},
        ))
    return findings
