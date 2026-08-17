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


# Ordered, and with no AFTER clause: an AFTER referring to a column that does
# not exist yet fails, and on an older database none of these exist.
REVIEW_COLUMNS = [
    ("reviewed_by", "ADD COLUMN reviewed_by VARCHAR(64) NULL"),
    ("reviewed_at", "ADD COLUMN reviewed_at DATETIME NULL"),
    ("rejection_reason", "ADD COLUMN rejection_reason TEXT NULL"),
    ("review_reason", "ADD COLUMN review_reason TEXT NULL"),
]


def migrate_review_columns(cursor) -> None:
    """
    Bring an existing pending_applications table up to date without dropping it.

    CREATE TABLE IF NOT EXISTS silently does nothing when the table already
    exists, so new columns have to be added explicitly. Each ALTER is guarded
    by a column check, which makes running this script twice harmless.
    """
    for column, clause in REVIEW_COLUMNS:
        cursor.execute(f"SHOW COLUMNS FROM pending_applications LIKE '{column}'")
        if cursor.fetchone() is None:
            cursor.execute(f"ALTER TABLE pending_applications {clause}")
            print(f"  added pending_applications.{column}")

    # The review queue needs MANUAL_REVIEW / ACCEPTED in the status enum.
    cursor.execute("SHOW COLUMNS FROM pending_applications LIKE 'status'")
    row = cursor.fetchone()
    if row and "MANUAL_REVIEW" not in str(row[1]):
        cursor.execute(
            "ALTER TABLE pending_applications MODIFY COLUMN status "
            "ENUM('PENDING','UNDER_REVIEW','MANUAL_REVIEW','APPROVED',"
            "'ACCEPTED','WITHDRAWN','REJECTED') NOT NULL DEFAULT 'PENDING'"
        )
        print("  widened pending_applications.status enum")


def seed_admin(cursor) -> None:
    """Seed the demo login so the UI is usable immediately."""
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

    print("Step 2/4  applying the schema ...")
    run_schema(cur)
    migrate_review_columns(cur)
    conn.commit()

    if not args.skip_normalize:
        print("Step 3/4  indexing normalised titles ...")
        add_normalized_column(cur)
        conn.commit()
    else:
        print("Step 3/4  skipped")

    if not args.no_seed:
        print("Step 4/4  seeding demo users ...")
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
