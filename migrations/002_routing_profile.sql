-- Per-user learned routing priors. One row per profile key; the web app is single-user
-- ('default'), the plugin/connector key per tree or per connector identity.

CREATE TABLE IF NOT EXISTS routing_profiles (
  id         text PRIMARY KEY,
  profile    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
