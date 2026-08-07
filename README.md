# Bonsai

**Grow conversations as trees. Prune context automatically.**

Bonsai replaces the linear chat log with a tree: branch off side questions with a *compiled minimal context* instead of the full history, route each request to the right model + reasoning effort automatically (with manual override), and cherry-pick durable insights back into the parent.

Built at the Snowflake × Beta Fund Agent & Token Economy Hackathon (Aug 7, 2026).

## Repo map — read in this order

| File | What it is |
|---|---|
| `PRODUCT.md` | The full product idea. The "why." |
| `DEMO.md` | The 3-minute demo script. **Everything we build exists to make this script real.** |
| `PLAN.md` | Milestones, two-person split, timeline, cut lines. |
| `PROMPTS.md` | Copy-paste Claude Code prompts for every session/milestone. |
| `AGENTS.md` | Rules and conventions for coding agents (source of truth). |
| `CLAUDE.md` | Claude Code entry point (imports AGENTS.md). |
| `docs/` | Sponsor API notes + tonight's prep checklist. |
| `fixtures/seed-conversation.json` | The pre-seeded parent conversation the demo runs on. |

## Team

Two builders, each driving one Claude Code session in their own territory (see `AGENTS.md` → Territories). Person A: UI/tree. Person B: engine (compiler, router, Snowflake, EverMind).

## Stack

Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel from hour one. Model calls via Snowflake Cortex (`AI_COMPLETE`), durable memory via EverMind EverOS — both behind a mockable interface in `lib/`, so the app always runs even with no keys.
