-- The population-prior fold reads the most recent PRIOR_SAMPLE_LIMIT profiles; without this the
-- ORDER BY updated_at DESC degrades to a full-table sort as routing_profiles grows (and session
-- rows are free to create). Apply per Neon branch, after 004.

CREATE INDEX IF NOT EXISTS routing_profiles_updated_idx ON routing_profiles (updated_at DESC);
