-- Gate G (RESHAPE-2): images metabolism — deep-archive candidacy needs a
-- place to land. images had the full novelty/surfaced/count schema but no
-- archived_at column, so nothing could ever quiet a visual memory. Idempotent.

ALTER TABLE images ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_images_archived ON images(archived_at);
