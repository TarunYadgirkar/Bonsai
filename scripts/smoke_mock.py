"""Dependency-free smoke test: runs the full eval harness against an extractive mock
compiler (mirrors the engine's mock-first rule). Proves datagen, composition, checks,
and metrics plumbing with zero keys and zero torch. Exits nonzero on plumbing failure."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from bonsai_distill.datagen import generate
from bonsai_distill.evaluate import eval_example, summarize


def mock_compile(user_prompt: str):
    """Extractive: score each source sentence by overlap with selection+question,
    keep the top 4. Deliberately naive — salience cases SHOULD fail on it."""
    selection = re.search(r"Branch topic \(highlighted text\): (.*)", user_prompt).group(1)
    question = re.search(r"Branch question: (.*)", user_prompt).group(1)
    body = user_prompt.split("Parent conversation:", 1)[1]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n", body) if len(s.strip()) > 20]
    query_words = set(re.findall(r"[a-z]+", (selection + " " + question).lower()))

    def score(s: str) -> int:
        return len(query_words & set(re.findall(r"[a-z]+", s.lower())))

    ranked = sorted(sentences, key=score, reverse=True)[:4]
    facts = [re.sub(r"\*\*\w+:\*\* ", "", s) for s in ranked]
    return (facts, "Excluded: the rest of the parent conversation."), {
        "latency_s": 0.0,
        "output_tokens": 0,
    }


examples = [e for e in generate(0, 40) if e.split == "eval"]
results = [eval_example(ex, mock_compile, judge=None) for ex in examples]
summary = summarize(results)
print(json.dumps(summary, indent=2))

# plumbing assertions, not model-quality assertions
assert summary["parse_rate"] == 1.0
assert all(fam in summary["by_family"] for fam in ["depth1_referent", "ambiguous", "salience", "long_trunk", "depth2"])
assert summary["compression"] is not None and summary["compression"] > 0
d1 = summary["by_family"]["depth1_referent"]["referent_rate"]
assert d1 and d1 >= 0.5, "extractive mock should resolve most depth-1 anchored referents"
print("\nsmoke OK — harness plumbing verified against the extractive mock")
