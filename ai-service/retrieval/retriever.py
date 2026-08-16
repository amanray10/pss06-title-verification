"""
PSS06 - Hybrid retrieval.

Candidate generation is deliberately *not* purely semantic. Embeddings are
excellent at meaning and useless at "NAMASKAR vs NAMASCAR"; exact-token
blocking is the reverse. So the retriever unions four channels:

  1. Semantic     - FAISS / TF-IDF nearest neighbours
  2. Exact & core - hash lookups on the normalised and affix-stripped forms
  3. Phonetic     - Metaphone signature bucket + transliteration skeleton
  4. Lexical      - rows sharing a rare token (blocking)

The union is then rescored with every similarity signal, reranked by the
cross-encoder, and returned as structured evidence for the rule engine.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import config
from preprocessing.normalizer import NormalizedTitle
from reranking.bge_reranker import get_reranker
from retrieval.corpus import TitleCorpus, TitleRecord
from rules.phonetics import (
    containment,
    fuzzy_similarity,
    phonetic_similarity,
    soundex_key,
    token_jaccard,
)

log = logging.getLogger("pss06.retriever")


@dataclass
class Candidate:
    """One existing title, with every similarity signal we computed for it."""

    record: TitleRecord
    semantic: float = 0.0
    rerank: float = 0.0
    fuzzy: float = 0.0
    phonetic: float = 0.0
    token: float = 0.0
    core_overlap: float = 0.0
    concept_overlap: float = 0.0
    combined: float = 0.0
    channels: List[str] = field(default_factory=list)
    # How many other rows in the registry carry this exact same title
    # (the PRGI register legitimately holds one title per state).
    duplicate_registrations: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.record.title,
            "similarity": round(self.combined * 100, 1),
            "otherRegistrations": self.duplicate_registrations,
            "scores": {
                "semantic": round(self.semantic, 4),
                "reranker": round(self.rerank, 4),
                "fuzzy": round(self.fuzzy, 4),
                "phonetic": round(self.phonetic, 4),
                "token": round(self.token, 4),
                "coreOverlap": round(self.core_overlap, 4),
                "conceptOverlap": round(self.concept_overlap, 4),
            },
            "matchedVia": self.channels,
            "metadata": self.record.to_metadata(),
        }


class TitleRetriever:
    """Hybrid retriever over the corpus + vector store."""

    def __init__(self, corpus: TitleCorpus, store=None):
        self.corpus = corpus
        self.store = store
        self.reranker = get_reranker()

    # ------------------------------------------------------------------
    # Candidate generation
    # ------------------------------------------------------------------
    def _gather_candidate_ids(self, norm: NormalizedTitle,
                              top_k: int) -> Dict[int, List[str]]:
        channels: Dict[int, List[str]] = {}

        def mark(ids, label):
            for rid in ids:
                channels.setdefault(rid, [])
                if label not in channels[rid]:
                    channels[rid].append(label)

        mark(self.corpus.exact_matches(norm), "exact")
        mark(self.corpus.core_matches(norm), "core")
        mark(self.corpus.phonetic_matches(norm), "phonetic")
        mark(self.corpus.collapsed_matches(norm), "spelling-variant")
        mark(self.corpus.concept_matches(norm), "cross-language")

        if self.store is not None:
            try:
                for rid, score in self.store.search(norm.normalized, top_k):
                    mark([rid], "semantic")
            except Exception as exc:  # noqa: BLE001
                log.warning("Vector search failed (%s)", exc)

        mark(self.corpus.token_candidates(norm, limit=300), "lexical")

        # Requirement 5.b - the pending queue is always compared in full.
        mark(self.corpus.pending_ids[:2000], "pending-queue")
        return channels

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------
    def _semantic_scores(self, norm: NormalizedTitle,
                         top_k: int) -> Dict[int, float]:
        if self.store is None:
            return {}
        try:
            return {rid: max(0.0, s)
                    for rid, s in self.store.search(norm.normalized, top_k)}
        except Exception:  # noqa: BLE001
            return {}

    @staticmethod
    def _combine(semantic: float, rerank: float, fuzzy: float,
                 phonetic: float, token: float) -> float:
        w = config.SIMILARITY_WEIGHTS
        score = (w["semantic"] * semantic + w["rerank"] * rerank
                 + w["fuzzy"] * fuzzy + w["phonetic"] * phonetic
                 + w["token"] * token)
        return max(0.0, min(1.0, score))

    def retrieve(self, norm: NormalizedTitle,
                 top_k_retrieve: int = None,
                 top_k_rerank: int = None,
                 top_k_return: int = None) -> List[Candidate]:
        """
        Return scored candidates, best-first.

        The list handed back is intentionally longer than what the UI shows:
        the rule engine needs a wider window (a cross-language or pending-queue
        conflict can sit well below the top 5 on literal similarity while still
        being the decisive piece of evidence).
        """
        top_k_retrieve = top_k_retrieve or config.TOP_K_RETRIEVE
        top_k_rerank = top_k_rerank or config.TOP_K_RERANK
        top_k_return = max(top_k_return or config.TOP_K_RETURN, 30)

        channels = self._gather_candidate_ids(norm, top_k_retrieve)
        if not channels:
            return []

        semantic = self._semantic_scores(norm, top_k_retrieve * 2)
        q_soundex = soundex_key(norm.core)

        prelim: List[Candidate] = []
        for rid, chans in channels.items():
            rec = self.corpus.get(rid)
            n2 = rec.norm

            fuzzy = max(
                fuzzy_similarity(norm.normalized, n2.normalized),
                fuzzy_similarity(norm.collapsed, n2.collapsed),
            )
            phon = max(
                phonetic_similarity(norm.phonetic_key, n2.phonetic_key),
                phonetic_similarity(q_soundex, soundex_key(n2.core)),
            )
            tok = max(
                token_jaccard(norm.tokens, n2.tokens),
                0.85 * containment(norm.tokens, n2.tokens),
            )
            core_ov = token_jaccard(norm.core_tokens, n2.core_tokens)
            concept_ov = token_jaccard(norm.concept_tokens, n2.concept_tokens)
            sem = semantic.get(rid, 0.0)

            prelim.append(Candidate(
                record=rec, semantic=sem, fuzzy=fuzzy, phonetic=phon,
                token=tok, core_overlap=core_ov, concept_overlap=concept_ov,
                channels=chans,
                # provisional ordering before the cross-encoder runs
                combined=self._combine(sem, 0.0, fuzzy, phon, tok),
            ))

        # Cheap pre-ranking so the cross-encoder only sees a shortlist
        prelim.sort(key=lambda c: c.combined, reverse=True)
        shortlist = prelim[:top_k_rerank]

        rerank_scores = self.reranker.score_pairs(
            norm.normalized, [c.record.norm.normalized for c in shortlist],
        )
        for cand, score in zip(shortlist, rerank_scores):
            cand.rerank = float(score)
            cand.combined = self._combine(
                cand.semantic, cand.rerank, cand.fuzzy,
                cand.phonetic, cand.token,
            )
            if "reranked" not in cand.channels:
                cand.channels.append("reranked")

        shortlist.sort(key=lambda c: c.combined, reverse=True)

        # Anything below the shortlist keeps its provisional score but is only
        # returned if the shortlist is short.
        tail = prelim[top_k_rerank:]
        merged = shortlist + tail
        merged.sort(key=lambda c: c.combined, reverse=True)
        return self._dedupe(merged)[:top_k_return]

    @staticmethod
    def _dedupe(candidates: List[Candidate]) -> List[Candidate]:
        """
        Collapse repeated titles.

        The same masthead is often registered separately in several states, so
        a raw result list can show one title five times. We keep the
        best-scoring row and report how many other registrations exist.
        """
        best: Dict[str, Candidate] = {}
        order: List[str] = []
        for cand in candidates:
            key = cand.record.norm.normalized
            if key in best:
                best[key].duplicate_registrations += 1
            else:
                best[key] = cand
                order.append(key)
        return [best[k] for k in order]

    # ------------------------------------------------------------------
    def find_exact(self, norm: NormalizedTitle) -> Optional[TitleRecord]:
        ids = self.corpus.exact_matches(norm)
        return self.corpus.get(ids[0]) if ids else None
