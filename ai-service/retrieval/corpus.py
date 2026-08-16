"""
PSS06 - The title corpus and its symbolic indices.

Beyond the vector index, the corpus keeps a set of cheap in-memory lookup
structures. They are what make the deterministic rules fast on 160,000 rows:

  exact_index      normalised string      -> corpus rows   (Rule 1)
  tokenstr_index   stop-word-free tokens  -> corpus rows   (Rules 3.c, 3.e)
  core_index       affix-stripped core    -> corpus rows   (Rules 2, 3.e)
  phonetic_index   Metaphone signature    -> corpus rows   (Rule 1.a)
  collapsed_index  transliteration skel.  -> corpus rows   (Rule 1.c)
  token_index      token                  -> corpus rows   (Rule 3.c blocking)
  concept_index    language-neutral core  -> corpus rows   (Rule 3.d)

All of them are O(1) dictionary hits, so candidate generation stays fast as
the registry grows.
"""

import csv
import logging
import pickle
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import config
from preprocessing.normalizer import NormalizedTitle, normalize_title

log = logging.getLogger("pss06.corpus")

CACHE_PATH = Path(config.MODELS_DIR) / "corpus_cache.pkl"


@dataclass
class TitleRecord:
    """One registered (or pending) publication title."""

    row_id: int
    title: str
    registration_number: str = ""
    registration_date: Optional[str] = None
    language: str = ""
    periodicity: str = ""
    publisher: str = ""
    owner: str = ""
    publication_state: str = ""
    publication_district: str = ""
    source: str = "REGISTERED"          # REGISTERED | PENDING
    norm: NormalizedTitle = field(default=None, repr=False)

    def to_metadata(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "registrationNumber": self.registration_number,
            "registrationDate": str(self.registration_date) if self.registration_date else None,
            "language": self.language,
            "periodicity": self.periodicity,
            "publisher": self.publisher,
            "owner": self.owner,
            "state": self.publication_state,
            "district": self.publication_district,
            "source": self.source,
        }


class TitleCorpus:
    """In-memory corpus with the symbolic indices built over it."""

    def __init__(self, records: List[TitleRecord]):
        self.records: List[TitleRecord] = records
        self.exact_index: Dict[str, List[int]] = defaultdict(list)
        self.tokenstr_index: Dict[str, List[int]] = defaultdict(list)
        self.core_index: Dict[str, List[int]] = defaultdict(list)
        self.phonetic_index: Dict[str, List[int]] = defaultdict(list)
        self.collapsed_index: Dict[str, List[int]] = defaultdict(list)
        self.token_index: Dict[str, List[int]] = defaultdict(list)
        self.concept_index: Dict[str, List[int]] = defaultdict(list)
        # Applications still in the queue - always compared against, because
        # the queue is small and requirement 5.b says they must block later
        # look-alike submissions.
        self.pending_ids: List[int] = []
        self._build_indices()

    # -- construction ----------------------------------------------------
    def _build_indices(self) -> None:
        for rec in self.records:
            if rec.norm is None:
                rec.norm = normalize_title(rec.title)
            self._index_record(rec)
        log.info(
            "Corpus indices built: %d titles, %d distinct cores, %d phonetic keys",
            len(self.records), len(self.core_index), len(self.phonetic_index),
        )

    def _index_record(self, rec: TitleRecord) -> None:
        n = rec.norm
        self.exact_index[n.normalized].append(rec.row_id)
        token_str = " ".join(n.tokens)
        if token_str:
            self.tokenstr_index[token_str].append(rec.row_id)
        if n.core:
            self.core_index[n.core].append(rec.row_id)
        if n.phonetic_key:
            self.phonetic_index[n.phonetic_key].append(rec.row_id)
        if n.collapsed:
            self.collapsed_index[n.collapsed].append(rec.row_id)
        if n.concept:
            self.concept_index[n.concept].append(rec.row_id)
        for tok in set(n.tokens):
            self.token_index[tok].append(rec.row_id)
        if rec.source == "PENDING":
            self.pending_ids.append(rec.row_id)

    # -- accessors -------------------------------------------------------
    def __len__(self) -> int:
        return len(self.records)

    def get(self, row_id: int) -> TitleRecord:
        return self.records[row_id]

    def texts(self) -> List[str]:
        """Text fed to the encoder - the normalised form, not the raw string."""
        return [r.norm.normalized for r in self.records]

    def raw_titles(self) -> List[str]:
        return [r.title for r in self.records]

    # -- symbolic lookups ------------------------------------------------
    def exact_matches(self, norm: NormalizedTitle) -> List[int]:
        ids = list(self.exact_index.get(norm.normalized, []))
        if not ids:
            ids = list(self.tokenstr_index.get(" ".join(norm.tokens), []))
        return ids

    def token_string_matches(self, tokens: Iterable[str]) -> List[int]:
        """Rows whose stop-word-free token string is exactly `tokens`."""
        return list(self.tokenstr_index.get(" ".join(tokens), []))

    def core_matches(self, norm: NormalizedTitle) -> List[int]:
        return list(self.core_index.get(norm.core, []))

    def phonetic_matches(self, norm: NormalizedTitle) -> List[int]:
        return list(self.phonetic_index.get(norm.phonetic_key, []))

    def collapsed_matches(self, norm: NormalizedTitle) -> List[int]:
        return list(self.collapsed_index.get(norm.collapsed, []))

    def concept_matches(self, norm: NormalizedTitle) -> List[int]:
        return list(self.concept_index.get(norm.concept, []))

    def token_candidates(self, norm: NormalizedTitle, limit: int = 400) -> List[int]:
        """
        Lexical blocking: gather rows that share at least one token, preferring
        the rarest tokens so we never scan a posting list for a word like
        "NEWS" that appears in tens of thousands of titles.
        """
        postings = sorted(
            (self.token_index.get(t, []) for t in set(norm.tokens)),
            key=len,
        )
        seen: Set[int] = set()
        for plist in postings:
            if len(plist) > 5000:          # far too generic to be informative
                continue
            for row_id in plist:
                seen.add(row_id)
                if len(seen) >= limit:
                    return list(seen)
        return list(seen)

    def rows_containing_all(self, tokens: Iterable[str], limit: int = 200) -> List[int]:
        """Rows whose token set is a superset of `tokens` (used by Rule 3.c)."""
        tokens = [t for t in tokens if t in self.token_index]
        if not tokens:
            return []
        postings = sorted((set(self.token_index[t]) for t in tokens), key=len)
        result = postings[0]
        for p in postings[1:]:
            result = result & p
            if not result:
                return []
        return list(result)[:limit]

    # -- live growth (requirement 5.b / 7) -------------------------------
    def add_records(self, records: List[TitleRecord]) -> List[int]:
        """Append records (e.g. freshly submitted pending applications)."""
        added = []
        for rec in records:
            rec.row_id = len(self.records)
            if rec.norm is None:
                rec.norm = normalize_title(rec.title)
            self.records.append(rec)
            self._index_record(rec)
            added.append(rec.row_id)
        return added

    # -- persistence -----------------------------------------------------
    def save_cache(self, path: Path = CACHE_PATH) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as fh:
            pickle.dump(self.records, fh, protocol=pickle.HIGHEST_PROTOCOL)
        log.info("Corpus cache written -> %s", path)

    @classmethod
    def load_cache(cls, path: Path = CACHE_PATH) -> Optional["TitleCorpus"]:
        path = Path(path)
        if not path.exists():
            return None
        try:
            with path.open("rb") as fh:
                records = pickle.load(fh)
            log.info("Corpus cache loaded (%d records)", len(records))
            return cls(records)
        except Exception as exc:  # noqa: BLE001
            log.warning("Corpus cache unusable (%s)", exc)
            return None


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def _record_from_row(row_id: int, row: Dict[str, Any], source: str) -> TitleRecord:
    return TitleRecord(
        row_id=row_id,
        title=str(row.get("title") or "").strip(),
        registration_number=str(row.get("registration_number")
                                or row.get("application_ref") or "").strip(),
        registration_date=row.get("registration_date") or row.get("submitted_at"),
        language=str(row.get("language") or "").strip(),
        periodicity=str(row.get("periodicity") or "").strip(),
        publisher=str(row.get("publisher") or "").strip(),
        owner=str(row.get("owner") or "").strip(),
        publication_state=str(row.get("publication_state") or "").strip(),
        publication_district=str(row.get("publication_district") or "").strip(),
        source=source,
    )


def load_corpus(use_cache: bool = True) -> TitleCorpus:
    """
    Load registered titles from MySQL, falling back to the processed CSV, and
    append any live pending applications on top.
    """
    from db import mysql as dbm

    rows = dbm.load_registered_titles()
    origin = "mysql"

    if not rows:
        origin = "csv"
        csv_path = Path(config.PROCESSED_CSV)
        if not csv_path.exists():
            raise FileNotFoundError(
                f"No corpus available: MySQL unreachable and {csv_path} missing"
            )
        with csv_path.open("r", encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        log.info("Loaded %d registered titles from %s", len(rows), csv_path)

    records = [
        _record_from_row(i, row, "REGISTERED")
        for i, row in enumerate(rows)
        if str(row.get("title") or "").strip()
    ]
    for i, rec in enumerate(records):
        rec.row_id = i

    # Reuse cached normalisations when the registry has not changed. Metaphone
    # over 160,000 titles is not free, and this turns a ~20 s boot into ~2 s.
    if use_cache:
        cached = TitleCorpus.load_cache()
        if (cached is not None
                and len(cached.records) >= len(records)
                and [r.title for r in cached.records[:len(records)]]
                == [r.title for r in records]):
            log.info("Reusing cached normalisations for %d titles", len(records))
            corpus = TitleCorpus(cached.records[:len(records)])
        else:
            corpus = TitleCorpus(records)
    else:
        corpus = TitleCorpus(records)

    pending = dbm.load_pending_applications()
    if pending:
        corpus.add_records([
            _record_from_row(0, p, "PENDING") for p in pending
            if str(p.get("title") or "").strip()
        ])
        log.info("Added %d pending applications to the corpus", len(pending))

    log.info("Corpus ready (%d titles, source=%s)", len(corpus), origin)
    return corpus
