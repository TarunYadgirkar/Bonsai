# Bonsai

**Grow conversations as trees. Prune context automatically.**

AI conversations should be versioned state, not giant transcripts. Today every chat is one long log: every new message drags the entire history behind it, editing a past message rescans everything, and asking a side question pollutes a conversation you were happy with. Bonsai replaces the log with a living tree — branches for exploration, compiled context instead of copied history, and a router that decides how much intelligence each thought deserves.

One-line redefinition: **Bonsai is an inference operating system that chooses what an AI should remember, how hard it should think, and which model should think about it.** The tree is how the user organizes thought; the router controls context, effort, model, and escalation.

## The problem

You're deep in a chat with an hour of good context — say, researching which Berkeley clubs to join. The AI knows your goals, your constraints, which clubs you've ruled out. Then you have a side question about one specific club. Your options today are both bad: ask it in the main chat and wreck a thread you wanted to stay clean, or start/duplicate a new chat and either lose the context or drag all of it along at full token cost. And when you edit a past message, the whole conversation gets reprocessed from scratch.

## Branching with compiled context

Highlight anything, hit **Branch**. A new node sprouts from the main conversation — but instead of inheriting the full history, Bonsai asks: *what information from the parent is actually necessary for this branch?* It compiles a minimal context brief (a small markdown file, essentially): who the user is, the current goal, the relevant facts and preferences, and an explicit list of what's excluded. A 19,000-token parent might become a 700-token brief.

Critical detail: the compiler must resolve references. "When's the deadline?" is a simple question, but *deadline of what* lives in the parent. The brief has to be self-contained ("Club: Berkeley Consulting — deadline Friday per parent thread") so a small model can answer without the parent.

Branches can retrieve different kinds of long-term memory depending on what they're for: profile facts for "does this fit me," event facts for "when is it," upcoming-commitment facts for "what should I do next." Context selection is per-branch, not one-size-fits-all.

## Cherry-pick merge

Explore freely in a branch — ten messages digging into a club's interview process. When you land on something durable ("less interested in this club: recruiting is case-interview heavy"), hit **Merge insight**. Bonsai extracts just that conclusion and folds it into the parent's state. Archive the branch. The parent stays clean but learned from the excursion.

It's the git workflow for reasoning: branch → explore → cherry-pick → prune. Branching alone exists in other chat products; *pruned* context inheritance and selective merge-back into the parent are the parts that don't.

## Automatic model + effort routing

Users should describe the task, not understand the model marketplace. Most people can't reliably tell whether a task needs a cheap model, a frontier model, deeper reasoning, or just better context — so Bonsai decides, per request, across four dimensions:

- **Model** — cheap/fast vs. expensive/capable
- **Reasoning effort** — minimal, normal, deep
- **Context budget** — how much of the tree and memory to include
- **Escalation policy** — when to retry with a stronger setup

The optimization order matters: **context → effort → model → retry.** Before upgrading the model, ask whether less (or more relevant) context would solve it, then whether the same model should think harder. Most routers route models; Bonsai routes intelligence. Strategy is start-cheap-then-escalate: try the cheapest viable configuration, evaluate, and promote only when the result fails a check or comes back uncertain — rather than trying to perfectly predict the right setup up front.

Every request effectively gets an **inference budget**: expected value of a correct answer versus expected cost. A casual factual side question earns fractions of a cent; a heavy multi-constraint synthesis earns a real spend across retrieval, reasoning, and retries.

## The branch is a routing signal

This is where the two halves fuse into one system. In a flat chat, a router can't safely send a "simple" question to a small model, because the question sits on top of 20,000 tokens of history and the router can't tell what it depends on — so routers over-provision. By branching, the user has *structurally declared* "this is a separate, smaller thought." The branch boundary is information the router gets for free. Branching isn't just UI hygiene; it's what makes cheap routing safe.

Canonical scenarios, both directions:
- Complex parent chat + simple branch question → lighter model, tiny compiled context, low effort.
- Simple parent chat + heavy branch question (rank my top three with opportunity costs) → strong model, high effort, several memories and branches pulled in.

## Auto and manual coexist

Auto-routing is the default, but users can always override — pick the model or effort themselves. This isn't a concession; it's the feedback mechanism. Every manual override is a labeled example of where the router was miscalibrated for this user, which makes the override *the router's teacher*. It's also the trust escape-hatch that makes automation acceptable in the first place.

The tree gives overrides a natural scope: **pin a branch** as a deep-thinking branch or a quick branch, and everything inside inherits it — cleaner than per-message toggles, and only possible because there's a tree.

## The router learns

Routing personalizes over time. Two people can type the identical prompt and get different inference strategies because their histories differ: this user's rewriting tasks succeed on cheap models 97% of the time; when this user says "analyze," they expect depth; this user's coding branches usually need a stronger model.

Signals come from real behavior, not just an AI judge: regenerations, prompt edits, immediate corrections, whether the result got merged back into the parent, abandoned branches, follow-up clarification questions, thumbs, and manual model upgrades. Logged per inference (context tokens, model, effort, cost, outcome), this yields the economics: cheap-always is inexpensive but often rejected, strong-always is accepted but costly, learned routing lands near strong-model acceptance at a fraction of the cost.

## UI

The conversation list becomes a tree: click any node to enter that conversation. Edges show the context economics — inherited vs. available tokens and the pruned percentage. Each branch carries a badge for the routing decision, expressed in human terms rather than model names: ⚡ Quick, 🧠 Thoughtful, 🔬 Deep. Hover reveals the specifics (context tokens, effort, model tier, estimated cost). An advanced "Why did Bonsai choose this?" view explains the decision: task complexity, memories retrieved, historical cheap-model success rate for this class of request, whether it escalated. Pinned branches display their pinned level. The tree doubles as a visible map of where intelligence — and money — was spent.

## Framings

- Models got smarter and context windows got bigger, but we still store conversations like it's 1999: one giant text log. Bonsai turns the log into a living tree and only pays AI to think about the branches that matter.
- Context routing × model routing: not just *which model gets the task*, but *which information that model deserves to see*.
- The cheapest token is the one you don't send. The second cheapest is the one you send to the right model.
