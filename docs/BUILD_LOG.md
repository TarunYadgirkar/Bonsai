# Bonsai Branch B Build Log

This is the durable handoff for long-running copy-b work. Record decisions, commit IDs, verification evidence, blockers, and the exact next task. Do not use it as a diary.

## 2026-08-11 — Direction and architecture

Completed:

- audited all reachable history and branch topology;
- verified main production deployment and the desktop branch flow;
- identified the broken mobile layout;
- confirmed merge insights are currently omitted from later prompts;
- confirmed nested branches currently omit inherited briefs and ancestor insights;
- evaluated Claude subscriptions, Codex App Server, Chrome extensions, and MCP Apps;
- selected a local-first Bonsai runtime with official Codex App Server stdio integration;
- rejected third-party Claude consumer OAuth bridging;
- created an isolated copy-b worktree;
- wrote the runtime design and first implementation plan.

Evidence:

- Design: docs/superpowers/specs/2026-08-11-bonsai-local-runtime-design.md
- Plan: docs/superpowers/plans/2026-08-11-truthful-context-engine.md
- Production: https://bonsai-lac.vercel.app
- Production main commit at audit: 3ffc72472ea032ad3ce34e72ffe4e36f30cebc84

Key risks:

- the hosted API is unauthenticated and uses one global snapshot;
- App Server is an experimental coding-agent boundary and needs stronger OS isolation before public packaging;
- current persistence can fail silently;
- there are no automated tests yet.

Next:

- execute Task 1 of the truthful context engine plan using TDD;
- commit and push each independently verified task to copy-b.
