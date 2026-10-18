"""Shared data shapes. Everything serializes to plain JSON for JSONL files."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Literal

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class Message:
    role: Role
    content: str


@dataclass(frozen=True)
class ForkSpec:
    """One fork off a conversation: what the user highlighted and asked."""

    selection: str
    question: str
    # entity strings that MUST appear (case-insensitive) in the compiled brief
    must_contain: list[str]
    # branch transcript that follows this fork (used to build the next level's path)
    branch_messages: list[Message] = field(default_factory=list)


@dataclass(frozen=True)
class Example:
    """One eval/training case: a conversation plus a chain of forks.

    len(forks) == 1 is a depth-1 case; longer chains are graded by compiling each
    level with the model under test and feeding the brief forward as inherited context.
    """

    id: str
    family: str  # depth1_referent | ambiguous | salience | long_trunk | depth2
    split: Literal["train", "eval"]
    profile: str | None
    messages: list[Message]
    forks: list[ForkSpec]
    # entities from the pool that do NOT occur anywhere in this conversation;
    # their presence in a brief is a hallucination by construction
    must_not_contain: list[str]
    min_pruned_pct: float | None = None
    # downstream QA: gold entities an answer produced FROM THE BRIEF must contain
    qa_answer_must_contain: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_json(d: dict[str, Any]) -> "Example":
        forks = [
            ForkSpec(
                selection=f["selection"],
                question=f["question"],
                must_contain=list(f["must_contain"]),
                branch_messages=[Message(**m) for m in f.get("branch_messages", [])],
            )
            for f in d["forks"]
        ]
        return Example(
            id=d["id"],
            family=d["family"],
            split=d["split"],
            profile=d.get("profile"),
            messages=[Message(**m) for m in d["messages"]],
            forks=forks,
            must_not_contain=list(d["must_not_contain"]),
            min_pruned_pct=d.get("min_pruned_pct"),
            qa_answer_must_contain=list(d.get("qa_answer_must_contain", [])),
        )


@dataclass(frozen=True)
class Brief:
    """Mirror of the engine's ContextBrief, reduced to what training/eval needs."""

    facts: list[str]
    excluded_note: str
    markdown: str
    brief_tokens: int
    available_tokens: int

    @property
    def pruned_pct(self) -> float:
        if self.available_tokens <= 0:
            return 0.0
        return round((1 - self.brief_tokens / self.available_tokens) * 1000) / 10
