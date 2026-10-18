-- Shared fixed-window counters for IP-keyed limits (POST /api/import today). The in-memory
-- limiter counts per serverless instance; this table counts across all of them. One row per
-- bucket and client, overwritten when its window rolls over. Apply per Neon branch. Until it
-- is applied, lib/rate-limit.ts logs one line per check and falls back to the in-memory limiter.

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL
);
