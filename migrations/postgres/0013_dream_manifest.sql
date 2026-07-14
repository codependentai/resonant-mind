-- 0013: the dream engine's honesty columns (2026-07-11).
--
-- vectorized_at — closes the permanently-unvectorized-dream trap: the row
-- used to commit before the Vectorize upsert with no record of whether the
-- embedding landed; a failed upsert left the dream invisible to search and
-- recurrence forever. NULL = needs the nightly sweep's retry.
-- Backfilled NOW() for existing rows (their vectors exist).
--
-- composed_by — which voice dreamt the manifest: '@cf/openai/gpt-oss-120b',
-- the fallback model id, or 'template' (floor behavior). Historical rows are
-- 'template' by definition.
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS vectorized_at TIMESTAMPTZ;
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS composed_by TEXT;
UPDATE dreams SET vectorized_at = created_at WHERE vectorized_at IS NULL;
UPDATE dreams SET composed_by = 'template' WHERE composed_by IS NULL;
