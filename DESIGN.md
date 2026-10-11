# Bonsai design system

**Subject:** a conversation tree where side questions branch off with a compiled brief instead of
the whole history. **Audience:** people who already use chat assistants and are seeing the idea
for the first time (portfolio visitors, Claude power users). **Single job:** make it obvious, in
one glance, that a branch carries about 2% of its parent's context, ran on its own model, and
merges one line back. **Treatment:** a utilitarian tool with one signature element.

## The signature: the cut strip

Every branch is drawn with a strip at true scale: the parent's available context at full width,
the brief it actually sent as a solid sliver, and the pruned remainder hatched like removed wood.
It appears large in the branch header (with the sent, left-on-parent and pruned figures) and in
miniature on every node in the tree and in the brief sheet's footer. The argument for compiled
briefs is that number, so the number gets a shape. Everything else stays quiet.

## Color

A nursery bench under cool daylight. Neutrals are tinted toward the accent green, never cream.

| Token | Hex | Role |
|---|---|---|
| `--surface` | `#ECEEEA` | page and garden canvas (lichen grey) |
| `--surface-raised` | `#F8FAF6` | chat pane, node cards, dialogs |
| `--surface-sunk` | `#E1E6DE` | brief panel, badges, code |
| `--ink` | `#15201A` | primary text (evergreen black) |
| `--ink-muted` | `#4F5C54` | secondary text |
| `--ink-faint` | `#5A655E` | captions, 4.5:1 or better on every surface |
| `--accent` | `#245C43` | cambium green: primary actions, active path, the kept segment |
| `--accent-wash` | `#DBE7DF` | active node, user turns, merged insights |
| `--danger` | `#9A4A24` | errors and the reset confirmation |
| Season scale | `#7FA05B` → `#C8A24A` → `#B65A2E` | effort as data: edge strokes and badge dots only, never text |

Older components read the legacy names (`--paper`, `--moss`, `--bark`, `--ember`); they alias the
semantic tokens in `app/globals.css`.

## Type

- **Bricolage Grotesque** (display): the wordmark, conversation titles, dialog headings and the
  pruned-% figure. Used sparingly, always semibold or bold.
- **Instrument Sans** (body and UI): calm and humanist, deliberately not Inter.
- **IBM Plex Mono** (numbers only): token counts, costs, percentages, tabular.

Body text in chat is 15px with relaxed leading, capped near 68 characters. Headings use
`text-wrap: balance`.

## Surfaces and shape

No colored borders on rounded elements. Nodes and bubbles are fills with a soft `--shadow-bud`;
selection is a ring (`ring-accent`), dialogs float on `--shadow-lift`. Regions are separated by
1px inset shadows rather than bordered boxes. Radii: 10px for buds and bubbles, 8px for controls.

## Structure

- Labels are sentence case and say something true: "Brief this branch was given", "Edge: effort,
  low to high". No tracked-out eyebrows, no decorative numbering.
- The garden legend explains the two encodings (edge color, cut strip) in the sidebar footer.
- Icons are Phosphor (`@phosphor-icons/react`); no emoji or glyph icons.

## Motion

One orchestrated moment: the merge flight, where the distilled line travels from the branch to
its parent node and lands as a highlighted insight. Everything else is a short color or shadow
transition. `prefers-reduced-motion` collapses all of it.

## Quality floor

Works at 375px with no horizontal page scroll (the tree canvas measures its container), visible
accent focus rings, real loading, empty and error copy, and a first screen that shows a real tree:
an empty garden on first visit is seeded with the Berkeley example and opens on a branch.
