-- OAuth 2.1 for the remote MCP connector (claude.ai custom connectors): dynamically registered
-- public clients, PKCE-only auth codes, and opaque bearer tokens mapped onto the same per-user
-- garden keys the key-in-URL path uses. Apply per Neon branch, after 003.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     text PRIMARY KEY,
  redirect_uris jsonb NOT NULL,
  client_name   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code           text PRIMARY KEY,          -- sha256 of the issued code
  client_id      text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_key       text NOT NULL REFERENCES mcp_users(key) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,             -- S256 only
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token      text PRIMARY KEY,              -- sha256 of the issued token
  client_id  text NOT NULL,
  user_key   text NOT NULL REFERENCES mcp_users(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used  timestamptz
);

CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON oauth_tokens (user_key);
