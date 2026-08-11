-- Relational store replacing the one-blob store_snapshot. Apply per Neon branch.
-- Conversations hold node-level state; messages/insights/logs are append-mostly rows, so two
-- requests touching different branches can no longer clobber each other's writes.

CREATE TABLE IF NOT EXISTS conversations (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  parent_id   text REFERENCES conversations(id) ON DELETE CASCADE,
  profile     jsonb,
  brief       jsonb,
  pinned_tier text,
  pinned_mode jsonb,
  archived    boolean NOT NULL DEFAULT false,
  is_root     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  routing         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, seq);

CREATE TABLE IF NOT EXISTS insights (
  id         text PRIMARY KEY,
  branch_id  text NOT NULL,
  parent_id  text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS insights_parent_idx ON insights (parent_id, created_at);

CREATE TABLE IF NOT EXISTS inference_logs (
  id         text PRIMARY KEY,
  branch_id  text NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now(),
  payload    jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS inference_logs_ts_idx ON inference_logs (ts);
