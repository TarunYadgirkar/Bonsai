-- OAuth access tokens get an expiry (they were permanent). 90-day sliding TTL, refreshed on use.
-- Apply per Neon branch, after 006. Existing tokens get a fresh 90-day window from apply time.
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days';
CREATE INDEX IF NOT EXISTS oauth_tokens_expires_idx ON oauth_tokens (expires_at);
