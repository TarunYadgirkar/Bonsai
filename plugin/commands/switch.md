---
description: Resume an open Bonsai branch — continue its side question in a fresh subagent that inherits the branch's brief.
argument-hint: <branch title or id>
---

Switch to the Bonsai branch matching: $ARGUMENTS

1. Call `bonsai_tree` (with this project's cwd) and find the OPEN branch whose title or id best
   matches the argument. Ambiguous or no match → show the open branches and ask; never guess
   between two plausible ones.
2. Rebuild its context: the branch node's brief facts, its question, and any insights it already
   produced. Do not paste trunk transcript — the brief IS the context, that's the product.
3. Spawn the branch's routed subagent (`bonsai-branch-<tier>` from the node's tier) with that
   brief and the user's follow-up if they gave one, exactly as the `branch` skill's spawn step
   describes. When it concludes, offer the one-insight merge as usual.
