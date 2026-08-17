"""
PSS06 - MySQL access for the AI service.

The AI service reads the registered-titles corpus and the live pending
applications. Writes (users, verification results) belong to the Node backend;
the only thing the AI service writes is nothing at all - it stays read-only,
which keeps the two services cleanly separated.
"""

import logging
from typing import Any, Dict, List, Optional

import config

log = logging.getLogger("pss06.db")

try:
    import mysql.connector
    from mysql.connector import pooling

    HAS_MYSQL = True
except Exception:  # pragma: no cover
    mysql = None
    pooling = None
    HAS_MYSQL = False


_pool = None


def get_pool():
    """Lazily create a small connection pool."""
    global _pool
    if not HAS_MYSQL:
        return None
    if _pool is None:
        try:
            _pool = pooling.MySQLConnectionPool(
                pool_name="pss06_ai_pool",
                pool_size=5,
                autocommit=True,
                charset="utf8mb4",
                **config.MYSQL,
            )
            log.info("MySQL pool ready (db=%s)", config.MYSQL["database"])
        except Exception as exc:  # noqa: BLE001
            log.warning("MySQL unavailable (%s) - the AI service will read "
                        "titles from the processed CSV instead.", exc)
            _pool = None
    return _pool


def query(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    pool = get_pool()
    if pool is None:
        raise RuntimeError("MySQL is not configured or not reachable")
    conn = pool.get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        cursor.close()
        return rows
    finally:
        conn.close()


def is_available() -> bool:
    try:
        return bool(query("SELECT 1 AS ok"))
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# Corpus loaders
# ---------------------------------------------------------------------------
REGISTERED_SQL = """
SELECT registration_number, title, registration_date, language,
       periodicity, publisher, owner, publication_state, publication_district
FROM prgi_titles
ORDER BY title ASC, registration_number ASC
"""
# The ORDER BY is not cosmetic: the vector index stores row numbers, so the
# corpus must come back in the same order every single time.

# Which queue statuses hold a live claim on a title?
#
#   PENDING / UNDER_REVIEW / MANUAL_REVIEW - claimed, awaiting a decision
#   APPROVED / ACCEPTED                    - claimed, decision granted
#   REJECTED / WITHDRAWN                   - claim released, must NOT block
#
# Getting this list wrong is silent: a title an officer just approved would
# stop blocking later look-alikes and two identical mastheads could both pass.
PENDING_SQL = """
SELECT id, application_ref, title, language, periodicity, publisher,
       publication_state, status, submitted_at
FROM pending_applications
WHERE status IN ('PENDING', 'UNDER_REVIEW', 'MANUAL_REVIEW',
                 'APPROVED', 'ACCEPTED')
ORDER BY submitted_at ASC, id ASC
"""


def load_registered_titles() -> Optional[List[Dict[str, Any]]]:
    try:
        rows = query(REGISTERED_SQL)
        log.info("Loaded %d registered titles from MySQL", len(rows))
        return rows
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not read prgi_titles from MySQL: %s", exc)
        return None


def load_pending_applications() -> List[Dict[str, Any]]:
    """
    Requirement 5.b - applications submitted but not yet decided must also
    block later look-alike submissions.
    """
    try:
        return query(PENDING_SQL)
    except Exception as exc:  # noqa: BLE001
        log.debug("Pending applications unavailable: %s", exc)
        return []
