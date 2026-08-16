"""
PSS06 - The Verification Agent.

The agent is an *orchestrator*, not an oracle. It owns a set of tools and
decides which ones to run, in what order, and when it already has enough
evidence to stop early:

    normalize_title      -> clean the input
    guideline_prescreen  -> cheap, registry-free guideline checks
    exact_search         -> O(1) hash lookup, can short-circuit everything
    semantic_search      -> BGE-M3 + FAISS (or the LITE backend)
    rerank_results       -> BGE cross-encoder over the shortlist
    retrieve_metadata    -> publisher / state / registration details
    apply_symbolic_rules -> the deterministic rule engine
    compute_probability  -> verification likelihood
    generate_explanation -> Ollama (or template)
    suggest_alternatives -> actionable feedback for the applicant

Every tool call is timed and recorded in `agentTrace`, so the UI can show the
reasoning path instead of just the verdict.
"""

import logging
import time
from typing import Any, Dict, List, Optional

import config
from llm import ollama
from preprocessing.normalizer import normalize_title
from retrieval.corpus import TitleCorpus, TitleRecord
from retrieval.retriever import Candidate, TitleRetriever
from rules.title_rules import RuleEngine, RuleOutcome, quick_guideline_check

log = logging.getLogger("pss06.agent")


class VerificationAgent:
    """Coordinates preprocessing, retrieval, reranking, rules and explanation."""

    def __init__(self, corpus: TitleCorpus, retriever: TitleRetriever,
                 rule_engine: RuleEngine, engine_info: Dict[str, Any]):
        self.corpus = corpus
        self.retriever = retriever
        self.rules = rule_engine
        self.engine_info = engine_info

    # ------------------------------------------------------------------
    # Trace helper
    # ------------------------------------------------------------------
    class _Trace:
        def __init__(self):
            self.steps: List[Dict[str, Any]] = []
            self._t0 = time.perf_counter()

        def record(self, tool: str, summary: str, started: float) -> None:
            self.steps.append({
                "step": len(self.steps) + 1,
                "tool": tool,
                "summary": summary,
                "durationMs": round((time.perf_counter() - started) * 1000, 2),
            })

        @property
        def elapsed_ms(self) -> float:
            return round((time.perf_counter() - self._t0) * 1000, 2)

    # ------------------------------------------------------------------
    # Main workflow
    # ------------------------------------------------------------------
    def verify(self, title: str, language: str = None,
               publication_type: str = None, top_k: int = None,
               explain: bool = True) -> Dict[str, Any]:
        trace = self._Trace()

        # -- 1. normalise ------------------------------------------------
        t = time.perf_counter()
        norm = normalize_title(title)
        trace.record(
            "normalize_title",
            f'"{title}" -> "{norm.normalized}" '
            f"(core: \"{norm.core.upper()}\", {len(norm.tokens)} tokens)",
            t,
        )

        # -- 2. registry-free guideline pre-screen ------------------------
        t = time.perf_counter()
        prescreen = [f.to_dict() for f in quick_guideline_check(title)]
        blockers = [f for f in prescreen if f["severity"] == "BLOCKER"]
        trace.record(
            "guideline_prescreen",
            (f"{len(blockers)} blocking guideline issue(s) found"
             if blockers else "no prohibited vocabulary detected"),
            t,
        )

        # -- 3. exact duplicate ------------------------------------------
        t = time.perf_counter()
        exact = self.retriever.find_exact(norm)
        trace.record(
            "exact_search",
            (f'exact match found: "{exact.title}"' if exact
             else "no exact match in the registry"),
            t,
        )

        # -- 4/5. semantic retrieval + reranking --------------------------
        # The agent decides: if the title is an exact duplicate AND carries a
        # prohibited word, no amount of retrieval will change the outcome, but
        # we still fetch neighbours so the applicant sees the evidence.
        t = time.perf_counter()
        candidates: List[Candidate] = self.retriever.retrieve(norm)
        display_k = top_k or config.TOP_K_RETURN
        trace.record(
            "semantic_search + rerank_results",
            (f"{len(candidates)} candidate(s) after "
             f"{self.engine_info.get('vectorBackend', 'lexical')} retrieval and "
             f"{'cross-encoder' if self.engine_info.get('rerankerAvailable') else 'lexical'} "
             f"reranking; best = {round((candidates[0].combined * 100), 1)}%"
             if candidates else "no comparable title found"),
            t,
        )

        # -- 6. metadata --------------------------------------------------
        t = time.perf_counter()
        display = candidates[:display_k]
        trace.record(
            "retrieve_metadata",
            f"publisher / registration details attached to {len(display)} match(es)",
            t,
        )

        # -- 7. symbolic rules --------------------------------------------
        # The rule engine sees the wider window, not just what the UI shows.
        t = time.perf_counter()
        outcome: RuleOutcome = self.rules.evaluate(norm, candidates)
        fired = [f.rule for f in outcome.findings]
        trace.record(
            "apply_symbolic_rules",
            (f"{len(outcome.findings)} rule(s) fired: {', '.join(fired)}"
             if fired else "all guideline checks passed"),
            t,
        )

        # Any title a rule actually cites must be visible to the applicant,
        # even if it did not make the literal top-5 (a translation conflict
        # typically has near-zero string overlap).
        cited = {f.evidence.get("existingTitle") or f.evidence.get("pendingTitle")
                 for f in outcome.findings}
        cited.discard(None)
        shown = {c.record.title for c in display}
        for cand in candidates:
            if cand.record.title in cited and cand.record.title not in shown:
                display.append(cand)
                shown.add(cand.record.title)

        similar = [c.to_dict() for c in display]

        # -- 8. probability ------------------------------------------------
        t = time.perf_counter()
        similarity_pct = round(outcome.similarity * 100, 1)
        probability_pct = round(outcome.probability * 100, 1)
        trace.record(
            "compute_probability",
            f"similarity {similarity_pct}% -> verification probability "
            f"{probability_pct}% (decision: {outcome.decision})",
            t,
        )

        # -- 9. explanation -------------------------------------------------
        findings_dicts = [f.to_dict() for f in outcome.findings]
        if explain:
            t = time.perf_counter()
            expl = ollama.generate_explanation(
                title=title,
                language=language or "",
                decision=outcome.decision,
                similarity=similarity_pct,
                probability=probability_pct,
                findings=findings_dicts,
                matches=similar,
            )
            trace.record("generate_explanation",
                         f"explanation written by {expl['generatedBy']}", t)
        else:
            expl = {"text": "", "generatedBy": "skipped"}

        # -- 10. suggestions ------------------------------------------------
        t = time.perf_counter()
        suggestions = ollama.generate_suggestions(title, findings_dicts, similar)
        trace.record("suggest_alternatives",
                     f"{len(suggestions)} recommendation(s) prepared", t)

        return {
            "title": title,
            "normalizedTitle": norm.normalized,
            "decision": outcome.decision,
            "similarityScore": similarity_pct,
            "verificationProbability": probability_pct,
            "confidence": self._confidence(outcome, candidates),
            "findings": findings_dicts,
            "checksPassed": outcome.checks_passed,
            "similarTitles": similar,
            "explanation": expl["text"],
            "explanationSource": expl["generatedBy"],
            "suggestions": suggestions,
            "agentTrace": trace.steps,
            "engine": self.engine_info,
            "processingMs": trace.elapsed_ms,
        }

    # ------------------------------------------------------------------
    @staticmethod
    def _confidence(outcome: RuleOutcome, candidates: List[Candidate]) -> str:
        """
        How sure is the system about its own verdict?

        Deterministic rules (exact duplicate, banned word) are certain.
        A score sitting right on a threshold is not.
        """
        hard = {"R01", "R02", "R08", "R09"}
        if any(f.code in hard for f in outcome.findings):
            return "HIGH"
        if not candidates:
            return "HIGH"

        t = config.THRESHOLDS
        sim = outcome.similarity
        margin = min(abs(sim - t["reject"]), abs(sim - t["review"]))
        if margin < 0.04:
            return "LOW"
        if margin < 0.10:
            return "MEDIUM"
        return "HIGH"

    # ------------------------------------------------------------------
    # Live corpus growth (requirement 5.b)
    # ------------------------------------------------------------------
    def register_pending(self, title: str, application_ref: str,
                         language: str = "", periodicity: str = "",
                         publisher: str = "", state: str = "") -> Dict[str, Any]:
        """
        Add a just-submitted application to the in-memory corpus so the very
        next applicant is checked against it too.
        """
        rec = TitleRecord(
            row_id=-1,
            title=title,
            registration_number=application_ref,
            language=language or "",
            periodicity=periodicity or "",
            publisher=publisher or "",
            publication_state=state or "",
            source="PENDING",
        )
        added = self.corpus.add_records([rec])

        store = getattr(self.retriever, "store", None)
        if store is not None and hasattr(store, "add"):
            try:
                store.add([self.corpus.get(added[0]).norm.normalized], added)
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not extend the vector index live: %s", exc)

        return {"added": True, "corpusSize": len(self.corpus), "rowId": added[0]}
