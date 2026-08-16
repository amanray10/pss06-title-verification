"""
PSS06 - Ollama explanation layer.

Design rule that matters for the viva: **the LLM does not decide anything.**
By the time this module runs, the decision, the similarity score and the
verification probability are already fixed by the symbolic engine. Ollama is
handed that evidence and asked to write the covering explanation a human
applicant can read.

If Ollama is not running, a deterministic template writes the same explanation
from the same findings. The application never depends on the model being up.
"""

import json
import logging
import textwrap
from typing import Any, Dict, List

import config

log = logging.getLogger("pss06.llm")

try:
    import requests

    HAS_REQUESTS = True
except Exception:  # pragma: no cover
    requests = None
    HAS_REQUESTS = False


SYSTEM_PROMPT = textwrap.dedent("""
    You are the explanation writer for the PRGI Title Verification System.

    A deterministic rule engine has ALREADY made the decision. Your job is only
    to explain it to the applicant in clear, neutral, official English.

    Hard constraints:
    - Never contradict, soften or overturn the decision you are given.
    - Never invent similarity numbers, titles or registration numbers.
      Use only the facts in the evidence block.
    - 3 to 5 sentences. No bullet points, no headings, no preamble.
    - State the decision, the main reason with the specific conflicting title,
      and one concrete suggestion for how the applicant could proceed.
    - Do not mention that you are an AI or that rules were applied by software.
""").strip()


def _build_prompt(payload: Dict[str, Any]) -> str:
    return textwrap.dedent(f"""
        EVIDENCE
        --------
        Proposed title       : {payload['title']}
        Language declared    : {payload.get('language') or 'not specified'}
        Decision             : {payload['decision']}
        Similarity score     : {payload['similarity']}%
        Verification chance  : {payload['probability']}%

        Rules triggered:
        {payload['findings_text'] or '  (none)'}

        Closest registered titles:
        {payload['matches_text'] or '  (none found)'}

        Write the explanation now.
    """).strip()


def _findings_text(findings: List[Dict[str, Any]]) -> str:
    lines = []
    for f in findings:
        lines.append(f"  - [{f['severity']}] {f['rule']}: {f['message']}")
    return "\n".join(lines)


def _matches_text(matches: List[Dict[str, Any]]) -> str:
    lines = []
    for m in matches[:5]:
        meta = m.get("metadata", {})
        lines.append(
            f"  - \"{m['title']}\" - {m['similarity']}% similar"
            f" (publisher: {meta.get('publisher') or 'n/a'},"
            f" reg: {meta.get('registrationNumber') or 'n/a'},"
            f" language: {meta.get('language') or 'n/a'})"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Template fallback
# ---------------------------------------------------------------------------
def template_explanation(payload: Dict[str, Any]) -> str:
    decision = payload["decision"]
    title = payload["title"]
    sim = payload["similarity"]
    prob = payload["probability"]
    findings = payload["findings"]
    matches = payload["matches"]

    blockers = [f for f in findings if f["severity"] == "BLOCKER"]
    majors = [f for f in findings if f["severity"] == "MAJOR"]
    primary = (blockers or majors or findings or [None])[0]
    closest = matches[0]["title"] if matches else None

    if decision == "REJECT":
        head = (f'The proposed title "{title}" cannot be accepted for '
                f"registration.")
        reason = primary["message"] if primary else (
            f"It is {sim}% similar to an already registered title."
        )
        advice = (
            "Please submit a title with a distinctive word of its own that does "
            "not repeat, translate or re-spell an existing registered title."
        )
    elif decision == "REVIEW":
        head = (f'The proposed title "{title}" has been referred for manual '
                f"review rather than automatic approval.")
        reason = primary["message"] if primary else (
            f"Its similarity with existing registered titles is {sim}%, which "
            "falls inside the review band."
        )
        advice = (
            "You may either wait for an officer to examine the application or "
            "strengthen the title by adding a distinctive word before "
            "resubmitting."
        )
    else:
        head = (f'The proposed title "{title}" clears the automated '
                f"verification checks.")
        reason = (
            f"The highest similarity found against the registry is only {sim}%"
            + (f', against "{closest}"' if closest else "")
            + ", and no guideline violation was detected."
        )
        advice = (
            "The application can proceed to registration, subject to the usual "
            "documentary verification."
        )

    return (f"{head} {reason} On the evidence available, the likelihood of this "
            f"title being verified is {prob}%. {advice}")


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------
def is_available() -> bool:
    if not (config.OLLAMA_ENABLED and HAS_REQUESTS):
        return False
    try:
        r = requests.get(f"{config.OLLAMA_BASE_URL}/api/tags", timeout=2)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


def generate_explanation(title: str, language: str, decision: str,
                         similarity: float, probability: float,
                         findings: List[Dict[str, Any]],
                         matches: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Return {'text': ..., 'generatedBy': 'ollama:<model>' | 'template'}."""
    payload = {
        "title": title,
        "language": language,
        "decision": decision,
        "similarity": round(similarity, 1),
        "probability": round(probability, 1),
        "findings": findings,
        "matches": matches,
        "findings_text": _findings_text(findings),
        "matches_text": _matches_text(matches),
    }

    if config.OLLAMA_ENABLED and HAS_REQUESTS:
        try:
            response = requests.post(
                f"{config.OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": config.OLLAMA_MODEL,
                    "system": SYSTEM_PROMPT,
                    "prompt": _build_prompt(payload),
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 320},
                },
                timeout=config.OLLAMA_TIMEOUT,
            )
            response.raise_for_status()
            text = (response.json().get("response") or "").strip()
            if text:
                return {"text": text,
                        "generatedBy": f"ollama:{config.OLLAMA_MODEL}"}
        except Exception as exc:  # noqa: BLE001
            log.warning("Ollama unavailable (%s) - using template explanation", exc)

    return {"text": template_explanation(payload), "generatedBy": "template"}


def generate_suggestions(title: str, findings: List[Dict[str, Any]],
                         matches: List[Dict[str, Any]]) -> List[str]:
    """
    Concrete, actionable alternatives for the applicant (requirement 6.c).
    Rule-derived first; the LLM is asked only to polish if it is running.
    """
    from preprocessing.normalizer import normalize_title
    from rules.lexicons import (DISALLOWED_WORDS, GENERIC_PREFIXES,
                                GENERIC_SUFFIXES, PERIODICITY_WORDS)

    norm = normalize_title(title)
    tips: List[str] = []
    codes = {f["code"] for f in findings}

    if "R02" in codes:
        bad = [t for t in norm.tokens if t in DISALLOWED_WORDS]
        tips.append(
            "Remove the prohibited word(s) "
            f"{', '.join(w.upper() for w in bad)} entirely - no substitution "
            "or abbreviation of them is accepted."
        )
    if "R08" in codes:
        tips.append(
            "Drop the periodicity word "
            f"({', '.join(p.upper() for p in norm.periodicity_tokens)}); "
            "periodicity is captured separately in the application form."
        )
    if "R07" in codes:
        tips.append(
            "Replace the generic prefix/suffix with a word specific to your "
            "publication - a place name, the subject you cover, or the "
            "publishing house's own name."
        )
    if "R09" in codes:
        tips.append(
            "Do not merge two registered titles. Choose one original phrase "
            "instead of joining existing ones."
        )
    if "R10" in codes:
        tips.append(
            "Translating an existing title into another language does not make "
            "it new. Pick a different concept, not a different language."
        )
    if {"R05", "R06"} & codes:
        tips.append(
            "Change more than the spelling - the title must also sound "
            "different when read aloud."
        )
    if {"R11", "R12", "R13"} & codes and matches:
        distinctive = [t for t in norm.core_tokens
                       if t not in GENERIC_PREFIXES
                       and t not in GENERIC_SUFFIXES
                       and t not in PERIODICITY_WORDS]
        anchor = distinctive[0].upper() if distinctive else "your masthead"
        tips.append(
            f'Add a genuinely distinguishing element to "{anchor}" - for '
            "example your district, your specialisation, or your "
            "organisation's name."
        )
    if "R14" in codes:
        tips.append(
            "An earlier applicant has already claimed a near-identical title. "
            "Choose a clearly different title rather than waiting on that "
            "application."
        )

    if not tips:
        tips.append(
            "No changes are required. Keep the title exactly as submitted when "
            "you file the application."
        )
    return tips[:5]
