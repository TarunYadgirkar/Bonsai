# Bonsai — design system

The brief: Bonsai is the art of pruning a conversation to its essential living wood. The interface
should feel like a cultivated thing, not a SaaS dashboard. Every choice below is derived from that
subject, and deliberately avoids the current AI-generated defaults (indigo→purple gradients, Inter,
shadcn `rounded-2xl shadow-lg` cards, the colored left-border strip, cards-in-cards, and the
near-black + acid-accent look).

## Thesis

Sumi-e ink on rice paper. A living tree is the hero and the signature — rendered with organic
branch curves, not an indented file list — and each branch edge shows its *cut* (how much context
was pruned). The economics use a horticultural season scale, not a cost-purple ramp.

## Color (committed light theme — the original was a committed dark theme; this is its inverse)

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#EEECE3` | background — cool-warm rice paper, pushed off the cream cliché |
| `--paper-raised` | `#F6F4EC` | raised surfaces (cards, panes) |
| `--ink` | `#20241E` | primary text — sumi black with a green undertone |
| `--ink-soft` | `#5A5F52` | secondary text |
| `--bark` | `#8A7F6A` | tertiary / captions / structure |
| `--rule` | `#D8D4C6` | hairlines |
| `--moss` | `#3E6B47` | the living accent — the active path, primary actions |
| `--moss-bright` | `#5E8C55` | fresh-cut highlight, focus |
| Season scale (cost) | `#7FA05B` → `#C8A24A` → `#B65A2E` | young growth → summer → ember; cheap→expensive |

No gradients as surfaces. The only gradient permitted is the season *scale* on the economics bar,
because it encodes real data (spend). Accent is used with restraint — most of the page is paper,
ink, and rule.

## Type

- Display: **Fraunces** (variable, optical size) — a hand-cut, botanical serif. Hero + section
  headers only, with restraint. Justified by the craft/cultivation brief; not a neutral default.
- Body/UI: **Instrument Sans** — humanist, characterful, deliberately not Inter.
- Data: **IBM Plex Mono** — token counts, costs, percentages read as instrument readouts.

Type scale (rem): 0.6875 · 0.8125 · 0.9375 · 1.0625 · 1.375 · 2 · 3.25. Display uses tight tracking
and high optical size; data uses tabular figures.

## Structure

- No numbered `01/02/03` markers (the content isn't a sequence).
- Eyebrows are lowercase, letter-spaced, in bark — they label real regions (garden, brief, spend).
- Hairline rules (`--rule`), zero-to-small radius on structural frames; radius is reserved for the
  organic node cards so they read as pruned buds, not shadcn boxes.

## Signature

The **garden**: the branch tree drawn as an actual cultivated bonsai — a trunk, boughs that curve
out to buds (branch nodes), each edge inscribed with its pruned-% as a thin "cut" mark, the active
path inked in moss. Hovering a bud reveals its brief economics. This is the one memorable element;
everything else stays quiet.

## Motion

Restrained. A branch buds in with a short spring on creation; the merge insight travels the bough
back to the trunk (keep the existing MergeFlight idea, restyled). Respect `prefers-reduced-motion`.
Nothing ambient or decorative.

## Quality floor

Responsive to mobile (the garden collapses to a stacked list), visible keyboard focus in moss,
reduced-motion honored, real empty/error copy in the interface's voice.
