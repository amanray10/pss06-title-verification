"""
PSS06 - Python AI service (FastAPI).

Boots the whole neuro-symbolic stack once at startup and exposes it over HTTP
to the Node/Express backend:

    GET  /health          liveness + which engines actually loaded
    GET  /stats           corpus statistics
    POST /ai/verify       the main verification endpoint
    POST /ai/guidelines   fast, registry-free guideline pre-check
    POST /ai/pending      register a submitted application in the live corpus
    POST /ai/reload       rebuild the corpus/index without restarting

Run:  uvicorn main:app --host 127.0.0.1 --port 8000
"""

import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
from agents.verification_agent import VerificationAgent
from db import mysql as dbm
from embeddings.bge_m3 import get_embedder
from llm import ollama
from reranking.bge_reranker import get_reranker
from retrieval.corpus import load_corpus
from retrieval.faiss_store import build_store, corpus_fingerprint, load_store
from retrieval.retriever import TitleRetriever
from rules.title_rules import RuleEngine, quick_guideline_check
from schemas.verification import (
    GuidelineRequest,
    RegisterPendingRequest,
    VerifyRequest,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)-22s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pss06")

STATE: Dict[str, Any] = {
    "corpus": None,
    "retriever": None,
    "agent": None,
    "engine": {},
    "ready": False,
    "bootMs": 0.0,
}


# ---------------------------------------------------------------------------
def boot() -> None:
    """Load corpus, vector index, models and wire the agent together."""
    t0 = time.perf_counter()
    log.info("=" * 68)
    log.info("  PSS06 Title Verification - AI service starting")
    log.info("=" * 68)

    corpus = load_corpus()

    embedder = get_embedder()
    reranker = get_reranker()

    texts = corpus.texts()
    fingerprint = corpus_fingerprint(texts)

    store = load_store(embedder, fingerprint)
    if store is None:
        log.info("Building the title index (run scripts/build_faiss_index.py "
                 "beforehand to make startup instant)")
        store = build_store(texts, embedder)
        try:
            store.save()
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not persist the index: %s", exc)

    engine = {
        "embeddingModel": config.EMBEDDING_MODEL if embedder.available else None,
        "embeddingAvailable": embedder.available,
        "rerankerModel": config.RERANKER_MODEL if reranker.available else None,
        "rerankerAvailable": reranker.available,
        "vectorBackend": store.backend,
        "corpusSize": len(corpus),
        "indexSize": store.size,
        "mysqlConnected": dbm.is_available(),
        "ollamaAvailable": ollama.is_available(),
        "ollamaModel": config.OLLAMA_MODEL,
        "mode": "FULL" if embedder.available else "LITE",
        "thresholds": config.THRESHOLDS,
        "weights": config.SIMILARITY_WEIGHTS,
    }

    retriever = TitleRetriever(corpus, store)
    STATE.update({
        "corpus": corpus,
        "retriever": retriever,
        "agent": VerificationAgent(corpus, retriever, RuleEngine(corpus), engine),
        "engine": engine,
        "ready": True,
        "bootMs": round((time.perf_counter() - t0) * 1000, 1),
    })

    log.info("-" * 68)
    log.info("  Mode            : %s", engine["mode"])
    log.info("  Vector backend  : %s", engine["vectorBackend"])
    log.info("  Corpus          : %d titles", engine["corpusSize"])
    log.info("  Cross-encoder   : %s", engine["rerankerAvailable"])
    log.info("  MySQL           : %s", engine["mysqlConnected"])
    log.info("  Ollama          : %s (%s)", engine["ollamaAvailable"],
             engine["ollamaModel"])
    log.info("  Boot time       : %.0f ms", STATE["bootMs"])
    log.info("-" * 68)


@asynccontextmanager
async def lifespan(_: FastAPI):
    boot()
    yield
    log.info("AI service shutting down")


app = FastAPI(
    title="PSS06 - PRGI Title Verification AI Service",
    description=(
        "Neuro-symbolic agentic RAG for publication title verification: "
        "BGE-M3 + FAISS retrieval, BGE cross-encoder reranking, a deterministic "
        "guideline rule engine, and an Ollama-generated explanation."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _agent() -> VerificationAgent:
    if not STATE["ready"] or STATE["agent"] is None:
        raise HTTPException(status_code=503, detail="AI service is still warming up")
    return STATE["agent"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok" if STATE["ready"] else "starting",
        "service": "PSS06 AI Service",
        "version": "1.0.0",
        "bootMs": STATE["bootMs"],
        "engine": STATE["engine"],
    }


@app.get("/stats")
def stats():
    corpus = STATE["corpus"]
    if corpus is None:
        raise HTTPException(status_code=503, detail="Corpus not loaded")

    languages: Dict[str, int] = {}
    pending = 0
    for rec in corpus.records:
        if rec.source == "PENDING":
            pending += 1
        if rec.language:
            languages[rec.language] = languages.get(rec.language, 0) + 1

    top_languages = dict(sorted(languages.items(), key=lambda kv: kv[1],
                                reverse=True)[:12])
    return {
        "totalTitles": len(corpus),
        "registeredTitles": len(corpus) - pending,
        "pendingApplications": pending,
        "distinctCores": len(corpus.core_index),
        "distinctPhoneticKeys": len(corpus.phonetic_index),
        "vocabularySize": len(corpus.token_index),
        "languages": top_languages,
        "engine": STATE["engine"],
    }


@app.post("/ai/verify")
def verify(req: VerifyRequest):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title must not be empty")
    try:
        return _agent().verify(
            title=req.title.strip(),
            language=req.language,
            publication_type=req.publicationType,
            top_k=req.topK,
            explain=req.explain,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Verification failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/ai/guidelines")
def guidelines(req: GuidelineRequest):
    """Cheap check the UI can call while the applicant is still typing."""
    findings = [f.to_dict() for f in quick_guideline_check(req.title)]
    return {
        "title": req.title,
        "clean": not any(f["severity"] == "BLOCKER" for f in findings),
        "findings": findings,
    }


@app.post("/ai/pending")
def register_pending(req: RegisterPendingRequest):
    return _agent().register_pending(
        title=req.title,
        application_ref=req.applicationRef,
        language=req.language or "",
        periodicity=req.periodicity or "",
        publisher=req.publisher or "",
        state=req.state or "",
    )


@app.post("/ai/reload")
def reload_corpus():
    """Re-read the registry and rebuild the index (after a bulk import)."""
    STATE["ready"] = False
    boot()
    return {"reloaded": True, "engine": STATE["engine"]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.AI_SERVICE_HOST,
                port=config.AI_SERVICE_PORT, reload=False)
