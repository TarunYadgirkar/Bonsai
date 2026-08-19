# Bonsai

**Grow conversations as trees. Prune context automatically.**

Chat that keeps side questions out of your main thread, and picks the model for you.

Linear chat forces premature commitment: ask a side question in the main thread and you wreck it; start a new chat and the AI forgets everything it knew. Bonsai replaces the log with a tree. Highlight a line, hit **Branch**, and Bonsai compiles a short self-contained brief of only what that question needs — a 19,240-token parent becomes 610 tokens. Each branch is routed automatically to a model and a reasoning effort (with manual override, which teaches the router). When a branch produces something durable, **Merge insight** folds the one useful line back into the parent and archives the other ten messages. Every edge shows what it kept, which model answered, and what it cost.

## Links

- **Demo video** — https://drive.google.com/file/d/1cUWmVnQ8vwNZ_wN_6JNBgyLTdx3Y0GXm/view
- **Slides** — https://docs.google.com/presentation/d/1leRaXZPIAoSNKj8u8l7JRyqa0cg7NxFSwthIOuYOzGc/edit
- **Live demo** — https://bonsai-lac.vercel.app

## Why not just…

**A Project?** A Project pastes the same fixed context in front of every chat. It doesn't change per question, doesn't resolve what "it" refers to ("when's the deadline?" needs *deadline of what*), doesn't pick the model, and doesn't learn from what you kept.

**Edit an old message?** An edit rewinds, it doesn't branch. The fork is unnamed, unreachable later, still carries the full history, and there's no way to bring what you learned back.

## Built by

Justin Kan ([kanjustin.com](https://kanjustin.com)) and Tarun Yadgirkar ([tarunyadgirkar.com](https://tarunyadgirkar.com)).

Originally a one-day hackathon build; now being rebuilt into something people can actually use. See `PRODUCT.md` for the full product thinking and `AGENTS.md` for repo conventions.
