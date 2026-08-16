"""
PSS06 - Database initialisation.

Creates the application tables next to the `prgi_titles` registry you already
loaded, adds a `normalized_title` column so exact-duplicate checks can be a
single indexed SQL lookup, and seeds a demo administrator account.

Usage:
    cd C:\\PSS06
    python scripts/init_db.py
    python scripts/init_db.py --no-seed
"""

import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SCHEMA_PATH = ROOT / "backend" / "models" / "schema.sql"
DEMO_PASSWORD = "admin123"

_PUNCT = re.compile(r"[^\w\sऀ-෿؀-ۿ]", re.UNICODE)


def normalize(title: str) -> str:
    text = unicodedata.normalize("NFKC", str(title or ""))
    text = text.replace("&", " AND ")
    text = _PUNCT.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip().upper()


def connect(with_db: bool = True):
    kwargs = {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD", ""),
        "charset": "utf8mb4",
    }
    if with_db:
        kwargs["database"] = os.getenv("MYSQL_DATABASE", "prgi")
    return mysql.connector.connect(**kwargs)


def run_schema(cursor) -> None:
    raw = SCHEMA_PATH.read_text(encoding="utf-8")
    # Drop comment lines first - otherwise the banner comments in front of each
    # CREATE TABLE end up glued to the previous statement by the naive split.
    body = "\n".join(
        line for line in raw.splitlines() if not line.strip().startswith("--")
    )
    statements = [s.strip() for s in body.split(";") if s.strip()]
    for stmt in statements:
        cursor.execute(stmt)
    print(f"  applied {len(statements)} schema statement(s)")


def add_normalized_column(cursor) -> None:
    """
    Requirement 5.c - keep an indexed, pre-normalised copy of every title so
    the exact-duplicate check is a single index seek instead of a table scan.
    """
    cursor.execute("SHOW COLUMNS FROM prgi_titles LIKE 'normalized_title'")
    if cursor.fetchone() is None:
        print("  adding prgi_titles.normalized_title ...")
        cursor.execute(
            "ALTER TABLE prgi_titles "
            "ADD COLUMN normalized_title VARCHAR(300) NULL AFTER title"
        )
        cursor.execute(
            "ALTER TABLE prgi_titles ADD INDEX idx_normalized (normalized_title)"
        )
    else:
        print("  prgi_titles.normalized_title already present")

    cursor.execute(
        "SELECT registration_number, title FROM prgi_titles "
        "WHERE normalized_title IS NULL OR normalized_title = ''"
    )
    rows = cursor.fetchall()
    if not rows:
        print("  all titles already normalised")
        return

    print(f"  normalising {len(rows)} title(s) ...")
    payload = [(normalize(t), rn) for rn, t in rows]
    cursor.executemany(
        "UPDATE prgi_titles SET normalized_title = %s WHERE registration_number = %s",
        payload,
    )
    print(f"  normalised {cursor.rowcount} row(s)")


def update_pending_applications_schema(cursor) -> None:
    """Ensure audit columns and extended statuses are present in pending_applications."""
    try:
        cursor.execute("SHOW COLUMNS FROM pending_applications LIKE 'reviewed_by'")
        if cursor.fetchone() is None:
            print("  adding pending_applications.reviewed_by ...")
            cursor.execute("ALTER TABLE pending_applications ADD COLUMN reviewed_by VARCHAR(64) NULL AFTER status")
        
        cursor.execute("SHOW COLUMNS FROM pending_applications LIKE 'reviewed_at'")
        if cursor.fetchone() is None:
            print("  adding pending_applications.reviewed_at ...")
            cursor.execute("ALTER TABLE pending_applications ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by")

        cursor.execute("SHOW COLUMNS FROM pending_applications LIKE 'rejection_reason'")
        if cursor.fetchone() is None:
            print("  adding pending_applications.rejection_reason ...")
            cursor.execute("ALTER TABLE pending_applications ADD COLUMN rejection_reason TEXT NULL AFTER reviewed_at")

        # Ensure status enum supports all workflow statuses
        cursor.execute(
            "ALTER TABLE pending_applications MODIFY COLUMN status "
            "ENUM('PENDING','UNDER_REVIEW','APPROVED','WITHDRAWN','REJECTED','MANUAL_REVIEW','ACCEPTED') "
            "NOT NULL DEFAULT 'PENDING'"
        )
    except Exception as e:
        print(f"  note on pending_applications migration: {e}")


def seed_admin(cursor) -> None:
    """Seed the demo login and sample applicants so the UI is usable immediately."""
    try:
        import bcrypt  # type: ignore

        pw_hash = bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt(10)).decode()
    except Exception:
        # Precomputed cost-10 bcrypt hash of "admin123". bcryptjs on the Node
        # side verifies $2b$ hashes happily, so this fallback is equivalent.
        pw_hash = "$2b$10$OV0XfVoyT7z3bPdI6PO0A..HfNJcy2sHS4pxcJrHIGS82RpRWhhFi"

    users = [
        ("usr_admin_01", "Admin Official", "admin@prgi.gov", "+91 11 2338 0000",
         "Press Registrar General of India", pw_hash, "Administrator", 1),
        ("usr_inst_02", "Verification Officer", "officer@prgi.gov.in",
         "+91 11 2338 0001", "PRGI Title Verification Cell", pw_hash,
         "Verification Officer", 1),
        ("usr_app_01", "Rahul Sharma", "rahul.sharma@presscorp.in",
         "+91 98111 22334", "Sharma Media Group", pw_hash,
         "Verified Official", 1),
        ("usr_app_02", "Priya Mehta", "priya.mehta@nationalchronicle.org",
         "+91 98222 33445", "Chronicle Publications Ltd", pw_hash,
         "Verified Official", 1),
        ("usr_app_03", "Amit Kumar", "amit.kumar@expressnews.co.in",
         "+91 98333 44556", "Express Network India", pw_hash,
         "Verified Official", 1),
    ]
    cursor.executemany(
        """
        INSERT INTO users (id, username, email, mobile, organization,
                           password_hash, role, is_verified)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            username      = VALUES(username),
            password_hash = VALUES(password_hash),
            is_verified   = VALUES(is_verified)
        """,
        users,
    )
    print(f"  seeded demo users (admin@prgi.gov / {DEMO_PASSWORD})")

    # Seed sample pending applications with AI verification results for immediate demo review
    cursor.execute("SELECT COUNT(*) FROM pending_applications")
    if cursor.fetchone()[0] == 0:
        print("  seeding sample review applications ...")
        # 1. Daily News India
        cursor.execute(
            """
            INSERT INTO verification_results
              (tracking_id, user_id, submitted_title, normalized_title, language,
               publication_type, periodicity, publisher, publication_state,
               decision, similarity_score, verification_probability, confidence,
               explanation, explanation_source, findings, checks_passed, suggestions,
               agent_trace, engine, processing_ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "VER-2026-DNI01", "usr_app_01", "Daily News India", "DAILY NEWS INDIA",
                "English", "Newspaper", "Daily", "Sharma Media Group", "Delhi",
                "REVIEW", 87.00, 89.50, "HIGH",
                "The proposed title 'Daily News India' exhibits 87% similarity with existing registered publication 'Daily News'. The addition of the generic geographic suffix 'India' violates PRGI guideline Section 2.a (Disallowed Affixes) and requires administrative review.",
                "RULE_ENGINE",
                '[{"ruleId":"R07","ruleName":"DISALLOWED_AFFIX","severity":"MAJOR","message":"Generic geographic affix \'India\' appended to registered title \'Daily News\'."},{"ruleId":"R13","ruleName":"MODERATE_SIMILARITY","severity":"MAJOR","message":"Combined similarity score 87.0% exceeds review threshold."}]',
                '["R01: Exact duplicate checked","R02: Prohibited words checked","R04: Character set validated"]',
                '["Consider using a distinctive prefix/core such as \'Prabhat Daily News\'","Remove generic national affix"]',
                '[]', '{"mode":"FULL"}', 124.50
            )
        )
        ver_id_1 = cursor.lastrowid
        cursor.executemany(
            """
            INSERT INTO verification_matches
              (verification_id, rank_position, matched_title, registration_number,
               publisher, language, publication_state, source, similarity,
               semantic_score, reranker_score, fuzzy_score, phonetic_score, token_score, matched_via)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (ver_id_1, 1, "Daily News", "DEL/2018/14298", "Associated Press Ltd", "English", "Delhi", "REGISTERED", 87.00, 0.892, 0.910, 0.850, 0.800, 0.880, "AFFIX_MATCH,SEMANTIC"),
                (ver_id_1, 2, "Daily News India Today", "MAH/2020/22901", "Metropolis Media", "English", "Maharashtra", "REGISTERED", 81.00, 0.835, 0.812, 0.800, 0.780, 0.810, "SEMANTIC"),
                (ver_id_1, 3, "India Daily News", "UP/2019/33104", "Northern Publications", "English", "Uttar Pradesh", "REGISTERED", 76.00, 0.790, 0.750, 0.740, 0.750, 0.780, "SEMANTIC"),
                (ver_id_1, 4, "The Daily News", "WB/2017/09871", "Bengal Chronicle Group", "English", "West Bengal", "REGISTERED", 72.00, 0.740, 0.710, 0.720, 0.700, 0.730, "SEMANTIC"),
                (ver_id_1, 5, "Daily India", "TN/2021/44912", "Southern News Trust", "English", "Tamil Nadu", "REGISTERED", 68.00, 0.690, 0.670, 0.680, 0.650, 0.690, "TOKEN_OVERLAP"),
            ]
        )
        cursor.execute(
            """
            INSERT INTO pending_applications
              (application_ref, user_id, verification_id, title, normalized_title,
               language, periodicity, publisher, publication_state, status, submitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW() - INTERVAL 2 HOUR)
            """,
            ("APP-2026-DNI01", "usr_app_01", ver_id_1, "Daily News India", "DAILY NEWS INDIA",
             "English", "Daily", "Sharma Media Group", "Delhi", "PENDING")
        )

        # 2. National Chronicle
        cursor.execute(
            """
            INSERT INTO verification_results
              (tracking_id, user_id, submitted_title, normalized_title, language,
               publication_type, periodicity, publisher, publication_state,
               decision, similarity_score, verification_probability, confidence,
               explanation, explanation_source, findings, checks_passed, suggestions,
               agent_trace, engine, processing_ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "VER-2026-NC02", "usr_app_02", "National Chronicle", "NATIONAL CHRONICLE",
                "English", "Newspaper", "Daily", "Chronicle Publications Ltd", "Maharashtra",
                "REVIEW", 74.00, 78.00, "MEDIUM",
                "The proposed title 'National Chronicle' shares substantial semantic overlap (74%) with registered title 'National Chronicle India'. Manual review recommended.",
                "RULE_ENGINE",
                '[{"ruleId":"R13","ruleName":"MODERATE_SIMILARITY","severity":"MAJOR","message":"Similarity score 74.0% with registered publication."}]',
                '["R01: Exact duplicate checked","R02: Prohibited words checked"]',
                '["Add a distinctive local identifier"]',
                '[]', '{"mode":"FULL"}', 98.20
            )
        )
        ver_id_2 = cursor.lastrowid
        cursor.executemany(
            """
            INSERT INTO verification_matches
              (verification_id, rank_position, matched_title, registration_number,
               publisher, language, publication_state, source, similarity,
               semantic_score, reranker_score, fuzzy_score, phonetic_score, token_score, matched_via)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (ver_id_2, 1, "National Chronicle India", "MAH/2016/09912", "Chronicle Media", "English", "Maharashtra", "REGISTERED", 74.00, 0.770, 0.730, 0.720, 0.700, 0.780, "SEMANTIC"),
                (ver_id_2, 2, "The Chronicle", "DEL/2014/11092", "Apex Media", "English", "Delhi", "REGISTERED", 69.00, 0.710, 0.680, 0.650, 0.680, 0.700, "TOKEN_OVERLAP"),
                (ver_id_2, 3, "National Herald", "DEL/1948/00012", "Associated Journals Ltd", "English", "Delhi", "REGISTERED", 65.00, 0.680, 0.630, 0.620, 0.640, 0.670, "TOKEN_OVERLAP"),
            ]
        )
        cursor.execute(
            """
            INSERT INTO pending_applications
              (application_ref, user_id, verification_id, title, normalized_title,
               language, periodicity, publisher, publication_state, status, submitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW() - INTERVAL 4 HOUR)
            """,
            ("APP-2026-NC02", "usr_app_02", ver_id_2, "National Chronicle", "NATIONAL CHRONICLE",
             "English", "Daily", "Chronicle Publications Ltd", "Maharashtra", "PENDING")
        )

        # 3. India Today Express
        cursor.execute(
            """
            INSERT INTO verification_results
              (tracking_id, user_id, submitted_title, normalized_title, language,
               publication_type, periodicity, publisher, publication_state,
               decision, similarity_score, verification_probability, confidence,
               explanation, explanation_source, findings, checks_passed, suggestions,
               agent_trace, engine, processing_ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                "VER-2026-ITE03", "usr_app_03", "India Today Express", "INDIA TODAY EXPRESS",
                "English", "Newspaper", "Daily", "Express Network India", "Karnataka",
                "REJECT", 92.00, 94.00, "HIGH",
                "The proposed title 'India Today Express' combines two renowned registered titles ('India Today' and 'Indian Express'), violating PRGI guideline Section 3.c (Title Combination). Rejection recommended.",
                "RULE_ENGINE",
                '[{"ruleId":"R09","ruleName":"TITLE_COMBINATION","severity":"BLOCKER","message":"Unlawful combination of registered titles \'India Today\' and \'Express\'."},{"ruleId":"R12","ruleName":"HIGH_SIMILARITY","severity":"BLOCKER","message":"Similarity score 92.0% exceeds rejection threshold (85%)."}]',
                '["R01: Exact duplicate checked","R02: Prohibited words checked"]',
                '["Create a distinct non-compounded brand identity"]',
                '[]', '{"mode":"FULL"}', 142.10
            )
        )
        ver_id_3 = cursor.lastrowid
        cursor.executemany(
            """
            INSERT INTO verification_matches
              (verification_id, rank_position, matched_title, registration_number,
               publisher, language, publication_state, source, similarity,
               semantic_score, reranker_score, fuzzy_score, phonetic_score, token_score, matched_via)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (ver_id_3, 1, "India Today", "DEL/1975/02834", "Living Media India Ltd", "English", "Delhi", "REGISTERED", 92.00, 0.940, 0.930, 0.900, 0.880, 0.950, "TITLE_COMBINATION,SEMANTIC"),
                (ver_id_3, 2, "The Indian Express", "MAH/1953/00109", "Indian Express Ltd", "English", "Maharashtra", "REGISTERED", 84.00, 0.860, 0.840, 0.820, 0.810, 0.870, "SEMANTIC"),
            ]
        )
        cursor.execute(
            """
            INSERT INTO pending_applications
              (application_ref, user_id, verification_id, title, normalized_title,
               language, periodicity, publisher, publication_state, status, submitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW() - INTERVAL 1 DAY)
            """,
            ("APP-2026-ITE03", "usr_app_03", ver_id_3, "India Today Express", "INDIA TODAY EXPRESS",
             "English", "Daily", "Express Network India", "Karnataka", "PENDING")
        )
        print("  seeded sample review applications (Daily News India, National Chronicle, India Today Express)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-seed", action="store_true")
    parser.add_argument("--skip-normalize", action="store_true")
    args = parser.parse_args()

    db = os.getenv("MYSQL_DATABASE", "prgi")
    print(f"PSS06 database initialisation  (database: {db})")

    print("Step 1/4  ensuring the database exists ...")
    conn = connect(with_db=False)
    cur = conn.cursor()
    cur.execute(
        f"CREATE DATABASE IF NOT EXISTS {db} "
        "DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci"
    )
    conn.commit()
    cur.close()
    conn.close()

    conn = connect()
    cur = conn.cursor()

    print("Step 2/4  applying the schema and migrations ...")
    run_schema(cur)
    update_pending_applications_schema(cur)
    conn.commit()

    if not args.skip_normalize:
        print("Step 3/4  indexing normalised titles ...")
        add_normalized_column(cur)
        conn.commit()
    else:
        print("Step 3/4  skipped")

    if not args.no_seed:
        print("Step 4/4  seeding demo users and review queue ...")
        seed_admin(cur)
        conn.commit()
    else:
        print("Step 4/4  skipped")

    cur.execute("SELECT COUNT(*) FROM prgi_titles")
    titles = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM users")
    users = cur.fetchone()[0]

    print("-" * 56)
    print(f"  prgi_titles          : {titles} rows")
    print(f"  users                : {users} rows")
    print("  verification_results : ready")
    print("  verification_matches : ready")
    print("  pending_applications : ready")
    print("-" * 56)

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
