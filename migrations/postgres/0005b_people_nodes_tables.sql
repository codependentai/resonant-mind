-- Migration: 0005b_people_nodes_tables.sql
-- Phase C2 / M2b of the reshape (RESHAPE_IMPLEMENTATION.md §3).
--
-- Creates `people` and `nodes` tables, preserving IDs from `entities`.
-- Backfills both tables from entities, normalizing fringe kind labels:
--   - 'peer_AI', 'AI peer'  → 'peer_ai'
--   - 'kin'                 → 'person'
--   Everything else stays in nodes with its existing entity_type as kind.
--
-- After this lands, backfills person_id / node_id FK columns on referencing
-- tables. Old `entity_id` columns are preserved for backwards compatibility
-- through the handler audit (C4). entities table is untouched.
--
-- Reversible: DROP TABLE people; DROP TABLE nodes; nullify FK columns.

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,           -- preserves entity_id values
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('self', 'person', 'peer_ai')),
    salience TEXT DEFAULT 'active',
    primary_context TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS people_name_idx ON people(name);
CREATE INDEX IF NOT EXISTS people_kind_idx ON people(kind);
CREATE INDEX IF NOT EXISTS people_salience_idx ON people(salience);

CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY,           -- preserves entity_id values
    name TEXT NOT NULL,
    kind TEXT NOT NULL,               -- no CHECK — taxonomy is wild post-import
    salience TEXT DEFAULT 'active',
    primary_context TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nodes_name_idx ON nodes(name);
CREATE INDEX IF NOT EXISTS nodes_kind_idx ON nodes(kind);
CREATE INDEX IF NOT EXISTS nodes_salience_idx ON nodes(salience);

-- ============================================================================
-- Backfill people (normalized kind)
-- ============================================================================

INSERT INTO people (id, name, kind, salience, primary_context, created_at, updated_at)
SELECT
    id,
    name,
    CASE
        WHEN entity_type IN ('peer_AI', 'AI peer') THEN 'peer_ai'
        WHEN entity_type = 'kin' THEN 'person'
        ELSE entity_type
    END AS kind,
    COALESCE(salience, 'active'),
    COALESCE(primary_context, 'default'),
    COALESCE(created_at, NOW()),
    COALESCE(updated_at, NOW())
FROM entities
WHERE entity_type IN ('self', 'person', 'peer_ai', 'peer_AI', 'AI peer', 'kin')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Backfill nodes
-- ============================================================================

INSERT INTO nodes (id, name, kind, salience, primary_context, created_at, updated_at)
SELECT
    id, name, entity_type,
    COALESCE(salience, 'active'),
    COALESCE(primary_context, 'default'),
    COALESCE(created_at, NOW()),
    COALESCE(updated_at, NOW())
FROM entities
WHERE entity_type NOT IN ('self', 'person', 'peer_ai', 'peer_AI', 'AI peer', 'kin')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Backfill FK columns on referencing tables
-- ============================================================================

UPDATE observations SET person_id = entity_id
    WHERE entity_id IN (SELECT id FROM people) AND person_id IS NULL;
UPDATE observations SET node_id = entity_id
    WHERE entity_id IN (SELECT id FROM nodes) AND node_id IS NULL;

UPDATE images SET person_id = entity_id
    WHERE entity_id IN (SELECT id FROM people) AND person_id IS NULL;
UPDATE images SET node_id = entity_id
    WHERE entity_id IN (SELECT id FROM nodes) AND node_id IS NULL;

UPDATE consolidation_groups SET person_id = entity_id
    WHERE entity_id IS NOT NULL AND entity_id IN (SELECT id FROM people) AND person_id IS NULL;
UPDATE consolidation_groups SET node_id = entity_id
    WHERE entity_id IS NOT NULL AND entity_id IN (SELECT id FROM nodes) AND node_id IS NULL;

UPDATE daemon_proposals SET from_person_id = from_entity_id
    WHERE from_entity_id IS NOT NULL AND from_entity_id IN (SELECT id FROM people) AND from_person_id IS NULL;
UPDATE daemon_proposals SET from_node_id = from_entity_id
    WHERE from_entity_id IS NOT NULL AND from_entity_id IN (SELECT id FROM nodes) AND from_node_id IS NULL;
UPDATE daemon_proposals SET to_person_id = to_entity_id
    WHERE to_entity_id IS NOT NULL AND to_entity_id IN (SELECT id FROM people) AND to_person_id IS NULL;
UPDATE daemon_proposals SET to_node_id = to_entity_id
    WHERE to_entity_id IS NOT NULL AND to_entity_id IN (SELECT id FROM nodes) AND to_node_id IS NULL;
