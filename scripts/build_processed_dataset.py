import glob
import re

import pandas as pd

RAW_GLOB = "data/raw/*.csv"
OUTPUT_PATH = "data/processed/prgi_titles.csv"

COLUMN_MAP = {
    "SN.": "sn",
    "Title": "title",
    "Registration Number": "registration_number",
    "Registration Date": "registration_date",
    "Language": "language",
    "Periodicity": "periodicity",
    "Publisher": "publisher",
    "Owner": "owner",
    "Publication State": "publication_state",
    "Publication District": "publication_district",
}

STRING_COLUMNS = [
    "title",
    "registration_number",
    "language",
    "periodicity",
    "publisher",
    "owner",
    "publication_state",
    "publication_district",
]


def load_all_csvs(pattern: str) -> pd.DataFrame:
    files = sorted(glob.glob(pattern))
    if not files:
        raise FileNotFoundError(f"No CSV files found matching {pattern}")
    frames = [pd.read_csv(f) for f in files]
    combined = pd.concat(frames, ignore_index=True)
    print(f"Loaded {len(files)} files, {len(combined)} raw rows")
    return combined


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns=COLUMN_MAP)
    df = df.drop(columns=["sn"])

    for col in STRING_COLUMNS:
        df[col] = df[col].astype("string").str.strip()
        df[col] = df[col].replace("", pd.NA)

    df["registration_date"] = pd.to_datetime(
        df["registration_date"], format="%d-%m-%Y", errors="coerce"
    ).dt.date

    return df


def normalize_titles(df: pd.DataFrame) -> pd.DataFrame:
    def normalize(title: str) -> str:
        title = re.sub(r"\s+", " ", title).strip()
        return title.upper()

    df["title"] = df["title"].apply(normalize)
    return df


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df.drop_duplicates()
    after_full = len(df)
    df = df.drop_duplicates(subset=["registration_number"], keep="first")
    after_reg = len(df)
    print(f"Dropped {before - after_full} exact duplicate rows")
    print(f"Dropped {after_full - after_reg} duplicate registration_number rows")
    return df


def main():
    df = load_all_csvs(RAW_GLOB)
    df = clean(df)
    df = normalize_titles(df)
    df = deduplicate(df)
    df = df.sort_values("title").reset_index(drop=True)

    import os

    os.makedirs("data/processed", exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\nFinal processed dataset: {len(df)} rows, {len(df.columns)} columns")
    print(f"Saved to {OUTPUT_PATH}")
    print("\nNull counts:")
    print(df.isnull().sum())


if __name__ == "__main__":
    main()
