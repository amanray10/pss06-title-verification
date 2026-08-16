"""
PSS06 - Title normalisation.

Everything downstream (exact match, phonetics, fuzzy, embeddings) works on a
consistently normalised string, so this module is the single source of truth
for "what does this title really say".
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Set

from rules.lexicons import (
    GENERIC_PREFIXES,
    GENERIC_SUFFIXES,
    PERIODICITY_WORDS,
    STOP_WORDS,
    TRANSLITERATION_VARIANTS,
    concept_of,
)

_PUNCT_RE = re.compile(r"[^\w\sऀ-෿؀-ۿ]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")


@dataclass
class NormalizedTitle:
    """Everything the rule engine needs to know about one title string."""

    raw: str
    normalized: str                       # upper-case, punctuation-free
    tokens: List[str] = field(default_factory=list)
    core_tokens: List[str] = field(default_factory=list)   # affixes stripped
    concept_tokens: List[str] = field(default_factory=list)  # language-neutral
    stripped_prefixes: List[str] = field(default_factory=list)
    stripped_suffixes: List[str] = field(default_factory=list)
    periodicity_tokens: List[str] = field(default_factory=list)
    phonetic_key: str = ""
    collapsed: str = ""                   # transliteration-collapsed skeleton

    @property
    def core(self) -> str:
        return " ".join(self.core_tokens)

    @property
    def concept(self) -> str:
        return " ".join(self.concept_tokens)

    @property
    def has_distinctive_core(self) -> bool:
        """True when the core still holds a word that is not registry boilerplate."""
        return any(not is_generic(t) for t in self.core_tokens)

    @property
    def token_set(self) -> Set[str]:
        return set(self.tokens)

    @property
    def core_set(self) -> Set[str]:
        return set(self.core_tokens)

    @property
    def concept_set(self) -> Set[str]:
        return set(self.concept_tokens)


def basic_normalize(title: str) -> str:
    """Unicode-normalise, strip punctuation, collapse whitespace, upper-case."""
    if title is None:
        return ""
    text = unicodedata.normalize("NFKC", str(title))
    text = text.replace("&", " AND ")
    text = _PUNCT_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text).strip()
    return text.upper()


def tokenize(normalized: str) -> List[str]:
    return [t for t in normalized.lower().split(" ") if t and t not in STOP_WORDS]


def collapse_transliteration(text: str) -> str:
    """
    Squash spelling variants that mean the same sound.

    "NAMASKAR" and "NAMASCAR" both collapse to the same skeleton, which is how
    requirement 1.c ("slight modifications must not bypass the check") is met
    even when the two strings are phonetically encoded differently.
    """
    s = text.lower()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    for src, dst in TRANSLITERATION_VARIANTS:
        s = s.replace(src, dst)
    # squeeze repeated letters: "khhabar" -> "khabar"
    s = re.sub(r"(.)\1+", r"\1", s)
    # drop most vowels - Indic transliterations disagree about them constantly
    s = re.sub(r"(?<!^)[aeiou]", "", s)
    return _SPACE_RE.sub(" ", s).strip()


MAX_AFFIX_STRIP = 2


def is_generic(token: str) -> bool:
    return (token in GENERIC_PREFIXES
            or token in GENERIC_SUFFIXES
            or token in PERIODICITY_WORDS)


def strip_generic_affixes(tokens: List[str]):
    """
    Remove leading generic prefixes and trailing generic suffixes.

    Returns (core_tokens, stripped_prefixes, stripped_suffixes).

    Two safety rails, both learned the hard way on real PRGI data:
      * at most two words are removed from each end, and
      * a word is only removed while something distinctive still remains.
    Without them "Dainik Bharat Ka Amar Samachar" collapses all the way down to
    "Samachar", and every newspaper in the country then looks like a duplicate.
    """
    core = list(tokens)
    prefixes: List[str] = []
    suffixes: List[str] = []

    def something_left(rest: List[str]) -> bool:
        return any(not is_generic(t) for t in rest)

    while (len(core) > 1 and len(prefixes) < MAX_AFFIX_STRIP
           and core[0] in GENERIC_PREFIXES and something_left(core[1:])):
        prefixes.append(core.pop(0))

    while (len(core) > 1 and len(suffixes) < MAX_AFFIX_STRIP
           and core[-1] in GENERIC_SUFFIXES and something_left(core[:-1])):
        suffixes.append(core.pop())

    if not core:
        core = list(tokens)
    return core, prefixes, suffixes


def extract_periodicity(tokens: List[str]) -> List[str]:
    return [t for t in tokens if t in PERIODICITY_WORDS]


def normalize_title(title: str) -> NormalizedTitle:
    """Full normalisation pipeline for a single title."""
    from rules.phonetics import phonetic_key  # local import avoids a cycle

    normalized = basic_normalize(title)
    tokens = tokenize(normalized)
    core_tokens, pre, suf = strip_generic_affixes(tokens)

    return NormalizedTitle(
        raw=title or "",
        normalized=normalized,
        tokens=tokens,
        core_tokens=core_tokens,
        # Concepts are derived from the FULL token list, not the core. Affix
        # stripping is English-biased ("Daily" is a generic prefix, "Pratidin"
        # is not), so stripping first would stop "Daily Evening" and
        # "Pratidin Sandhya" from ever meeting in concept space.
        concept_tokens=[concept_of(t) for t in tokens],
        stripped_prefixes=pre,
        stripped_suffixes=suf,
        periodicity_tokens=extract_periodicity(tokens),
        phonetic_key=phonetic_key(" ".join(core_tokens)),
        collapsed=collapse_transliteration(" ".join(core_tokens)),
    )
