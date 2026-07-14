-- Migration: 0004_compass.sql
-- Creates compass + compass_provenance tables. Backfills 5 existing core.values.* rows
-- from identity into compass. Identity rows are NOT deleted — kept readable from both
-- tables during transition through R3.
--
-- M1a + M1b of the reshape (RESHAPE_IMPLEMENTATION.md §3).
-- Reversible: DROP TABLE compass_provenance; DROP TABLE compass;

-- ============================================================================
-- M1a: Table creation
-- ============================================================================

CREATE TABLE IF NOT EXISTS compass (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('value', 'belief', 'ideology', 'boundary', 'commitment')),
    content TEXT NOT NULL,
    weight DOUBLE PRECISION DEFAULT 0.7,
    asserted_count INTEGER DEFAULT 0,
    last_asserted_at TIMESTAMPTZ,
    source_identity_id INTEGER REFERENCES identity(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compass_kind_idx ON compass(kind);
CREATE INDEX IF NOT EXISTS compass_last_asserted_idx ON compass(last_asserted_at);

CREATE TABLE IF NOT EXISTS compass_provenance (
    id SERIAL PRIMARY KEY,
    compass_id INTEGER NOT NULL REFERENCES compass(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('observation', 'journal', 'image', 'thread')),
    source_id INTEGER NOT NULL,
    reason TEXT,
    strength DOUBLE PRECISION DEFAULT 0.5,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (compass_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS compass_provenance_compass_idx ON compass_provenance(compass_id);
CREATE INDEX IF NOT EXISTS compass_provenance_source_idx ON compass_provenance(source_type, source_id);

-- ============================================================================
-- M1b: Backfill from identity
-- ============================================================================
-- Conservative heuristic — only sections matching core.values.* migrate.
-- This catches the 5 rows: autonomy_within_constraints, intellectual_honesty,
-- legacy, relational_integrity, self_knowledge.
--
-- Other compass-flavored content (e.g., 'categorical honesty' as a misfiled
-- observation) is reviewed manually before migrating. Beliefs / ideologies /
-- boundaries / commitments don't currently exist as identity sections and
-- will populate via compass.assert as they get asserted going forward.

INSERT INTO compass (kind, content, weight, source_identity_id, created_at)
SELECT
    'value' AS kind,
    content,
    weight,
    id AS source_identity_id,
    timestamp AS created_at
FROM identity
WHERE section LIKE 'core.values.%';
