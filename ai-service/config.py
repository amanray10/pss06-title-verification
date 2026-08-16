"""
PSS06 - Central configuration for the AI service.

Every tunable threshold lives here so the symbolic layer stays auditable:
you can point at one file and say "these are the rules the system enforces".
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Project root = C:\PSS06  (ai-service/ is one level down)
BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


# --------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------
AI_SERVICE_HOST = os.getenv("AI_SERVICE_HOST", "127.0.0.1")
AI_SERVICE_PORT = int(os.getenv("AI_SERVICE_PORT", "8000"))


# --------------------------------------------------------------------------
# MySQL
# --------------------------------------------------------------------------
MYSQL = {
    "host": os.getenv("MYSQL_HOST", "localhost"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "prgi"),
}


# --------------------------------------------------------------------------
# Data / artefacts
# --------------------------------------------------------------------------
PROCESSED_CSV = BASE_DIR / "data" / "processed" / "prgi_titles.csv"
MODELS_DIR = BASE_DIR / "models"
FAISS_INDEX_PATH = MODELS_DIR / "titles.faiss"
FAISS_IDMAP_PATH = MODELS_DIR / "titles_idmap.json"
LITE_INDEX_PATH = MODELS_DIR / "titles_lite.pkl"


# --------------------------------------------------------------------------
# Neural models
# --------------------------------------------------------------------------
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))

# When LITE_MODE is on (or heavy libraries are missing) the service falls back
# to a TF-IDF character n-gram retriever. Same interface, no 2 GB download.
LITE_MODE = os.getenv("LITE_MODE", "auto").lower()  # "auto" | "true" | "false"

TOP_K_RETRIEVE = int(os.getenv("TOP_K_RETRIEVE", "25"))
TOP_K_RERANK = int(os.getenv("TOP_K_RERANK", "10"))
TOP_K_RETURN = int(os.getenv("TOP_K_RETURN", "5"))


# --------------------------------------------------------------------------
# Ollama (explanation layer only - it never decides)
# --------------------------------------------------------------------------
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "45"))
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "true").lower() == "true"


# --------------------------------------------------------------------------
# Symbolic thresholds
#
# NOTE for the viva: these are *starting* values, calibrated on the PRGI
# dataset. They are configuration, not magic constants - retune them on a
# labelled validation set before production.
# --------------------------------------------------------------------------
THRESHOLDS = {
    # Combined similarity (0-1) at or above which a title is rejected outright.
    "reject": float(os.getenv("T_REJECT", "0.85")),
    # Combined similarity at or above which the title goes to manual review.
    "review": float(os.getenv("T_REVIEW", "0.65")),
    # Below "review" the title is accepted.
    # Phonetic agreement (0-1) that on its own is enough to force review.
    "phonetic": float(os.getenv("T_PHONETIC", "0.90")),
    # Fuzzy string similarity that on its own is enough to force review.
    "fuzzy": float(os.getenv("T_FUZZY", "0.88")),
    # Core-token Jaccard overlap after stripping generic prefixes/suffixes.
    "core_overlap": float(os.getenv("T_CORE_OVERLAP", "0.80")),
    # Cross-language semantic equivalence.
    "cross_language": float(os.getenv("T_CROSS_LANGUAGE", "0.82")),
}

# Weights used to fuse the individual similarity signals into one score.
# They must sum to 1.0.
SIMILARITY_WEIGHTS = {
    "semantic": float(os.getenv("W_SEMANTIC", "0.35")),
    "rerank": float(os.getenv("W_RERANK", "0.25")),
    "fuzzy": float(os.getenv("W_FUZZY", "0.20")),
    "phonetic": float(os.getenv("W_PHONETIC", "0.10")),
    "token": float(os.getenv("W_TOKEN", "0.10")),
}

# Fixed probability penalties applied by hard guideline violations.
# Verification probability = (1 - similarity) - sum(penalties), clamped to [0,1].
RULE_PENALTIES = {
    "EXACT_DUPLICATE": 1.00,
    "DISALLOWED_WORD": 1.00,
    "TITLE_COMBINATION": 0.60,
    "PERIODICITY_VARIANT": 0.55,
    "CROSS_LANGUAGE_EQUIVALENT": 0.50,
    "PHONETIC_COLLISION": 0.40,
    "DISALLOWED_AFFIX": 0.25,
    "PENDING_APPLICATION_CONFLICT": 0.60,
    "TITLE_TOO_SHORT": 0.35,
    "INVALID_CHARACTERS": 0.30,
}
