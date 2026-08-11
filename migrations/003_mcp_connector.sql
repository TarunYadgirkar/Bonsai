-- Remote MCP connector state: per-user garden keys and forked branch nodes.
-- Apply per Neon branch, after 001/002.

CREATE TABLE IF NOT EXISTS mcp_users (
  key        text PRIMARY KEY,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_nodes (
  id               text PRIMARY KEY,
  user_key         text NOT NULL REFERENCES mcp_users(key) ON DELETE CASCADE,
  parent_id        text,
  title            text,
  question         text,
  brief            text,
  facts            jsonb,
  excluded_note    text,
  model            text,
  effort           text,
  tier             text,
  available_tokens int,
  brief_tokens     int,
  pruned_pct       real,
  status           text NOT NULL DEFAULT 'open',
  insight          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_nodes_user_idx ON mcp_nodes (user_key, created_at);

-- No demo/dev key is seeded here. A repo-literal key in a production table is a validated
-- credential for anyone who reads the source. Local dev accepts 'bonsai-dev-key' only when
-- DATABASE_URL is unset (see lib/mcp-store.ts validateKey); real keys are inserted out of band.
-- If an earlier apply seeded it, remove it: DELETE FROM mcp_users WHERE key = 'bonsai-dev-key';
