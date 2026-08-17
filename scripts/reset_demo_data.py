"""
PSS06 - Clear out test and demo activity.

Wipes the transactional tables so the dashboard and the admin review queue
start from a genuine zero. It never touches `prgi_titles` (the 160k registry)
and never touches `users`.

Usage:
    cd C:\\PSS06
    python scripts/reset_demo_data.py             # asks before deleting
    python scripts/reset_demo_data.py --yes       # no prompt
    python scripts/reset_demo_data.py --queue-only  # only the review queue

After running it, restart the AI service (or POST /ai/reload) so the in-memory
corpus drops the cleared pending titles.
"""

import argparse
import os
import sys
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Deliberately excludes prgi_titles and users.
ALL_TABLES = ["verification_matches", "verification_results", "pending_applications"]
QUEUE_TABLES = ["pending_applications"]


def connect():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "prgi"),
        charset="utf8mb4",
    )


def counts(cursor, tables):
    out = {}
    for t in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {t}")
            out[t] = cursor.fetchone()[0]
        except Exception:
            out[t] = 0
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="skip the confirmation")
    parser.add_argument("--queue-only", action="store_true",
                        help="clear only pending_applications")
    args = parser.parse_args()

    tables = QUEUE_TABLES if args.queue_only else ALL_TABLES

    conn = connect()
    cur = conn.cursor()

    before = counts(cur, ALL_TABLES)
    print("Current contents:")
    for t, n in before.items():
        mark = "  will be cleared" if t in tables else "  kept"
        print(f"  {t:<24} {n:>6} rows{mark}")

    cur.execute("SELECT COUNT(*) FROM prgi_titles")
    print(f"  {'prgi_titles':<24} {cur.fetchone()[0]:>6} rows  kept (the registry)")
    cur.execute("SELECT COUNT(*) FROM users")
    print(f"  {'users':<24} {cur.fetchone()[0]:>6} rows  kept")

    if not any(before[t] for t in tables):
        print("\nNothing to clear.")
        cur.close(); conn.close()
        return 0

    if not args.yes:
        print()
        if input("Delete the rows marked above? [y/N] ").strip().lower() not in ("y", "yes"):
            print("Cancelled.")
            cur.close(); conn.close()
            return 1

    # verification_matches has a FK onto verification_results, so order matters.
    cur.execute("SET FOREIGN_KEY_CHECKS = 0")
    for t in tables:
        cur.execute(f"TRUNCATE TABLE {t}")
        print(f"  cleared {t}")
    cur.execute("SET FOREIGN_KEY_CHECKS = 1")
    conn.commit()

    print("\nDone. Restart the AI service (or POST /ai/reload) so the in-memory")
    print("corpus forgets the cleared pending titles.")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
