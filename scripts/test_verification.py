"""
PSS06 - End-to-end smoke test for the verification pipeline.

Runs a battery of titles designed to trip each rule in the catalogue and
prints the decision, similarity, probability and the rules that fired.
No web server and no MySQL required - it drives the agent directly.

Usage:
    cd C:\\PSS06
    python scripts/test_verification.py
    python scripts/test_verification.py --title "Dainik Bharat Samachar"
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ai-service"))

os.environ.setdefault("LITE_MODE", "auto")

import logging  # noqa: E402

logging.basicConfig(level=logging.WARNING,
                    format="%(levelname)-7s %(name)-18s %(message)s")


def build_agent():
    from agents.verification_agent import VerificationAgent
    from embeddings.bge_m3 import get_embedder
    from reranking.bge_reranker import get_reranker
    from retrieval.corpus import load_corpus
    from retrieval.faiss_store import build_store
    from retrieval.retriever import TitleRetriever
    from rules.title_rules import RuleEngine

    corpus = load_corpus(use_cache=False)
    embedder = get_embedder()
    reranker = get_reranker()
    store = build_store(corpus.texts(), embedder)

    engine = {
        "mode": "FULL" if embedder.available else "LITE",
        "vectorBackend": store.backend,
        "rerankerAvailable": reranker.available,
        "corpusSize": len(corpus),
    }
    retriever = TitleRetriever(corpus, store)
    return corpus, VerificationAgent(corpus, retriever, RuleEngine(corpus), engine)


COLOURS = {"ACCEPT": "\033[92m", "REVIEW": "\033[93m", "REJECT": "\033[91m"}
RESET = "\033[0m"


def show(result, verbose=False):
    d = result["decision"]
    colour = COLOURS.get(d, "")
    print(f"\n  Proposed   : {result['title']}")
    print(f"  Normalised : {result['normalizedTitle']}")
    print(f"  Decision   : {colour}{d}{RESET}"
          f"   similarity {result['similarityScore']}%"
          f"   verification probability {result['verificationProbability']}%"
          f"   confidence {result['confidence']}")

    if result["findings"]:
        print("  Rules fired:")
        for f in result["findings"]:
            print(f"    [{f['severity']:<7}] {f['code']} {f['rule']}")
            print(f"              {f['message']}")
    else:
        print("  Rules fired: none")

    if result["similarTitles"]:
        print("  Closest registered titles:")
        for m in result["similarTitles"][:3]:
            print(f"    {m['similarity']:>5.1f}%  {m['title']}"
                  f"   [{', '.join(m['matchedVia'][:3])}]")

    print(f"  Explanation: {result['explanation']}")
    if result["suggestions"]:
        print("  Suggestions:")
        for s in result["suggestions"]:
            print(f"    - {s}")

    if verbose:
        print("  Agent trace:")
        for step in result["agentTrace"]:
            print(f"    {step['step']}. {step['tool']:<34} "
                  f"{step['durationMs']:>7.1f} ms  {step['summary']}")
    print(f"  Total: {result['processingMs']} ms")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", help="Verify a single title and exit")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    print("Booting the verification agent ...")
    corpus, agent = build_agent()
    print(f"Corpus: {len(corpus)} titles | mode: {agent.engine_info['mode']} "
          f"| backend: {agent.engine_info['vectorBackend']}")

    if args.title:
        show(agent.verify(args.title, explain=True), verbose=True)
        return 0

    # Build the test battery from titles that really are in the registry, so
    # the expectations hold whatever subset of PRGI data is loaded.
    real = [r.title for r in corpus.records[:4000]]
    long_titles = [t for t in real if 2 <= len(t.split()) <= 4]
    base_a = long_titles[len(long_titles) // 3]
    base_b = long_titles[len(long_titles) // 2]

    def misspell(title: str) -> str:
        """Produce a same-sounding, differently-spelled version of a title."""
        out = title
        for src, dst in (("V", "W"), ("K", "C"), ("Y", "I"),
                         ("PH", "F"), ("S", "SH"), ("A", "AA")):
            if src in out:
                out = out.replace(src, dst, 1)
        return out if out != title else title + "AA"

    # Requirement 3.d / 5.b: seed one English title into the live queue so the
    # Hindi translation submitted next can be caught against it.
    agent.register_pending("Daily Evening", "APP-2026-0001",
                           language="English", publisher="Demo Press")

    cases = [
        ("R01 exact duplicate", base_a),
        ("R02 prohibited word", "Crime Police Samachar Daily"),
        ("R05 spelling variant", misspell(base_a)),
        ("R05 spelling variant (Namaskar/Namascar)", "Namascar Bharat"),
        ("R07 generic affix added", f"The {base_a} India"),
        ("R08 periodicity added", f"Dainik {base_a}"),
        ("R09 combination of two titles", f"{base_a} {base_b}"),
        ("R10/R14 translation of a pending title", "Pratidin Sandhya"),
        ("R03 all-generic title", "The India News Daily"),
        ("clean, distinctive title", "Kanchanjunga Parvat Vichar Manthan"),
        ("clean, distinctive title", "Zephyr Quarterly Of Marine Robotics"),
    ]

    print("\n" + "=" * 78)
    print("  PSS06 rule battery")
    print("=" * 78)
    for label, title in cases:
        print(f"\n--- {label} " + "-" * (70 - len(label)))
        show(agent.verify(title, explain=True), verbose=args.verbose)

    print("\n" + "=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
