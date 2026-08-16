"""
PSS06 - Phonetic and fuzzy string similarity (requirement 1.a and 1.c).

Soundex and Metaphone are implemented locally so the service has no hard
dependency on `jellyfish`/`fuzzy` - if `jellyfish` is installed we use its
faster, better-tested implementations instead.
"""

import re
from difflib import SequenceMatcher
from typing import List

try:  # optional acceleration
    import jellyfish  # type: ignore

    HAS_JELLYFISH = True
except Exception:  # pragma: no cover
    jellyfish = None
    HAS_JELLYFISH = False


_NON_ALPHA = re.compile(r"[^A-Z]")


# ---------------------------------------------------------------------------
# Soundex
# ---------------------------------------------------------------------------
_SOUNDEX_MAP = {
    **dict.fromkeys("BFPV", "1"),
    **dict.fromkeys("CGJKQSXZ", "2"),
    **dict.fromkeys("DT", "3"),
    **dict.fromkeys("L", "4"),
    **dict.fromkeys("MN", "5"),
    **dict.fromkeys("R", "6"),
}


def soundex(word: str) -> str:
    """Classic Russell Soundex, 4 characters."""
    if not word:
        return ""
    if HAS_JELLYFISH:
        try:
            return jellyfish.soundex(word)
        except Exception:
            pass

    w = _NON_ALPHA.sub("", word.upper())
    if not w:
        return ""

    first, rest = w[0], w[1:]
    encoded = first
    prev_code = _SOUNDEX_MAP.get(first, "")

    for ch in rest:
        code = _SOUNDEX_MAP.get(ch, "")
        if ch in "HW":
            continue                       # H and W are transparent
        if code and code != prev_code:
            encoded += code
        prev_code = code if ch not in "AEIOUY" else ""
        if len(encoded) == 4:
            break

    return (encoded + "000")[:4]


# ---------------------------------------------------------------------------
# Metaphone (compact implementation, sufficient for title matching)
# ---------------------------------------------------------------------------
_VOWELS = set("AEIOU")


def metaphone(word: str) -> str:
    """A pragmatic Metaphone: good enough to catch Namaskar / Namascar."""
    if not word:
        return ""
    if HAS_JELLYFISH:
        try:
            return jellyfish.metaphone(word)
        except Exception:
            pass

    w = _NON_ALPHA.sub("", word.upper())
    if not w:
        return ""

    # Initial-letter exceptions
    for pair, repl in (("AE", "E"), ("GN", "N"), ("KN", "N"),
                       ("PN", "N"), ("WR", "R"), ("PS", "S")):
        if w.startswith(pair):
            w = repl + w[2:]
            break
    if w.startswith("X"):
        w = "S" + w[1:]
    if w.startswith("WH"):
        w = "W" + w[2:]

    out: List[str] = []
    i, n = 0, len(w)
    while i < n:
        ch = w[i]
        nxt = w[i + 1] if i + 1 < n else ""
        prv = w[i - 1] if i else ""

        if ch == prv and ch != "C":        # skip doubled letters
            i += 1
            continue

        if ch in _VOWELS:
            if i == 0:
                out.append(ch)
        elif ch == "B":
            if not (i == n - 1 and prv == "M"):
                out.append("B")
        elif ch == "C":
            if nxt == "I" and w[i + 2:i + 3] == "A":
                out.append("X")
            elif nxt == "H":
                out.append("X")
                i += 1
            elif nxt in "IEY":
                out.append("S")
            else:
                out.append("K")
        elif ch == "D":
            if nxt == "G" and w[i + 2:i + 3] in "IEY":
                out.append("J")
                i += 2
            else:
                out.append("T")
        elif ch == "G":
            if nxt == "H":
                if not (i + 2 >= n or w[i + 2] in _VOWELS):
                    i += 1
                else:
                    out.append("K")
                    i += 1
            elif nxt == "N":
                pass
            elif nxt in "IEY":
                out.append("J")
            else:
                out.append("K")
        elif ch == "H":
            if prv in _VOWELS and nxt not in _VOWELS:
                pass
            else:
                out.append("H")
        elif ch in "FJLMNR":
            out.append(ch)
        elif ch == "K":
            if prv != "C":
                out.append("K")
        elif ch == "P":
            out.append("F" if nxt == "H" else "P")
        elif ch == "Q":
            out.append("K")
        elif ch == "S":
            if nxt == "H":
                out.append("X")
                i += 1
            elif nxt == "I" and w[i + 2:i + 3] in "OA":
                out.append("X")
            else:
                out.append("S")
        elif ch == "T":
            if nxt == "H":
                out.append("0")
                i += 1
            elif nxt == "I" and w[i + 2:i + 3] in "OA":
                out.append("X")
            else:
                out.append("T")
        elif ch == "V":
            out.append("F")
        elif ch == "W" or ch == "Y":
            if nxt in _VOWELS:
                out.append(ch)
        elif ch == "X":
            out.append("KS")
        elif ch == "Z":
            out.append("S")
        i += 1

    return "".join(out)


def phonetic_key(text: str) -> str:
    """Space-joined Metaphone code for every token - the title's 'sound'."""
    return " ".join(metaphone(tok) for tok in text.split() if tok)


def soundex_key(text: str) -> str:
    return " ".join(soundex(tok) for tok in text.split() if tok)


# ---------------------------------------------------------------------------
# Similarity measures
# ---------------------------------------------------------------------------
def jaro_winkler(a: str, b: str) -> float:
    """Jaro-Winkler similarity in [0, 1]."""
    if HAS_JELLYFISH:
        try:
            return float(jellyfish.jaro_winkler_similarity(a, b))
        except Exception:
            pass

    if a == b:
        return 1.0
    if not a or not b:
        return 0.0

    match_window = max(len(a), len(b)) // 2 - 1
    match_window = max(match_window, 0)
    a_flags = [False] * len(a)
    b_flags = [False] * len(b)
    matches = 0

    for i, ca in enumerate(a):
        start = max(0, i - match_window)
        end = min(i + match_window + 1, len(b))
        for j in range(start, end):
            if not b_flags[j] and b[j] == ca:
                a_flags[i] = b_flags[j] = True
                matches += 1
                break

    if matches == 0:
        return 0.0

    transpositions, k = 0, 0
    for i, flag in enumerate(a_flags):
        if flag:
            while not b_flags[k]:
                k += 1
            if a[i] != b[k]:
                transpositions += 1
            k += 1
    transpositions //= 2

    jaro = (matches / len(a) + matches / len(b)
            + (matches - transpositions) / matches) / 3.0

    prefix = 0
    for ca, cb in zip(a[:4], b[:4]):
        if ca != cb:
            break
        prefix += 1

    return jaro + prefix * 0.1 * (1 - jaro)


def levenshtein_ratio(a: str, b: str) -> float:
    """Normalised edit-distance similarity in [0, 1]."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def phonetic_similarity(a_key: str, b_key: str) -> float:
    """
    How alike do two titles *sound*?

    Compares Metaphone token streams both as sets (order-insensitive) and as
    strings (order-sensitive) and keeps the stronger signal.
    """
    if not a_key or not b_key:
        return 0.0
    if a_key == b_key:
        return 1.0

    a_toks, b_toks = a_key.split(), b_key.split()
    inter = len(set(a_toks) & set(b_toks))
    union = len(set(a_toks) | set(b_toks)) or 1
    set_score = inter / union
    seq_score = levenshtein_ratio(a_key.replace(" ", ""), b_key.replace(" ", ""))
    return max(set_score, 0.5 * set_score + 0.5 * seq_score)


def token_jaccard(a_tokens, b_tokens) -> float:
    a, b = set(a_tokens), set(b_tokens)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def containment(a_tokens, b_tokens) -> float:
    """Fraction of the smaller token set contained in the larger one."""
    a, b = set(a_tokens), set(b_tokens)
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def fuzzy_similarity(a: str, b: str) -> float:
    """Best of Jaro-Winkler and normalised edit distance on the raw strings."""
    a, b = (a or "").lower(), (b or "").lower()
    if not a or not b:
        return 0.0
    return max(jaro_winkler(a, b), levenshtein_ratio(a, b))
