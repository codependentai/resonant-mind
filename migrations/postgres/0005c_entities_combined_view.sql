-- Migration: 0005c_entities_combined_view.sql
-- Phase C3 of the reshape (RESHAPE_IMPLEMENTATION.md §3-§4).
--
-- The entities_combined view UNIONs people + nodes back into a single
-- entities-shaped read surface. Lets read-only handlers stay nearly
-- unchanged during C4 — they just JOIN to this view instead of entities.
--
-- Shape mirrors the old `entities` table, plus subject_type/person_id/node_id
-- so callers that need to distinguish can do so cheaply.
--
-- Read-only. Reversible: DROP VIEW entities_combined.

CREATE OR REPLACE VIEW entities_combined AS
SELECT
    id,
    name,
    kind AS entity_type,
    salience,
    primary_context,
    created_at,
    updated_at,
    'person' AS subject_type,
    id AS person_id,
    NULL::INTEGER AS node_id
FROM people
UNION ALL
SELECT
    id,
    name,
    kind AS entity_type,
    salience,
    primary_context,
    created_at,
    updated_at,
    'node' AS subject_type,
    NULL::INTEGER AS person_id,
    id AS node_id
FROM nodes;
