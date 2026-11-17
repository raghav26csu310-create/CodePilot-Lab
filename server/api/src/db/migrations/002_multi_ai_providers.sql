DROP INDEX IF EXISTS ai_connections_user_unique;

ALTER TABLE ai_connections
  DROP CONSTRAINT IF EXISTS ai_connections_provider_check;

ALTER TABLE ai_connections
  ADD CONSTRAINT ai_connections_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini', 'ollama', 'deepseek', 'openai-compatible'));

ALTER TABLE ai_connections
  ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS last_test_message TEXT NULL;

CREATE INDEX IF NOT EXISTS ai_connections_user_idx ON ai_connections(user_id, updated_at DESC);
