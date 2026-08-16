"""
PSS06 - Neural encoder (BGE-M3).

BGE-M3 is multilingual: an English title and its Hindi/Marathi/Bengali
equivalent land close together in the same vector space, which is exactly what
requirement 3.d ("similar meanings in other languages") needs.

The class degrades gracefully. If `sentence-transformers` or the 2.2 GB model
weights are unavailable, `available` stays False and the retriever
transparently switches to the TF-IDF character n-gram backend, so the whole
application still runs and demos.
"""

import logging
import threading
from typing import List, Optional

import numpy as np

import config

log = logging.getLogger("pss06.embeddings")


class BGEEmbedder:
    """Thin, lazily-loaded wrapper around the BGE-M3 sentence encoder."""

    _instance: Optional["BGEEmbedder"] = None
    _lock = threading.Lock()

    def __init__(self, model_name: str = None):
        self.model_name = model_name or config.EMBEDDING_MODEL
        self.model = None
        self.available = False
        self.dimension = 0
        self._load()

    # -- singleton -------------------------------------------------------
    @classmethod
    def instance(cls) -> "BGEEmbedder":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # -- loading ---------------------------------------------------------
    def _load(self) -> None:
        if config.LITE_MODE == "true":
            log.warning("LITE_MODE=true - skipping BGE-M3, using TF-IDF backend")
            return
        try:
            from sentence_transformers import SentenceTransformer

            log.info("Loading embedding model %s ...", self.model_name)
            self.model = SentenceTransformer(self.model_name)
            self.dimension = int(self.model.get_sentence_embedding_dimension())
            self.available = True
            log.info("BGE-M3 ready (dim=%d)", self.dimension)
        except Exception as exc:  # noqa: BLE001
            if config.LITE_MODE == "false":
                raise
            log.warning(
                "BGE-M3 unavailable (%s). Falling back to the TF-IDF "
                "character n-gram retriever.", exc,
            )

    # -- encoding --------------------------------------------------------
    def encode(self, texts: List[str], batch_size: int = None,
               show_progress: bool = False) -> np.ndarray:
        """
        Encode texts into L2-normalised float32 vectors.

        Normalising means the FAISS inner-product index behaves as a cosine
        similarity index, so scores land neatly in [-1, 1].
        """
        if not self.available:
            raise RuntimeError("BGE-M3 is not available in this environment")

        vectors = self.model.encode(
            texts,
            batch_size=batch_size or config.EMBEDDING_BATCH_SIZE,
            show_progress_bar=show_progress,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return np.asarray(vectors, dtype="float32")

    def encode_one(self, text: str) -> np.ndarray:
        return self.encode([text])[0]


def get_embedder() -> BGEEmbedder:
    return BGEEmbedder.instance()
