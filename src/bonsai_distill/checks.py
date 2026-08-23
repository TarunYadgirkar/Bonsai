"""BriefBench-style assertions, ported from evals/run.ts. All checks are string-level
entity presence, so they grade the teacher, the mock, and every student identically."""
from __future__ import annotations

import re

from .schema import Brief, Example


def missing_entities(haystack: str, needles: list[str]) -> list[str]:
    hay = haystack.lower()
    return [n for n in needles if n.lower() not in hay]


def present_entities(haystack: str, needles: list[str]) -> list[str]:
    hay = haystack.lower()
    return [n for n in needles if n.lower() in hay]


def unsupported_numbers(brief_markdown: str, source_text: str) -> list[str]:
    """Numbers in the brief that appear nowhere in the source: fabricated by construction.

    Comma/period-insensitive so "55,000" in the source supports "55000" in the brief.
    """
    def canon(s: str) -> str:
        return s.replace(",", "").replace(".", "")

    source_canon = {canon(n) for n in re.findall(r"\d[\d,.]*", source_text)}
    out = []
    for n in re.findall(r"\d[\d,.]*", brief_markdown):
        if canon(n) not in source_canon:
            out.append(n)
    return out


def grade_brief(
    brief: Brief,
    fork_must_contain: list[str],
    example: Example,
    source_text: str,
) -> dict:
    """One fork level's verdict. `source_text` is everything the compiler was shown
    (path markdown + selection + question), the ground set for hallucination checks."""
    missing = missing_entities(brief.markdown, fork_must_contain)
    hallucinated = present_entities(brief.markdown, example.must_not_contain)
    fabricated_numbers = unsupported_numbers(brief.markdown, source_text)
    prune_ok = (
        example.min_pruned_pct is None or brief.pruned_pct >= example.min_pruned_pct
    )
    return {
        "referents_ok": not missing,
        "missing": missing,
        "hallucinated": hallucinated,
        "fabricated_numbers": fabricated_numbers,
        "clean": not hallucinated and not fabricated_numbers,
        "prune_ok": prune_ok,
        "pruned_pct": brief.pruned_pct,
        "brief_tokens": brief.brief_tokens,
        "baseline_tokens": brief.available_tokens,
        "pass": (not missing) and prune_ok,
    }
