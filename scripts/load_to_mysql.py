import os

import mysql.connector
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

CSV_PATH = "data/processed/prgi_titles.csv"

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS prgi_titles (
    registration_number VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    registration_date DATE NULL,
    language VARCHAR(50),
    periodicity VARCHAR(100),
    publisher VARCHAR(255),
    owner VARCHAR(255),
    publication_state VARCHAR(100),
    publication_district VARCHAR(100),
    INDEX idx_title (title)
)
"""

INSERT_SQL = """
INSERT INTO prgi_titles (
    registration_number, title, registration_date, language,
    periodicity, publisher, owner, publication_state, publication_district
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
    title = VALUES(title),
    registration_date = VALUES(registration_date),
    language = VALUES(language),
    periodicity = VALUES(periodicity),
    publisher = VALUES(publisher),
    owner = VALUES(owner),
    publication_state = VALUES(publication_state),
    publication_district = VALUES(publication_district)
"""


def main():
    host = os.environ["MYSQL_HOST"]
    port = int(os.environ.get("MYSQL_PORT", 3306))
    user = os.environ["MYSQL_USER"]
    password = os.environ["MYSQL_PASSWORD"]
    database = os.environ["MYSQL_DATABASE"]

    df = pd.read_csv(CSV_PATH)
    df = df.where(pd.notnull(df), None)

    conn = mysql.connector.connect(host=host, port=port, user=user, password=password)
    cursor = conn.cursor()
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {database}")
    conn.commit()
    cursor.execute(f"USE {database}")
    cursor.execute(CREATE_TABLE_SQL)
    conn.commit()

    rows = list(
        df[
            [
                "registration_number",
                "title",
                "registration_date",
                "language",
                "periodicity",
                "publisher",
                "owner",
                "publication_state",
                "publication_district",
            ]
        ].itertuples(index=False, name=None)
    )

    cursor.executemany(INSERT_SQL, rows)
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM prgi_titles")
    count = cursor.fetchone()[0]
    print(f"prgi_titles table now has {count} rows")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    main()
