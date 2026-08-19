# Bonsai for Claude — Chrome extension

Branch side questions off any claude.ai chat with a compiled minimal brief, an auto-routed model
+ effort, and one-insight merge-back — running on the Claude subscription you already pay for.

## The human-in-the-loop rule (why this is safe)

The extension **reads** your conversations (same-origin, GET only) and **pre-fills** the composer.
It never sends a message or calls a model on your behalf — you always press send. That constraint
is structural, not a promise: `src/claude-api.ts` exposes only a GET helper with an allowlisted
path prefix; there is no POST/send/completion code anywhere in the bundle. Auto-sending through a
consumer session is exactly what Anthropic's terms forbid, so Bonsai doesn't do it.

## How it works

1. Highlight text in a Claude chat → a **🌱 Branch** chip appears → click it.
2. In the side panel, type your side question and hit **Compile brief**. Bonsai reads the
   conversation and builds a minimal, referent-resolved brief locally (no model call) — you see
   the facts, what was excluded, and the token economics (available → brief, % pruned).
3. It recommends a model + effort; change it and you teach the local router for next time.
4. **Open branch chat** → a new Claude tab opens with the brief pre-filled. You review and send.
   The branch runs on your subscription.
5. When the branch concludes, type one distilled insight and **Merge to parent** → the parent
   chat opens with the insight pre-filled. You send it. One line comes back, not ten messages.

The side panel keeps the cross-conversation tree (claude.ai has no fork-to-new-chat primitive, so
Bonsai stores the parent→branch links itself) in `chrome.storage.local`.

### On brief fidelity (an honest tradeoff)

The brief is compiled **locally and extractively** — keyword-ranked sentences from the
conversation, no model call. This is deliberate: the extension must never run inference on your
claude.ai session (that would be automated access to your subscription, which Anthropic's terms
forbid). Two consequences you should know:

- The draft brief is lower-fidelity than a brief Claude would compile. That's why you **see and
  can edit it** before anything is sent, and why the highlighted selection is always pinned into
  it. Claude then does the actual reasoning when you send the branch — on your subscription.
- If you want Claude-quality brief compilation, the **Claude Code plugin** and the **claude.ai
  MCP connector** compile the brief with Claude in-conversation. The extension trades that
  fidelity for working directly inside the claude.ai web app.

## Install (developer / unpacked)

There is no Chrome Web Store listing yet; developer-mode load-unpacked is the only install path.

Run `npm install` at the **repo root** first — esbuild resolves from the root workspaces. `dist/`
is prebuilt and committed, so the build step is skippable.

```
cd extension && node build.mjs   # bundles src/ → dist/ (esbuild)
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select this `extension/` folder. Open any claude.ai chat, then open Chrome's puzzle-piece
extensions menu, pin Bonsai, and click its bonsai-tree icon to open the side panel.
If a claude.ai tab was already open when you
loaded the extension, reload that tab — content scripts attach on page load.

## Verified

The side panel's own buttons are covered by `npm run test:e2e:panel` (real Chromium, the panel
as an extension page, claude.ai DNS-pinned to localhost and fulfilled from fixtures): compile →
brief preview, Open branch chat → prefilled composer, Merge to parent → prefilled parent chat,
never-send held across the whole run.


Against live claude.ai (Aug 2026): the read endpoints return the conversation list + message
tree; `reconstructPath` rebuilds the on-screen path (unit-tested in `test/`); the multi-line
brief pre-fills the ProseMirror composer and clears cleanly, with no send. The engine
(compiler + router + learning) is bundled from `@bonsai/engine` and runs entirely in the browser.

## Layout

| Path | What |
|---|---|
| `manifest.json` | MV3: side panel + thin content script, scoped to claude.ai |
| `src/claude-api.ts` | GET-only same-origin reads; `reconstructPath` |
| `src/compile.ts` | local brief compile + routing via `@bonsai/engine` |
| `src/content.ts` | Branch chip, composer pre-fill (never send), new-chat linking |
| `src/sidepanel.ts` | tree UI + branch/merge flow |
| `src/sw.ts` | side-panel scoping, open-and-prefill routing |
| `src/store.ts` | cross-conversation tree + learned profile in storage.local |
