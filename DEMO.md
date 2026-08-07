# DEMO.md — the 3-minute script

Everything in PLAN.md exists to make this script real, in this order. If a feature isn't in this script, it doesn't get built until the script works end to end.

**Setup before walking on stage:** app open on the seeded "Berkeley Clubs" conversation (loaded from `fixtures/seed-conversation.json`), token counter visible, tree sidebar showing one root node. Backup screen recording of this exact run saved locally AND uploaded somewhere reachable.

---

**Beat 1 — The problem (0:00–0:30).**
"This is a real conversation — an hour of research about which Berkeley clubs to join. 19,000 tokens of good context." *(point at the counter)* "Now I have one tiny side question. Today my options are: ask it here and wreck this thread, or open a new chat and either lose the context or pay to drag all 19,000 tokens along. Every AI chat product works like it's 1999 — one giant text log."

**Beat 2 — Branch + prune (0:30–1:15).**
Highlight "Free Ventures" in the chat → click **Branch**. Tree animates a new node. On screen: *Compiling branch context… 19,240 tokens available → 610 relevant → 96.8% pruned.* Ask: **"when do apps close?"** The routing chip shows **⚡ Quick** — hover: tiny context, low effort, cheap model, ~$0.002. Instant correct answer.
"Bonsai compiled the six facts this question needs, resolved what 'apps' refers to, and — because I branched, it *knew* this was a small separate thought — it safely sent it to a small model. The branch is a routing signal."

**Beat 3 — Upshift (1:15–1:50).**
New branch off the root: **"Given my goals, workload, and everything we've learned, rank my top 3 clubs and explain the opportunity cost of each."** Chip flips to **🔬 Deep** — hover: 4,100 tokens compiled from multiple branches + memory, high effort, strong model. "Same product, one message later — it escalated on its own. And if it ever picks wrong, you just tap the chip and override. Every override teaches the router."

**Beat 4 — Cherry-pick merge (1:50–2:20).**
Back in the Free Ventures branch (a couple of pre-run messages deep): click **Merge insight**. One distilled line — *"Free Ventures apps close Sept 11; user plans to apply"* — flows into the parent, and gets written to durable memory. Archive the branch. "Explore messy, keep the parent clean, keep the learning. Branching exists in other products. Merging *back* doesn't."

**Beat 5 — The economics (2:20–2:50).**
Open the economics panel (data logged to Snowflake): every inference this session — model, context tokens, cost, and the session totals: *Full-history baseline: ~74k input tokens. Bonsai: ~18k. Routed spend vs. strong-model-always spend.* "These are live numbers from this demo, not slides."

**Beat 6 — Close (2:50–3:00).**
"The cheapest token is the one you don't send. The second cheapest is the one you send to the right model. Bonsai routes intelligence."

---

**Fallbacks:** if wifi/API dies → play the backup recording. If EverMind is down → memory writes go to the local store, say "durable memory layer" and move on. If Snowflake is down → mock model layer with real token math, don't mention it.
