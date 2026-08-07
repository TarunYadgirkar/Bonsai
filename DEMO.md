# DEMO.md — the 3-minute script

Everything in PLAN.md exists to make this script real, in this order. If a feature isn't in this script, it doesn't get built until the script works end to end.

**Setup before walking on stage:** app open on the seeded "Berkeley Clubs" conversation (loaded from `fixtures/seed-conversation.json`), token counter visible, tree sidebar showing one root node. Backup screen recording of this exact run saved locally AND uploaded somewhere reachable.

---

**Beat 1 — The problem (0:00–0:30).**
"This is a real conversation — an hour of research about which Berkeley clubs to join. 19,000 tokens of good context." *(point at the counter)* "Now I have one tiny side question. Today my options are: ask it here and wreck this thread, or open a new chat and either lose the context or pay to drag all 19,000 tokens along. Every AI chat product works like it's 1999 — one giant text log."

**Beat 2 — Branch + prune (0:30–1:15).**
Highlight "Free Ventures" in the chat → click **Branch**. Tree animates a new node. On screen: *Compiling branch context… 19,013 tokens available → 417 relevant → 97.8% pruned.* Ask: **"when do apps close?"** The routing chip shows **Haiku 4.5 · Low effort** — hover: tiny context, cheapest model, lowest effort. Instant correct answer.
"Bonsai compiled the six facts this question needs, resolved what 'apps' refers to, and — because I branched, it *knew* this was a small separate thought — it safely sent it to a small model. The branch is a routing signal."

**Beat 3 — Upshift (1:15–1:50).**
New branch off the root: **"Given my goals, workload, and everything we've learned, rank my top 3 clubs and explain the opportunity cost of each."** Chip flips to **Opus 5 · High effort** — hover: the classifier rated it 3/3 against the compiled brief. "Same product, one message later — it upgraded on its own. And if it ever picks wrong, you tap the chip and pick the model and the effort yourself — that's what the Blueprint branch is, pinned to Opus 5 at max effort."

**Beat 4 — Cherry-pick merge (1:50–2:20).**
Back in the Free Ventures branch: click **Merge insight**. One distilled line — *"Free Ventures applications close September 11, with an info session on September 3"* — flows into the parent and is written to durable memory (the "· durable memory" tag only appears when that write really succeeded). Archive the branch. "Explore messy, keep the parent clean, keep the learning. Branching exists in other products. Merging *back* doesn't."

**Beat 5 — The economics (2:20–2:50).**
Open the economics panel: every inference in this tree — model, effort, context tokens, modeled cost, and the session totals. *Full-history baseline vs. what Bonsai actually sent: ~56% fewer tokens, ~96% less spend.* "These are computed from this tree, not slides — the baseline is the real token count of the history each branch would have inherited."

**Beat 6 — Close (2:50–3:00).**
"The cheapest token is the one you don't send. The second cheapest is the one you send to the right model. Bonsai routes intelligence."

---

**Fallbacks:** if wifi/API dies → play the backup recording. If EverMind is down → memory writes go to the local store, say "durable memory layer" and move on.

**Setup note:** the app boots with the tree already built — six branches, one per feature, including one already merged back. Beats 2 and 3 can be walked live (highlight → Branch) or shown from the pre-built branches if the room is rushed. Nothing has to be typed.

**What is real if a judge pushes:** the 19,013-token baseline, every compiled brief and pruned-%, the routing decisions, and the whole savings ratio — all computed. The dollar column is modeled at published per-token rates. Snowflake Cortex is unavailable on this account, so completions are generated locally; don't claim otherwise.
