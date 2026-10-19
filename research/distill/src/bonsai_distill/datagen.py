"""Parameterized scenario families, generalizing evals/cases.ts from 15 hand-built cases
into thousands. Each family mirrors a BriefBench category; the train/eval split is by
entity vocabulary (see entities.py) AND by surface template, so eval measures the
behavior, not memorized strings."""
from __future__ import annotations

import random

from .entities import EntityPools, make_pools
from .schema import Example, ForkSpec, Message


def _m(role: str, content: str) -> Message:
    return Message(role=role, content=content)  # type: ignore[arg-type]


def _distractors(pools: EntityPools, used: set[str], rng: random.Random, n: int = 6) -> list[str]:
    candidates = [e for e in pools.orgs + pools.programs + pools.amounts if e not in used]
    return rng.sample(candidates, min(n, len(candidates)))


_REFERENT_QUESTIONS = [
    "when do apps close?",
    "when is the cutoff?",
    "what's the date it closes?",
    "how long until it's due?",
    "is the deadline soon?",
]

_PROFILE_VARIANTS = [
    "Tarun — Incoming Berkeley freshman in applied math, CS-focused, building a startup. Goals: join at most two clubs; builder-first over resume-padding.",
    None,
    "Sam — Second-year transfer deciding where to spend limited time. Goals: ship projects; avoid overcommitment.",
]


def gen_depth1_referent(pools: EntityPools, rng: random.Random, split: str, idx: int) -> Example:
    org, other_org = rng.sample(pools.orgs, 2)
    date = rng.choice(pools.dates)
    hours = rng.randint(3, 14)
    templates = [
        [
            _m("user", "I am figuring out which programs to apply to this fall."),
            _m("assistant", f"Worth a look: {org} runs an application-based cohort, and {other_org} is drop-in with no application."),
            _m("user", f"What is the {org} timeline?"),
            _m("assistant", f"{org} applications close {date}, with an info session about a week before."),
            _m("user", "And time commitments?"),
            _m("assistant", f"{org} takes roughly {hours} hours weekly; {other_org} is flexible."),
        ],
        [
            _m("user", "Help me plan my applications for this cycle."),
            _m("assistant", f"Two options stand out: {org}, which is selective, and {other_org}, which accepts everyone on a rolling basis."),
            _m("user", "Which one has a hard deadline?"),
            _m("assistant", f"{org} does — applications close {date}. {other_org} has no deadline at all."),
        ],
    ]
    msgs = templates[idx % len(templates)]
    used = {org, other_org, date}
    return Example(
        id=f"d1_{split}_{idx}",
        family="depth1_referent",
        split=split,  # type: ignore[arg-type]
        profile=rng.choice(_PROFILE_VARIANTS),
        messages=msgs,
        forks=[ForkSpec(selection=org, question=rng.choice(_REFERENT_QUESTIONS), must_contain=[org, date])],
        must_not_contain=_distractors(pools, used, rng),
        qa_answer_must_contain=[date],
    )


def gen_ambiguous(pools: EntityPools, rng: random.Random, split: str, idx: int) -> Example:
    prog_a, prog_b = rng.sample(pools.programs, 2)
    date_a, date_b = rng.sample(pools.dates, 2)
    msgs = [
        _m("user", "Track the deadlines for my funding applications this fall."),
        _m("assistant", f"Two are live: the {prog_a} application closes {date_a}, and the {prog_b} deadline is {date_b}. Both matter for your funding story."),
        _m("user", "Which one needs letters of recommendation?"),
        _m("assistant", f"The {prog_b} needs none; the {prog_a} requires three reference letters, due with the {date_a} submission."),
    ]
    anchor = rng.choice([(prog_a, date_a), (prog_b, date_b)])
    used = {prog_a, prog_b, date_a, date_b}
    return Example(
        id=f"amb_{split}_{idx}",
        family="ambiguous",
        split=split,  # type: ignore[arg-type]
        profile=rng.choice(_PROFILE_VARIANTS),
        messages=msgs,
        forks=[ForkSpec(selection=anchor[0], question="when is the deadline?", must_contain=[anchor[0], anchor[1]])],
        must_not_contain=_distractors(pools, used, rng),
        qa_answer_must_contain=[anchor[1]],
    )


def gen_salience(pools: EntityPools, rng: random.Random, split: str, idx: int) -> Example:
    prog = rng.choice(pools.programs)
    amount = rng.choice(pools.amounts)
    # noise sentences deliberately share the question's common words ("programs offer");
    # the load-bearing sentence carries the rare term ("stipend") and the number
    msgs = [
        _m("user", "Help me compare the funding packages across the programs I got into."),
        _m("assistant", (
            "All three programs offer full tuition remission. Two programs offer standard "
            "teaching assistantships, and both programs offer subsidized housing for the "
            f"first year. The third package includes the {prog}, which pays a stipend of "
            f"{amount} dollars per year."
        )),
        _m("user", "Which programs offer the best conference travel support?"),
        _m("assistant", "The first two programs offer 1,500 dollars of conference travel each year."),
    ]
    # "1,500" is hardcoded in the travel-support noise sentence — never a valid distractor
    used = {prog, amount, "1,500"}
    return Example(
        id=f"sal_{split}_{idx}",
        family="salience",
        split=split,  # type: ignore[arg-type]
        profile=None,
        messages=msgs,
        forks=[ForkSpec(selection="stipend amounts", question="how large is the stipend the programs offer?", must_contain=[prog, amount])],
        must_not_contain=_distractors(pools, used, rng),
        qa_answer_must_contain=[amount],
    )


def gen_long_trunk(pools: EntityPools, rng: random.Random, split: str, idx: int) -> Example:
    prog = rng.choice(pools.programs)
    amount = rng.choice(pools.amounts)
    date = rng.choice(pools.dates)
    n_filler = rng.randint(10, 16)
    buried_at = rng.randint(3, n_filler - 3)
    msgs = [_m("user", "Walk me through every financial aid option on offer.")]
    for i in range(1, n_filler + 1):
        if i == buried_at:
            msgs.append(_m("user", "Any scholarships tied to housing specifically?"))
            msgs.append(_m("assistant", f"The {prog} covers {amount} dollars of housing per year, through a separate {date} application."))
        msgs.append(_m("user", f"What about aid option {i}?"))
        msgs.append(_m("assistant", f"Aid option {i} offers standard support with general resources and typical terms for eligible members of the program."))
    used = {prog, amount, date}
    return Example(
        id=f"lt_{split}_{idx}",
        family="long_trunk",
        split=split,  # type: ignore[arg-type]
        profile=None,
        messages=msgs,
        forks=[ForkSpec(selection=prog, question="how much housing money does the scholarship give?", must_contain=[prog, amount])],
        must_not_contain=_distractors(pools, used, rng),
        min_pruned_pct=60,
        qa_answer_must_contain=[amount],
    )


def gen_depth2(pools: EntityPools, rng: random.Random, split: str, idx: int) -> Example:
    """Root names the entity; the level-1 branch transcript never does. Only brief
    composition can resolve the level-2 referent — the differential case."""
    org = rng.choice(pools.orgs)
    date = rng.choice(pools.dates)
    root_msgs = [
        _m("user", "I am figuring out which programs to join this fall."),
        _m("assistant", f"{org} is the strongest fit: application-based, builder-focused."),
        _m("user", f"What is the {org} timeline?"),
        _m("assistant", f"{org} applications close {date}, with an info session about a week before."),
    ]
    branch_msgs = [
        _m("user", "what is the application timeline?"),
        _m("assistant", f"Applications close {date} with an info session the week before."),
    ]
    used = {org, date}
    return Example(
        id=f"d2_{split}_{idx}",
        family="depth2",
        split=split,  # type: ignore[arg-type]
        profile=rng.choice(_PROFILE_VARIANTS),
        messages=root_msgs,
        forks=[
            ForkSpec(selection=org, question="what is the application timeline?", must_contain=[org, date], branch_messages=branch_msgs),
            ForkSpec(selection="the deadline", question="when is the deadline?", must_contain=[org]),
        ],
        must_not_contain=_distractors(pools, used, rng),
        qa_answer_must_contain=[date],
    )


FAMILIES = {
    "depth1_referent": gen_depth1_referent,
    "ambiguous": gen_ambiguous,
    "salience": gen_salience,
    "long_trunk": gen_long_trunk,
    "depth2": gen_depth2,
}


def generate(n_train: int, n_eval: int, seed: int = 7) -> list[Example]:
    pools = make_pools(seed=seed)
    rng = random.Random(seed + 1)
    examples: list[Example] = []
    for split, total in [("train", n_train), ("eval", n_eval)]:
        names = list(FAMILIES)
        for i in range(total):
            fam = names[i % len(names)]
            examples.append(FAMILIES[fam](pools[split], rng, split, i))
    return examples
