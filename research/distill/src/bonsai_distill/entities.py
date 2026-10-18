"""Entity pools with a hard train/eval vocabulary split.

The split is by ENTITY, not just by example: an eval conversation never mentions a
train-pool org/date/amount, so a student that memorizes surface strings from training
data gets zero credit at eval time.
"""
from __future__ import annotations

from dataclasses import dataclass
import random


@dataclass(frozen=True)
class EntityPools:
    orgs: list[str]
    dates: list[str]
    amounts: list[str]  # rendered with commas, e.g. "55,000 dollars"
    places: list[str]
    programs: list[str]


_ORGS = [
    "Free Ventures", "ML at Berkeley", "Blueprint Labs", "Cal Hacks", "SkyDeck",
    "House Fund", "Neo Scholars", "Pear Garage", "Contrary Capital", "Dorm Room Fund",
    "Afore Grants", "Z Fellows", "Interact Fellowship", "Kleiner Perkins Fellows",
    "Bessemer Fellowship", "8VC Fellowship", "South Park Commons", "On Deck Scholars",
    "Emergent Ventures", "Thiel Fellowship", "Telora", "Soma Capital", "HF0 Residency",
    "Localhost Collective", "Edge Fellowship", "Basement Fund", "Susa Scouts",
    "Floodgate Anchor", "Boost VC", "Pioneer Tournament",
]

_DATES = [
    "September 11", "October 21", "September 30", "March 2", "November 14", "January 8",
    "April 17", "May 29", "June 3", "July 22", "August 15", "December 5", "February 19",
    "October 2", "November 30", "January 26", "March 28", "April 4", "September 6",
    "December 12", "May 8", "June 27", "July 9", "February 3", "August 1", "October 16",
    "November 7", "March 13", "April 25", "September 19",
]

_AMOUNTS = [
    "55,000", "9,500", "12,750", "3,400", "27,800", "1,500", "68,200", "4,250", "31,000",
    "7,650", "92,400", "18,300", "2,975", "44,100", "6,800", "83,500", "15,250", "5,125",
    "36,700", "21,900", "74,600", "8,050", "49,300", "11,400", "63,850", "2,150",
    "38,500", "17,750", "95,100", "26,300",
]

_PLACES = [
    "Mission Bay", "Dolores Heights", "Inner Richmond", "Rockridge", "Temescal",
    "Southside", "Northgate", "Elmwood", "Albany Hill", "Gourmet Ghetto", "Clark Kerr",
    "Foothill", "Bowles Hall", "Panoramic Hill", "Westbrae", "Ocean View",
    "Poets Corner", "Halcyon Court", "Claremont Hills", "Thousand Oaks",
]

_PROGRAMS = [
    "Hertz fellowship", "Regents scholarship", "NSF GRFP", "NeurIPS workshop",
    "Chancellor's award", "Leadership grant", "Fung fellowship", "Jacobs innovation grant",
    "Siebel scholarship", "Kavli residency", "Draper stipend", "Alumni merit award",
    "Provost research fund", "Dean's venture prize", "Hackworth grant", "Turing scholars",
    "Anita Borg award", "Sloan travel fund", "Moore undergraduate grant", "Lick fellowship",
]


def _split(items: list[str], eval_fraction: float, rng: random.Random) -> tuple[list[str], list[str]]:
    shuffled = rng.sample(items, len(items))
    n_eval = max(2, int(len(shuffled) * eval_fraction))
    return shuffled[n_eval:], shuffled[:n_eval]


def make_pools(seed: int = 7, eval_fraction: float = 0.25) -> dict[str, EntityPools]:
    """Returns {"train": EntityPools, "eval": EntityPools} with disjoint vocabularies."""
    rng = random.Random(seed)
    train, ev = {}, {}
    for name, items in [
        ("orgs", _ORGS), ("dates", _DATES), ("amounts", _AMOUNTS),
        ("places", _PLACES), ("programs", _PROGRAMS),
    ]:
        train[name], ev[name] = _split(items, eval_fraction, rng)
    return {"train": EntityPools(**train), "eval": EntityPools(**ev)}
