-- Per-session gardens: each browser session owns its own tree, logs, and learned routing
-- profile. Fresh sessions start empty; the Berkeley Clubs fixture becomes an opt-in demo
-- seeded under the requesting session. Apply per Neon branch, after 001/002/003.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_id text NOT NULL DEFAULT 'legacy';
ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS session_id text NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations (session_id);
CREATE INDEX IF NOT EXISTS inference_logs_session_idx ON inference_logs (session_id);

-- The pre-session shared demo garden is superseded by on-demand per-session seeding.
DELETE FROM inference_logs WHERE session_id = 'legacy';
DELETE FROM insights WHERE branch_id IN (SELECT id FROM conversations WHERE session_id = 'legacy')
   OR parent_id IN (SELECT id FROM conversations WHERE session_id = 'legacy');
DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE session_id = 'legacy');
DELETE FROM conversations WHERE session_id = 'legacy';
