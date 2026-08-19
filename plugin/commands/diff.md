---
description: Compare a Bonsai branch against the trunk — what it inherited, what it concluded, and what the trunk learned since the fork.
argument-hint: <branch title or id>
---

Diff the Bonsai branch matching: $ARGUMENTS against the current conversation.

1. Call `bonsai_tree` (this project's cwd) and locate the branch (same matching rules as
   /bonsai:switch — ask when ambiguous).
2. Report three sections, honestly and briefly:
   - **Inherited** — the branch's brief facts and its question (what it knew at fork time).
   - **Concluded** — its merged insight, or "still open, no insight yet".
   - **Drift** — what THIS conversation has established since the fork that the branch never
     saw (you have the trunk in context; name concrete facts, not vibes). If the insight
     conflicts with newer trunk facts, say so plainly and suggest a re-fork.
