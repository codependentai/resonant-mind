-- Migration: 0005a_people_nodes_columns.sql
-- Phase C1 / M2a of the reshape (RESHAPE_IMPLEMENTATION.md §3).
-- Add nullable FK columns alongside existing entity_id. CHECK constraints
-- are NOT applied here — they come in 0005d after the handler audit (C4)
-- has populated the new columns consistently.
--
-- Backward compatible: nothing reads these columns yet. Handlers continue to
-- use entity_id unchanged. Reversible: ALTER TABLE ... DROP COLUMN ...

ALTER TABLE observations
    ADD COLUMN IF NOT EXISTS person_id INTEGER,
    ADD COLUMN IF NOT EXISTS node_id INTEGER;

ALTER TABLE images
    ADD COLUMN IF NOT EXISTS person_id INTEGER,
    ADD COLUMN IF NOT EXISTS node_id INTEGER;

ALTER TABLE consolidation_groups
    ADD COLUMN IF NOT EXISTS person_id INTEGER,
    ADD COLUMN IF NOT EXISTS node_id INTEGER;

ALTER TABLE daemon_proposals
    ADD COLUMN IF NOT EXISTS from_person_id INTEGER,
    ADD COLUMN IF NOT EXISTS from_node_id INTEGER,
    ADD COLUMN IF NOT EXISTS to_person_id INTEGER,
    ADD COLUMN IF NOT EXISTS to_node_id INTEGER;
