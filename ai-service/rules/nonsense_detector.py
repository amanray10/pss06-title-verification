"""
rules/nonsense_detector.py

Detects titles that carry no linguistic meaning at all - keyboard mashes,
alphabet/number runs, single repeated characters, or token sequences that are
phonotactically implausible in any language ("abcd", "xkjq", "qwerty").

Two independent signals are combined:

  1. Fast, deterministic pattern checks (keyboard rows, alphabet/number runs,
     repeated characters) - catch the obvious cases cheaply, before the model
     is even touched.
  2. A character-trigram language model fit on every token that already
     exists in the PRGI corpus. Because the corpus holds ~160,000 titles
     across English and transliterated regional languages, the model learns
     what a *plausible* word looks like in this domain - not just English
     dictionary words. A token the model has never seen but that still
     "sounds like" a word (e.g. an invented brand name such as "Zomato") is
     scored as plausible; a token whose letters do not co-occur naturally
     ("abcd", "kjhqz") scores far below the corpus average and is flagged.

This intentionally does NOT reject every out-of-vocabulary token - PRGI
applicants routinely coin new words, and doing so is exactly what they are
allowed to do. It only rejects tokens that are actually random.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

# ---------------------------------------------------------------------------
# Fast deterministic checks
# ---------------------------------------------------------------------------

_KEYBOARD_ROWS = [
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    "1234567890",
]


def _keyboard_runs(min_len: int = 4) -> set:
    runs = set()
    for row in _KEYBOARD_ROWS:
        for i in range(len(row) - min_len + 1):
            runs.add(row[i:i + min_len])
            runs.add(row[i:i + min_len][::-1])
    return runs


_KEYBOARD_RUN_SET = _keyboard_runs()

_ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def _alphabet_runs(min_len: int = 4) -> set:
    runs = set()
    for i in range(len(_ALPHABET) - min_len + 1):
        runs.add(_ALPHABET[i:i + min_len])
        runs.add(_ALPHABET[i:i + min_len][::-1])
    return runs


_ALPHABET_RUN_SET = _alphabet_runs()

_REPEATED_CHAR = re.compile(r"^(.)\1{2,}$")     # aaa, xxxx
_ALTERNATING_PAIR = re.compile(r"^(..)\1{1,}$")  # abab, xyxy


def pattern_is_gibberish(token: str) -> bool:
    """Cheap, deterministic gibberish checks - no model needed."""
    t = token.lower()
    if len(t) < 3:
        return False
    if _REPEATED_CHAR.match(t) or _ALTERNATING_PAIR.match(t):
        return True
    for length in (4, 5, 6):
        for i in range(0, max(1, len(t) - length + 1)):
            chunk = t[i:i + length]
            if len(chunk) == length and chunk in (_KEYBOARD_RUN_SET | _ALPHABET_RUN_SET):
                return True
    return False


# ---------------------------------------------------------------------------
# Character n-gram plausibility model
# ---------------------------------------------------------------------------

@dataclass
class NgramModel:
    order: int
    counts: Dict[str, Dict[str, int]]
    totals: Dict[str, int]
    vocab_size: int
    corpus_vocab: set

    def score(self, token: str) -> float:
        """
        Average negative log-probability per character transition.
        Lower = more plausible. High = the letters do not co-occur the way
        they do in any real word this model has seen.
        """
        t = f"^{token.lower()}$"
        if len(t) <= self.order:
            return 0.0
        nll = 0.0
        n = 0
        for i in range(len(t) - self.order):
            ctx = t[i:i + self.order]
            nxt = t[i + self.order]
            ctx_counts = self.counts.get(ctx, {})
            total = self.totals.get(ctx, 0)
            # Laplace smoothing over the observed alphabet
            prob = (ctx_counts.get(nxt, 0) + 1) / (total + self.vocab_size)
            nll += -math.log(prob)
            n += 1
        return nll / max(n, 1)


def fit_ngram_model(tokens: Iterable[str], order: int = 2) -> NgramModel:
    """
    Fit a character n-gram model over every distinct token in the corpus.
    Call this once at startup (alongside build_faiss_index.py) and cache the
    result - it does not need to be rebuilt per request. With ~160,000
    titles this fits in well under a second.
    """
    counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals: Dict[str, int] = defaultdict(int)
    alphabet = set("^$")
    vocab = set()

    for tok in tokens:
        tok = (tok or "").lower().strip()
        if not tok:
            continue
        vocab.add(tok)
        t = f"^{tok}$"
        alphabet.update(t)
        for i in range(len(t) - order):
            ctx = t[i:i + order]
            nxt = t[i + order]
            counts[ctx][nxt] += 1
            totals[ctx] += 1

    return NgramModel(
        order=order,
        counts={k: dict(v) for k, v in counts.items()},
        totals=dict(totals),
        vocab_size=max(len(alphabet), 1),
        corpus_vocab=vocab,
    )


# ---------------------------------------------------------------------------
# Public entry points (used by rules/title_rules.py)
# ---------------------------------------------------------------------------

def token_is_meaningless(token: str, model: NgramModel,
                          threshold: float) -> Tuple[bool, float]:
    """
    A token is treated as meaningless if:
      * it matches one of the fast deterministic patterns, OR
      * it has never appeared in the corpus AND the n-gram model finds its
        letter sequence implausible (score above threshold).
    A token already present in the corpus vocabulary is never flagged - it
    is, by definition, a word someone has already used in a registered title.
    """
    t = token.lower()
    if pattern_is_gibberish(t):
        return True, 999.0
    if t in model.corpus_vocab:
        return False, 0.0
    score = model.score(t)
    return score >= threshold, score


def title_is_meaningless(tokens: List[str], model: NgramModel,
                          threshold: float) -> Tuple[bool, List[Tuple[str, float]]]:
    """
    A title is flagged only if EVERY distinctive token in it is meaningless.
    One real word next to a gibberish one is a different (lesser) problem -
    this rule targets titles that carry no meaning whatsoever, e.g. "abcd",
    "xyzq wsdrf", "qwerty".
    """
    if not tokens:
        return False, []
    flags = [token_is_meaningless(t, model, threshold) for t in tokens]
    all_meaningless = all(f for f, _ in flags)
    detail = list(zip(tokens, [s for _, s in flags]))
    return all_meaningless, detail