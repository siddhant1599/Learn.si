-- Ask chats are stored on the server as their source of truth (shown on every device):
-- each saved answer keeps its activity steps and warnings, and conversations know when
-- they last changed so they can be listed newest first. Idempotent like every migration.
ALTER TABLE rag.messages ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]';
ALTER TABLE rag.messages ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]';
ALTER TABLE rag.conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE rag.conversations c SET updated_at = COALESCE(
    (SELECT max(m.created_at) FROM rag.messages m WHERE m.conversation_id = c.id), c.created_at)
WHERE c.updated_at IS NULL;
ALTER TABLE rag.conversations ALTER COLUMN updated_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON rag.conversations (updated_at DESC);
