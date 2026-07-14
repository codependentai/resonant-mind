-- Migration: 0017_schema_cleanup.sql
-- Mind Reshape 2, Wave 4 — Gates E, I, J (RESHAPE-2-SPEC.md).
--
-- Idempotent throughout (IF EXISTS guards, CREATE OR REPLACE for the
-- trigger function). Safe to re-run.

-- ============================================================================
-- Gate E — drop consolidation_candidates
-- ============================================================================
-- Fossil of an earlier identity-integration review queue design. Confirmed
-- dead: zero readers, zero writers anywhere in src/ (grep-verified, Wave 4
-- build, 2026-07-11). Its niche — surfacing candidate identity/compass
-- material for review — is now served by runIdentityHunt -> daemon_proposals
-- -> ritual_tend. Reviving would duplicate identity-hunt, not extend it.

DROP TABLE IF EXISTS consolidation_candidates;

-- ============================================================================
-- Gate I — M2 fossils: entities_combined view + daemon_proposals FK columns
-- ============================================================================
-- entities_combined (0005c) was a read-shim UNIONing people+nodes back into
-- an entities shape during the C4 transition. Zero readers in src/ today
-- (grep-verified) — drop it.

DROP VIEW IF EXISTS entities_combined;

-- The daemon_proposals_route_entity trigger (0005d) writes
-- from_person_id/from_node_id/to_person_id/to_node_id on every proposal
-- insert/update. Zero code in src/ reads any of the four columns
-- (grep-verified) — live write, no reader. Before dropping the columns,
-- the trigger function must stop writing them, or every proposal INSERT
-- breaks the moment the columns disappear underneath it. Function replace
-- FIRST, column drop SECOND — same file, strict order.
--
-- This CREATE OR REPLACE is byte-faithful to 0005d's route_entity_id_paired()
-- with only the four column-write branches removed; the trigger itself
-- (daemon_proposals_route_entity) is untouched and keeps firing — it's just
-- a no-op on daemon_proposals now. Left in place rather than dropped: it's
-- inert, and dropping/recreating triggers is more moving parts than a
-- no-op function body for the same end state.

CREATE OR REPLACE FUNCTION route_entity_id_paired() RETURNS TRIGGER AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop the CHECK constraints (0005e) that reference the four columns before
-- dropping the columns themselves.
ALTER TABLE daemon_proposals DROP CONSTRAINT IF EXISTS dprops_from_check;
ALTER TABLE daemon_proposals DROP CONSTRAINT IF EXISTS dprops_to_check;

ALTER TABLE daemon_proposals DROP COLUMN IF EXISTS from_person_id;
ALTER TABLE daemon_proposals DROP COLUMN IF EXISTS from_node_id;
ALTER TABLE daemon_proposals DROP COLUMN IF EXISTS to_person_id;
ALTER TABLE daemon_proposals DROP COLUMN IF EXISTS to_node_id;

-- NOTE (Gate I, deferred per spec): images.person_id/node_id and
-- consolidation_groups.person_id/node_id are NOT touched here. They're
-- inert (no trigger cost since route_entity_id_single() only fires on
-- INSERT/UPDATE, not a continuous write like the paired trigger was) and
-- Gate I explicitly defers them to a later sweep. Do not drop in this
-- migration.

-- ============================================================================
-- Gate J — re-proposal on new evidence: co_count_at_resolution
-- ============================================================================
-- Stamped on rejection with the pair's co_surfacing.co_count at that moment.
-- NULL for rejections with no co_surfacing pair (proximity/compass/identity
-- proposals) or predating this migration — those stay sticky forever, no
-- retroactive re-proposal flood. See src/daemon/proposals.ts eligibility
-- query and src/legacy-tools/proposals.ts 'reject' action.

ALTER TABLE daemon_proposals ADD COLUMN IF NOT EXISTS co_count_at_resolution INTEGER;
