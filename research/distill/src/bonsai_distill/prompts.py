"""The compiler contract, mirrored from bonsai-engine (packages/engine/src/compiler.ts).

The system prompt is copied VERBATIM so teacher briefs, student training targets, and
eval-time generations all share Bonsai's real task. Output contract:
JSON only — {"facts": string[], "excludedNote": string}.
"""
from __future__ import annotations

import json

from .schema import Brief, Message

COMPILER_SYSTEM = (
    "You compile minimal context briefs. Given the context above a conversation fork and "
    "a branch topic, extract ONLY the facts needed to answer the branch question, ordered "
    "most load-bearing first: state the ONE fact the question most depends on first, then "
    "the rest in falling order of importance. Prefer facts a smaller model could not infer "
    "without them — the names, numbers, dates, and constraints that exist only in this "
    "conversation — over anything general knowledge supplies. Resolve every referent so "
    "each fact stands alone without the parent — never write \"apps\", \"it\", \"that "
    "club\" where a name belongs. Facts under \"Inherited context\" or \"Learned from "
    "branches\" headings are pre-distilled: carry the relevant ones through rather than "
    "re-deriving them. Respond with JSON only: {\"facts\": string[], \"excludedNote\": "
    "string}. facts: at most 8 short self-contained sentences. excludedNote: one sentence "
    "naming what you deliberately left out."
)

MAX_FACTS = 8


def estimate_tokens(text: str) -> int:
    # engine heuristic: ~4 chars per token
    return max(1, round(len(text) / 4))


def render_path_markdown(
    messages: list[Message],
    inherited_facts: list[str] | None = None,
) -> str:
    lines: list[str] = []
    if inherited_facts:
        lines.append("## Inherited context")
        lines.extend(f"- {f}" for f in inherited_facts)
        lines.append("")
    for m in messages:
        lines.append(f"**{m.role}:** {m.content}")
        lines.append("")
    return "\n".join(lines).strip()


def build_user_prompt(
    path_markdown: str,
    selection: str,
    question: str,
    profile: str | None,
) -> str:
    return "\n".join(
        [
            f"User profile: {profile or 'unknown'}",
            f"Branch topic (highlighted text): {selection}",
            f"Branch question: {question or selection}",
            "",
            "Parent conversation:",
            path_markdown,
        ]
    )


def parse_compiler_output(text: str) -> tuple[list[str], str] | None:
    """Engine-faithful lenient parse: first {...} span, facts filtered to strings."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    raw_facts = parsed.get("facts")
    if not isinstance(raw_facts, list):
        return None
    facts = [f for f in raw_facts if isinstance(f, str)][:MAX_FACTS]
    if not facts:
        return None
    note = parsed.get("excludedNote")
    excluded = note if isinstance(note, str) else "Excluded: the rest of the parent conversation."
    return facts, excluded


def render_brief_markdown(selection: str, question: str, facts: list[str]) -> str:
    lines = [f"# Branch brief — {selection}", "", "## Relevant facts"]
    lines.extend(f"- {f}" for f in facts)
    lines.extend(["", "## Question", question or selection])
    return "\n".join(lines)


def make_brief(
    facts: list[str],
    excluded_note: str,
    selection: str,
    question: str,
    available_tokens: int,
) -> Brief:
    markdown = render_brief_markdown(selection, question, facts)
    return Brief(
        facts=facts,
        excluded_note=excluded_note,
        markdown=markdown,
        brief_tokens=estimate_tokens(markdown),
        available_tokens=available_tokens,
    )


def target_completion(facts: list[str], excluded_note: str) -> str:
    """The assistant turn a student is trained to emit."""
    return json.dumps({"facts": facts, "excludedNote": excluded_note}, ensure_ascii=False)
