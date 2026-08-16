"""
PSS06 - Vector stores.

Two interchangeable backends behind one interface:

  FaissStore  - IndexFlatIP over BGE-M3 embeddings (the real thing).
                Inner product on L2-normalised vectors == cosine similarity.
  LiteStore   - TF-IDF character 3-5 gram vectors + sparse cosine search.
                No downloads, still catches spelling variants surprisingly
                well because character n-grams are transliteration-friendly.

Both return (corpus_index, score) pairs, so the retriever above them does not
care which one is loaded.
"""

import hashlib
import json
import logging
import pickle
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import numpy as np

import config

log = logging.getLogger("pss06.vectorstore")


def corpus_fingerprint(texts: Sequence[str]) -> str:
    """
    Identity of the exact corpus an index was built from.

    A saved index stores row numbers, not titles. If the registry is reloaded
    in a different order - which happens the moment you switch from reading the
    CSV to reading MySQL - those row numbers silently point at the wrong
    titles and every semantic score becomes nonsense. Comparing fingerprints
    on load turns that silent corruption into an automatic rebuild.
    """
    h = hashlib.sha256()
    h.update(str(len(texts)).encode())
    for t in texts:
        h.update(b"\x00")
        h.update(t.encode("utf-8", "ignore"))
    return h.hexdigest()


class BaseStore:
    backend = "base"
    fingerprint: str = ""

    def search(self, query: str, top_k: int) -> List[Tuple[int, float]]:
        raise NotImplementedError

    @property
    def size(self) -> int:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# FAISS + BGE-M3
# ---------------------------------------------------------------------------
class FaissStore(BaseStore):
    backend = "faiss+bge-m3"

    def __init__(self, index, id_map: Sequence[int], embedder, fingerprint: str = ""):
        self.index = index
        self.id_map = list(id_map)     # FAISS row -> corpus row
        self.embedder = embedder
        self.fingerprint = fingerprint

    @property
    def size(self) -> int:
        return int(self.index.ntotal)

    # -- build / persist -------------------------------------------------
    @classmethod
    def build(cls, texts: List[str], embedder, show_progress: bool = True) -> "FaissStore":
        import faiss  # noqa: PLC0415

        log.info("Embedding %d titles with %s ...", len(texts), embedder.model_name)
        vectors = embedder.encode(texts, show_progress=show_progress)

        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        log.info("FAISS IndexFlatIP built: %d vectors, dim %d",
                 index.ntotal, vectors.shape[1])
        return cls(index, list(range(len(texts))), embedder,
                   corpus_fingerprint(texts))

    def save(self, index_path: Path = None, idmap_path: Path = None) -> None:
        import faiss  # noqa: PLC0415

        index_path = Path(index_path or config.FAISS_INDEX_PATH)
        idmap_path = Path(idmap_path or config.FAISS_IDMAP_PATH)
        index_path.parent.mkdir(parents=True, exist_ok=True)

        faiss.write_index(self.index, str(index_path))
        idmap_path.write_text(
            json.dumps({"idMap": self.id_map, "fingerprint": self.fingerprint}),
            encoding="utf-8",
        )
        log.info("Saved FAISS index -> %s", index_path)

    @classmethod
    def load(cls, embedder, index_path: Path = None,
             idmap_path: Path = None) -> "FaissStore":
        import faiss  # noqa: PLC0415

        index_path = Path(index_path or config.FAISS_INDEX_PATH)
        idmap_path = Path(idmap_path or config.FAISS_IDMAP_PATH)
        index = faiss.read_index(str(index_path))
        blob = json.loads(idmap_path.read_text(encoding="utf-8"))
        if isinstance(blob, list):          # index written before fingerprinting
            id_map, fingerprint = blob, ""
        else:
            id_map = blob.get("idMap", [])
            fingerprint = blob.get("fingerprint", "")
        log.info("Loaded FAISS index (%d vectors) from %s", index.ntotal, index_path)
        return cls(index, id_map, embedder, fingerprint)

    # -- incremental growth (requirement 7: scalability) ------------------
    def add(self, texts: List[str], corpus_ids: Sequence[int]) -> None:
        """Append newly registered titles without rebuilding the whole index."""
        if not texts:
            return
        vectors = self.embedder.encode(texts)
        self.index.add(vectors)
        self.id_map.extend(corpus_ids)

    # -- query -----------------------------------------------------------
    def search(self, query: str, top_k: int) -> List[Tuple[int, float]]:
        if self.index.ntotal == 0:
            return []
        vector = self.embedder.encode([query])
        k = min(top_k, self.index.ntotal)
        scores, rows = self.index.search(vector, k)
        out = []
        for score, row in zip(scores[0], rows[0]):
            if row < 0:
                continue
            out.append((self.id_map[int(row)], float(score)))
        return out


# ---------------------------------------------------------------------------
# TF-IDF character n-gram fallback
# ---------------------------------------------------------------------------
class LiteStore(BaseStore):
    backend = "tfidf-char-ngram (LITE)"

    def __init__(self, vectorizer, matrix, id_map: Sequence[int],
                 fingerprint: str = ""):
        self.vectorizer = vectorizer
        self.matrix = matrix
        self.id_map = list(id_map)
        self.fingerprint = fingerprint

    @property
    def size(self) -> int:
        return self.matrix.shape[0]

    @classmethod
    def build(cls, texts: List[str], **_) -> "LiteStore":
        from sklearn.feature_extraction.text import TfidfVectorizer  # noqa: PLC0415

        log.info("Building TF-IDF char n-gram index over %d titles ...", len(texts))
        vectorizer = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=1,
            sublinear_tf=True,
        )
        matrix = vectorizer.fit_transform(texts)
        log.info("LITE index built: %s", matrix.shape)
        return cls(vectorizer, matrix, list(range(len(texts))),
                   corpus_fingerprint(texts))

    def save(self, path: Path = None) -> None:
        path = Path(path or config.LITE_INDEX_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as fh:
            pickle.dump(
                {"vectorizer": self.vectorizer, "matrix": self.matrix,
                 "id_map": self.id_map, "fingerprint": self.fingerprint}, fh,
            )
        log.info("Saved LITE index -> %s", path)

    @classmethod
    def load(cls, path: Path = None) -> "LiteStore":
        path = Path(path or config.LITE_INDEX_PATH)
        with path.open("rb") as fh:
            blob = pickle.load(fh)
        return cls(blob["vectorizer"], blob["matrix"], blob["id_map"],
                   blob.get("fingerprint", ""))

    def add(self, texts: List[str], corpus_ids: Sequence[int]) -> None:
        import scipy.sparse as sp  # noqa: PLC0415

        if not texts:
            return
        extra = self.vectorizer.transform(texts)
        self.matrix = sp.vstack([self.matrix, extra])
        self.id_map.extend(corpus_ids)

    def search(self, query: str, top_k: int) -> List[Tuple[int, float]]:
        if self.matrix.shape[0] == 0:
            return []
        qv = self.vectorizer.transform([query])
        # rows are L2-normalised by TfidfVectorizer, so the dot product is cosine
        scores = (self.matrix @ qv.T).toarray().ravel()
        k = min(top_k, scores.shape[0])
        rows = np.argpartition(-scores, k - 1)[:k]
        rows = rows[np.argsort(-scores[rows])]
        return [(self.id_map[int(r)], float(scores[int(r)])) for r in rows]


# ---------------------------------------------------------------------------
def build_store(texts: List[str], embedder) -> BaseStore:
    """Build the best index this machine can support."""
    if embedder is not None and getattr(embedder, "available", False):
        try:
            return FaissStore.build(texts, embedder)
        except Exception as exc:  # noqa: BLE001
            log.warning("FAISS build failed (%s) - falling back to LITE", exc)
    return LiteStore.build(texts)


def load_store(embedder, expected_fingerprint: Optional[str] = None) -> Optional[BaseStore]:
    """
    Load a previously built index, preferring FAISS.

    Returns None (so the caller rebuilds) when the saved index was built from a
    different corpus than the one currently loaded.
    """
    def usable(store: BaseStore, kind: str) -> bool:
        if expected_fingerprint and store.fingerprint != expected_fingerprint:
            log.warning(
                "Saved %s index was built from a different corpus - rebuilding",
                kind,
            )
            return False
        return True

    if (embedder is not None and getattr(embedder, "available", False)
            and Path(config.FAISS_INDEX_PATH).exists()
            and Path(config.FAISS_IDMAP_PATH).exists()):
        try:
            store = FaissStore.load(embedder)
            if usable(store, "FAISS"):
                return store
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not load FAISS index (%s)", exc)

    if Path(config.LITE_INDEX_PATH).exists():
        try:
            store = LiteStore.load()
            if usable(store, "LITE"):
                return store
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not load LITE index (%s)", exc)

    return None
