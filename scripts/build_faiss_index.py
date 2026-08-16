"""
PSS06 - Offline indexing pipeline (Flow A).

    MySQL / processed CSV
            |
      normalise titles
            |
         BGE-M3            (or TF-IDF char n-grams in LITE mode)
            |
        embeddings
            |
     FAISS IndexFlatIP
            |
    models/titles.faiss + models/titles_idmap.json

Run this once after loading the registry, and again whenever a bulk import
adds titles. The FastAPI service loads the saved index at startup instead of
re-embedding 160,000 rows on every boot.

Usage:
    cd C:\\PSS06
    python scripts/build_faiss_index.py
    python scripts/build_faiss_index.py --lite      # force the fallback
"""

import argparse
import logging
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ai-service"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)-20s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("build-index")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the PSS06 title index")
    parser.add_argument("--lite", action="store_true",
                        help="Force the TF-IDF fallback backend")
    parser.add_argument("--no-cache", action="store_true",
                        help="Ignore the corpus normalisation cache")
    args = parser.parse_args()

    import os

    if args.lite:
        os.environ["LITE_MODE"] = "true"

    import config  # noqa: PLC0415  (must come after the env override)
    from embeddings.bge_m3 import get_embedder
    from retrieval.corpus import load_corpus
    from retrieval.faiss_store import build_store

    t0 = time.perf_counter()

    log.info("Step 1/4  loading the title corpus ...")
    corpus = load_corpus(use_cache=not args.no_cache)
    log.info("          %d titles ready", len(corpus))

    log.info("Step 2/4  loading the encoder ...")
    embedder = get_embedder()
    log.info("          backend = %s",
             config.EMBEDDING_MODEL if embedder.available
             else "TF-IDF char n-grams (LITE)")

    log.info("Step 3/4  embedding titles and building the index ...")
    store = build_store(corpus.texts(), embedder)

    log.info("Step 4/4  saving artefacts ...")
    Path(config.MODELS_DIR).mkdir(parents=True, exist_ok=True)
    store.save()
    corpus.save_cache()

    log.info("-" * 60)
    log.info("Done in %.1fs", time.perf_counter() - t0)
    log.info("Backend      : %s", store.backend)
    log.info("Vectors      : %d", store.size)
    log.info("Artefacts    : %s", config.MODELS_DIR)
    log.info("-" * 60)

    # Smoke test so a broken index is caught here, not in production.
    from preprocessing.normalizer import normalize_title

    probe = corpus.get(0).title
    hits = store.search(normalize_title(probe).normalized, 3)
    log.info('Smoke test - nearest neighbours of "%s":', probe)
    for rid, score in hits:
        log.info("   %6.3f  %s", score, corpus.get(rid).title)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
