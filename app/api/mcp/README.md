# Bonsai MCP connector

A **claude.ai custom connector** (remote MCP over Streamable HTTP) that gives Claude the Bonsai
fork/merge loop as tools. Claude compiles the minimal, referent-resolved brief *in-conversation*
and passes it as a tool argument; this connector stores the tree, formats a paste-ready branch,
and keeps the pruning economics. It runs no inference of its own.

Built on [`mcp-handler`](https://www.npmjs.com/package/mcp-handler); the route is
`app/api/mcp/[key]/route.ts` (`maxDuration = 60`), tools are registered in
`app/api/mcp/[key]/tools.ts`, and state lives in `lib/mcp-store.ts` (Neon, degrading to a
per-process memory map when `DATABASE_URL` is unset or a query fails, with honest
`[storage: memory only]` labeling).

The hosted instance has **no self-serve key provisioning** — an operator inserts every key by
hand. If nobody handed you a key, self-hosting is the supported path: see
[Deploy your own](#deploy-your-own).

## Tools

| Tool | What it does |
|---|---|
| `bonsai_fork` | Creates a branch from a compiled brief (≤8 facts, all referents resolved, plus an excluded-note). Returns a paste-ready brief for a **new** claude.ai chat, the `branchId`, the routing (`model · effort`), and the pruning economics. |
| `bonsai_merge` | Stores the branch's distilled insight (**≤30 words**, enforced) and marks the branch `merged`. The parent inherits the conclusion, not the transcript. |
| `bonsai_abandon` | Marks a branch `abandoned` — a dead end kept in the tree for the record. |
| `bonsai_tree` | Renders this key's garden: every branch with routing, token economics, status (open ○ / merged ✓ / abandoned ✕), merged insights, and totals. Also returns `structuredContent`. |

## Provision a garden key

The `[key]` path segment is a **per-user garden key**. It is the user's identity: every tool call
is scoped to it, and one key sees exactly one garden. Provisioning is a single row on the Neon
branch this deployment points at (schema: `migrations/003_mcp_connector.sql`, applied after
`001`/`002`):

```sql
INSERT INTO mcp_users (key, label)
VALUES ('<high-entropy-random-string>', 'alex@example.com')
ON CONFLICT DO NOTHING;
```

Generate a high-entropy value (it rides in the URL — treat it like a bearer token, e.g.
`openssl rand -hex 24`). `validateKey` checks `mcp_users`; unknown keys get a plain `401`.

> `bonsai-dev-key` works **only** when `DATABASE_URL` is unset (in-memory mode); no key is ever
> seeded into the database. With a database configured, `validateKey` rejects the dev key outright
> — even a stale seed row from an earlier apply doesn't make it valid (`migrations/003` says to
> delete such rows).

## Deploy your own

1. Deploy the repo to Vercel — it is a Next.js app; the connector route ships with it.
2. Create a Neon database and set `DATABASE_URL` on the deployment. Unset, the store runs in
   memory and only `bonsai-dev-key` validates — fine locally, useless hosted.
3. Apply `migrations/001` → `005` **in order** (Neon console or `psql`). Each file says
   apply-per-branch — run them against the Neon branch this deployment points at.
4. Insert your operator key: the same `INSERT INTO mcp_users` as above, with your own
   `openssl rand -hex 24` value.
5. Your connector URL is `https://<your-vercel-domain>/api/mcp/<key>`.

## Connector URL

```
https://<host>/api/mcp/<key>
```

The key may also be sent as `Authorization: Bearer <key>` — the same key, an alternative carrier —
but claude.ai's custom-connector UI only takes a URL, so the path form is what you hand out.

## Add it in claude.ai

Prerequisites: custom connectors require a **paid claude.ai plan**, and the endpoint must be
public HTTPS — claude.ai cannot reach `localhost`. For local dev, open a tunnel first
(e.g. `ngrok http 3000`) and use the tunnel URL as `<host>`.

1. **Settings → Connectors → Add custom connector**.
2. Paste the connector URL (`https://<host>/api/mcp/<key>`). No auth to configure — it is authless.
3. Enable it in a chat; the four `bonsai_*` tools appear and are permission-gated by claude.ai.

## Security notes (honest)

- **The key rides in the URL path.** Anyone with the URL has that user's garden. It is a
  capability token, not a password — **rotate on leak** by deleting the `mcp_users` row and issuing
  a new key. Do not put real keys in the repo, logs, or screenshots.
- **Per-user identity is the key.** There is no separate account model; the key *is* the user. Two
  keys are two isolated gardens.
- **Authless by design.** v1 has no OAuth, consent screen, or revocation flow beyond deleting the
  row. OAuth (real per-user identity + revocation without handing out a key) is on the roadmap in
  `PRODUCT.md`.
- **No `WWW-Authenticate` header — deliberately.** An unauthorized request returns a plain `401`
  with no `WWW-Authenticate: Bearer`. Sending that header makes claude.ai treat the server as
  OAuth-protected and attempt Dynamic Client Registration, which then fails
  ("couldn't register with sign-in"). Omitting it keeps claude.ai treating the connector as
  authless. Origin is likewise not strict-validated — claude.ai's `initialize` breaks on it.

## Smoke test

`app/api/mcp/smoke.mjs` exercises the tool surface end to end.
