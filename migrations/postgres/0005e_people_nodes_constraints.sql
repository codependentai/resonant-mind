-- Migration: 0005e_people_nodes_constraints.sql
-- Phase C5 / M2d of the reshape (RESHAPE_IMPLEMENTATION.md §3).
--
-- CHECK constraints to enforce: at most one of person_id/node_id is set
-- on each row. observations.entity_id is NOT NULL so its constraint can
-- demand exactly one set (the trigger guarantees this). Other tables
-- (images, consolidation_groups, daemon_proposals) allow null entity_id
-- so we only forbid the both-set case.
--
-- Validated pre-flight: 0 'neither' and 0 'both' rows in observations.
-- 3 'neither' in images (rows without any entity link — expected and
-- allowed under the weak CHECK).
--
-- Reversible: ALTER TABLE ... DROP CONSTRAINT ...

ALTER TABLE observations
  ADD CONSTRAINT observations_subject_check
  CHECK ((person_id IS NULL) <> (node_id IS NULL));

ALTER TABLE images
  ADD CONSTRAINT images_subject_check
  CHECK (NOT (person_id IS NOT NULL AND node_id IS NOT NULL));

ALTER TABLE consolidation_groups
  ADD CONSTRAINT cgroups_subject_check
  CHECK (NOT (person_id IS NOT NULL AND node_id IS NOT NULL));

ALTER TABLE daemon_proposals
  ADD CONSTRAINT dprops_from_check
  CHECK (NOT (from_person_id IS NOT NULL AND from_node_id IS NOT NULL));

ALTER TABLE daemon_proposals
  ADD CONSTRAINT dprops_to_check
  CHECK (NOT (to_person_id IS NOT NULL AND to_node_id IS NOT NULL));
