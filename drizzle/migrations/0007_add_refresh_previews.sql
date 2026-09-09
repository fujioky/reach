-- 0007_add_refresh_previews.sql
-- Pending refresh preview storage for the new preview-before-apply refresh flow.

CREATE TABLE IF NOT EXISTS refresh_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS refresh_previews_content_item_id_idx
  ON refresh_previews(content_item_id);

CREATE INDEX IF NOT EXISTS refresh_previews_expires_at_idx
  ON refresh_previews(expires_at);
