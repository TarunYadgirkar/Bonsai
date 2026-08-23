"""Eval harness: grades any compile() callable on the eval split.

Composition is recursive exactly as BriefBench's depth-2/3 cases do it live — each
level's brief is compiled BY THE MODEL UNDER TEST and fed forward as inherited
context, so a student that can't compose fails depth-2 even if depth-1 is perfect.

Metrics per condition:
  referent_rate      — forks where every must_contain entity survived (final level)
  hallucination_rate — briefs containing a must_not_contain entity or fabricated number
  prune_rate         — cases meeting their min_pruned_pct floor
  compression        — 1 - brief_tokens / baseline_tokens, aggregate
  downstream_qa      — judge answers from the brief alone; gold-entity containment
  parse_rate         — outputs that were valid compiler JSON at all
  latency/tokens     — from the compile callable's stats
"""
from __future__ import annotations

import os
from typing import Callable, Protocol

from .checks import grade_brief, missing_entities
from .prompts import (
    build_user_prompt,
    estimate_tokens,
    make_brief,
    render_path_markdown,
)
from .schema import Example

CompileFn = Callable[[str], tuple[tuple[list[str], str] | None, dict]]


class _JudgeClient(Protocol):
    def answer(self, brief_markdown: str, question: str) -> str: ...


class ClaudeJudge:
    """Answers the branch question from the brief ALONE — measures answerability."""

    def __init__(self, model: str | None = None):
        import anthropic

        self.client = anthropic.Anthropic()
        self.model = model or os.environ.get("JUDGE_MODEL", "claude-haiku-4-5-20251001")

    def answer(self, brief_markdown: str, question: str) -> str:
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=150,
            system=(
                "Answer the question using ONLY the brief provided. If the brief does not "
                "contain the answer, say exactly: NOT IN BRIEF."
            ),
            messages=[{"role": "user", "content": f"{brief_markdown}\n\nQuestion: {question}"}],
        )
        return "".join(b.text for b in resp.content if b.type == "text")


def eval_example(ex: Example, compile_fn: CompileFn, judge: _JudgeClient | None) -> dict:
    inherited: list[str] | None = None
    path_messages = list(ex.messages)
    level_verdicts: list[dict] = []
    stats_acc = {"latency_s": 0.0, "output_tokens": 0}
    parsed_ok = True
    final_brief = None

    for fork in ex.forks:
        path_md = render_path_markdown(path_messages, inherited)
        user_prompt = build_user_prompt(path_md, fork.selection, fork.question, ex.profile)
        source_text = f"{path_md}\n{fork.selection}\n{fork.question}"
        parsed, stats = compile_fn(user_prompt)
        stats_acc["latency_s"] += stats.get("latency_s", 0.0)
        stats_acc["output_tokens"] += stats.get("output_tokens", 0)
        if parsed is None:
            parsed_ok = False
            break
        brief = make_brief(parsed[0], parsed[1], fork.selection, fork.question, estimate_tokens(path_md))
        level_verdicts.append(grade_brief(brief, fork.must_contain, ex, source_text))
        final_brief = brief
        inherited = brief.facts
        path_messages = list(fork.branch_messages)

    final = level_verdicts[-1] if level_verdicts else None
    qa_pass = None
    if judge and parsed_ok and final_brief and ex.qa_answer_must_contain:
        answer = judge.answer(final_brief.markdown, ex.forks[-1].question)
        qa_pass = not missing_entities(answer, ex.qa_answer_must_contain)

    return {
        "id": ex.id,
        "family": ex.family,
        "parsed": parsed_ok,
        "referents_ok": bool(parsed_ok and final and final["referents_ok"]),
        "clean": bool(parsed_ok and all(v["clean"] for v in level_verdicts)),
        "prune_ok": bool(parsed_ok and all(v["prune_ok"] for v in level_verdicts)),
        "pass": bool(parsed_ok and final and final["pass"]),
        "qa_pass": qa_pass,
        "brief_tokens": final["brief_tokens"] if final else None,
        "baseline_tokens": final["baseline_tokens"] if final else None,
        **stats_acc,
    }


def summarize(results: list[dict]) -> dict:
    def rate(key: str, rows: list[dict]) -> float | None:
        vals = [r[key] for r in rows if r[key] is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    families = sorted({r["family"] for r in results})
    measured = [r for r in results if r["brief_tokens"]]
    brief_sum = sum(r["brief_tokens"] for r in measured)
    base_sum = sum(r["baseline_tokens"] for r in measured)
    # hallucination/prune are conditioned on parse success — an unparseable output is a
    # parse failure, not a hallucination, else low base-model parse rates inflate this
    parsed_rows = [r for r in results if r["parsed"]]
    return {
        "n": len(results),
        "parse_rate": rate("parsed", results),
        "referent_rate": rate("referents_ok", results),
        "hallucination_rate": (
            round(1 - (rate("clean", parsed_rows) or 0), 4) if parsed_rows else None
        ),
        "prune_rate": rate("prune_ok", parsed_rows),
        "pass_rate": rate("pass", results),
        "downstream_qa": rate("qa_pass", results),
        "compression": round(1 - brief_sum / base_sum, 4) if base_sum else None,
        "mean_latency_s": rate("latency_s", results),
        "mean_output_tokens": rate("output_tokens", results),
        "by_family": {
            fam: {
                "n": len(rows),
                "referent_rate": rate("referents_ok", rows),
                "pass_rate": rate("pass", rows),
                "downstream_qa": rate("qa_pass", rows),
            }
            for fam in families
            if (rows := [r for r in results if r["family"] == fam])
        },
    }
