-- 0010_backfill_live_schema.sql — Adds startle and somatic-marker structures.
-- Idempotent for fresh installs and upgrades.
--
-- 1. `startles` — the fast-path amygdala. Written at observation write time
--    by checkStartle (src/daemon/somatic.ts): INSERT (observation_id, content,
--    valence, arousal). Read by orient (src/legacy-tools/orient.ts): SELECT
--    id, content, valence, arousal WHERE acknowledged_at IS NULL AND
--    created_at within 48h, then UPDATE ... SET acknowledged_at. Counted by
--    the daemon tick (src/daemon/index.ts) with the same 48h/unacked filter.
--
-- 2. `entities.affect_valence / affect_arousal / affect_n` — L4 somatic
--    markers. Batch-updated every daemon tick by computeSomaticMarkers
--    (src/daemon/somatic.ts); read by bond_enter / mind_read_entity
--    (src/regions/bonds.ts).
--
-- Note: migration numbering has a pre-existing collision at 0006
-- (0006_identity_kind.sql and 0006_mood_log.sql). This file takes 0010, the
-- first truly-free number; the drive-layer migration takes 0011.

-- 1. Startle reflex table
CREATE TABLE IF NOT EXISTS startles (
    id SERIAL PRIMARY KEY,
    observation_id INTEGER,
    content TEXT,
    valence DOUBLE PRECISION,
    arousal DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
);

-- Orient + daemon both filter on unacked-within-48h.
CREATE INDEX IF NOT EXISTS idx_startles_acked_created
    ON startles(acknowledged_at, created_at);

-- 2. Somatic-marker columns on entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS affect_valence DOUBLE PRECISION;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS affect_arousal DOUBLE PRECISION;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS affect_n INTEGER;
