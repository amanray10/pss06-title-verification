"""
PSS06 - Cross-encoder reranking.

The bi-encoder (BGE-M3) scores the query and each candidate *independently*,
which is what makes searching 160,000 titles fast. The price is precision: two
titles can sit close in vector space without really colliding.

The cross-encoder reads the pair together ("PROPOSED [SEP] EXISTING") and
produces a much sharper relevance score. We only run it on the top-K shortlist,
so the cost stays bounded.

Fallback: when the reranker model is unavailable we synthesise a comparable
score from lexical evidence (character n-gram overlap + token containment).
That keeps the pipeline shape identical in LITE mode.
"""

import logging
import math
import threading
from typing import List, Optional, Tuple

import config

log = logging.getLogger("pss06.reranker")


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


class BGEReranker:
    """Lazily-loaded BAAI/bge-reranker cross-encoder with a lexical fallback."""

    _instance: Optional["BGEReranker"] = None
    _lock = threading.Lock()

    def __init__(self, model_name: str = None):
        self.model_name = model_name or config.RERANKER_MODEL
        self.model = None
        self.available = False
        self._load()

    @classmethod
    def instance(cls) -> "BGEReranker":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _load(self) -> None:
        if config.LITE_MODE == "true":
            log.warning("LITE_MODE=true - cross-encoder disabled, using lexical proxy")
            return
        try:
            from sentence_transformers import CrossEncoder

            log.info("Loading reranker %s ...", self.model_name)
            self.model = CrossEncoder(self.model_name, max_length=256)
            self.available = True
            log.info("Cross-encoder ready")
        except Exception as exc:  # noqa: BLE001
            if config.LITE_MODE == "false":
                raise
            log.warning("Reranker unavailable (%s) - using lexical proxy", exc)

    # -- scoring ---------------------------------------------------------
    def score_pairs(self, query: str, candidates: List[str]) -> List[float]:
        """Return a relevance score in [0, 1] for each (query, candidate)."""
        if not candidates:
            return []

        if self.available:
            try:
                raw = self.model.predict(
                    [(query, c) for c in candidates],
                    show_progress_bar=False,
                )
                return [float(_sigmoid(float(r))) for r in raw]
            except Exception as exc:  # noqa: BLE001
                log.warning("Cross-encoder failed (%s) - falling back", exc)

        return [self._lexical_proxy(query, c) for c in candidates]

    # -- fallback --------------------------------------------------------
    @staticmethod
    def _lexical_proxy(query: str, candidate: str) -> float:
        from rules.phonetics import containment, fuzzy_similarity

        q, c = query.lower(), candidate.lower()
        char_sim = fuzzy_similarity(q, c)
        tok_sim = containment(q.split(), c.split())
        # 3-gram overlap - close in spirit to what the cross-encoder rewards
        def grams(s: str):
            s = f"  {s} "
            return {s[i:i + 3] for i in range(len(s) - 2)}

        gq, gc = grams(q), grams(c)
        gram_sim = len(gq & gc) / max(1, min(len(gq), len(gc)))

        return round(0.45 * char_sim + 0.30 * gram_sim + 0.25 * tok_sim, 6)

    def rerank(self, query: str, candidates: List[str],
               top_k: int = None) -> List[Tuple[int, float]]:
        """Return (candidate_index, score) sorted best-first."""
        scores = self.score_pairs(query, candidates)
        ranked = sorted(enumerate(scores), key=lambda p: p[1], reverse=True)
        return ranked[: top_k or len(ranked)]


def get_reranker() -> BGEReranker:
    return BGEReranker.instance()
