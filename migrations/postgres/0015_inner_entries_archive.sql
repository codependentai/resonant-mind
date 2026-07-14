-- 0015_inner_entries_archive.sql — Mind Reshape 2, Gate D (retention pass)
--
-- inner_entries gets a soft-archive stamp: the retention daemon pass sets
-- archived_at on satisfied quiet-wants older than 90 days (small_joy rows
-- never get satisfied_at, so they're never touched by this). Existing
-- readers of inner_entries already filter WHERE satisfied_at IS NULL for
-- their open-want queries, so they never see archived rows regardless —
-- this column exists for future archived-aware reads, not to unbreak
-- anything broken today (verified during Wave 3 build, see
-- docs/reshape-2/RESHAPE-2-SPEC.md Gate D).
--
-- Idempotent — safe to run on a tenant that already has the column.

ALTER TABLE inner_entries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
