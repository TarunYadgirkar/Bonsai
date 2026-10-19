"""Claude teacher: generates gold briefs, kept only when they pass the same
entity-presence checks the eval uses (rejection sampling as a quality gate).

Depth-2 examples are compiled recursively — the level-1 gold brief becomes the
level-2 input's inherited context — so the student learns composition, not just
single-shot extraction.
"""
from __future__ import annotations

import os
import time

import anthropic

from .checks import grade_brief
from .prompts import (
    COMPILER_SYSTEM,
    build_user_prompt,
    estimate_tokens,
    make_brief,
    parse_compiler_output,
    render_path_markdown,
    target_completion,
)
from .schema import Brief, Example

TEACHER_MODEL = os.environ.get("TEACHER_MODEL", "claude-sonnet-5")
MAX_ATTEMPTS = 3


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def compile_once(client: anthropic.Anthropic, user_prompt: str) -> tuple[list[str], str] | None:
    resp = client.messages.create(
        model=TEACHER_MODEL,
        max_tokens=600,
        system=COMPILER_SYSTEM,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return parse_compiler_output(text)


def compile_example(client: anthropic.Anthropic, ex: Example) -> list[dict] | None:
    """Returns one training record per fork level, or None if any level fails the
    checks after MAX_ATTEMPTS (the whole chain is rejected — a bad level-1 brief
    poisons the level-2 input)."""
    records: list[dict] = []
    inherited: list[str] | None = None
    path_messages = list(ex.messages)

    for level, fork in enumerate(ex.forks):
        path_md = render_path_markdown(path_messages, inherited)
        user_prompt = build_user_prompt(path_md, fork.selection, fork.question, ex.profile)
        source_text = f"{path_md}\n{fork.selection}\n{fork.question}"
        available = estimate_tokens(path_md)

        brief: Brief | None = None
        for _ in range(MAX_ATTEMPTS):
            parsed = compile_once(client, user_prompt)
            if parsed is None:
                continue
            candidate = make_brief(parsed[0], parsed[1], fork.selection, fork.question, available)
            verdict = grade_brief(candidate, fork.must_contain, ex, source_text)
            if verdict["pass"] and verdict["clean"]:
                brief = candidate
                break
        if brief is None:
            return None

        records.append(
            {
                "example_id": ex.id,
                "family": ex.family,
                "level": level,
                "messages": [
                    {"role": "system", "content": COMPILER_SYSTEM},
                    {"role": "user", "content": user_prompt},
                    {"role": "assistant", "content": target_completion(brief.facts, brief.excluded_note)},
                ],
            }
        )
        # next level: the branch transcript with this brief's facts inherited
        inherited = brief.facts
        path_messages = list(fork.branch_messages)

    return records


def compile_all(
    examples: list[Example], on_progress=None, on_result=None, workers: int = 8
) -> tuple[list[dict], list[str]]:
    """on_result(records | None, example_id) fires after every example so callers can
    stream-write — a crash mid-run must not lose paid teacher output. Callbacks run
    under a lock, so callers need no synchronization of their own."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from threading import Lock

    client = _client()
    kept: list[dict] = []
    rejected: list[str] = []
    lock = Lock()

    def run_one(ex: Example) -> tuple[Example, list[dict] | None]:
        try:
            return ex, compile_example(client, ex)
        except anthropic.RateLimitError:
            time.sleep(30)
            return ex, compile_example(client, ex)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_one, ex) for ex in examples]
        for done, fut in enumerate(as_completed(futures), 1):
            ex, records = fut.result()
            with lock:
                if records is None:
                    rejected.append(ex.id)
                else:
                    kept.extend(records)
                if on_result:
                    on_result(records, ex.id)
                if on_progress:
                    on_progress(done, len(examples), len(kept), len(rejected))
    return kept, rejected
