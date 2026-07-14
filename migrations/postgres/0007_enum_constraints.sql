-- 0007_enum_constraints.sql
-- plan-C5 hardening (partial): CHECK constraints on clean enum columns.
-- Defers dirty columns (entities.entity_type, threads.thread_type,
-- observations.context) to C4 taxonomy sweep.

-- Pre-clean strays
UPDATE observations
SET salience = 'foundational'
WHERE salience NOT IN ('active', 'high', 'background', 'foundational', 'medium', 'heavy');

UPDATE threads SET status = 'active' WHERE status IN ('developing', 'draft-written');
UPDATE threads SET priority = 'medium' WHERE priority IN ('active', 'normal');
UPDATE relational_state SET intensity = 'strong' WHERE intensity = 'high';

-- observations
ALTER TABLE observations ADD CONSTRAINT observations_weight_check
  CHECK (weight IN ('light', 'medium', 'heavy'));
ALTER TABLE observations ADD CONSTRAINT observations_charge_check
  CHECK (charge IN ('fresh', 'active', 'processing', 'metabolized'));
ALTER TABLE observations ADD CONSTRAINT observations_certainty_check
  CHECK (certainty IN ('believed', 'known', 'tentative'));
ALTER TABLE observations ADD CONSTRAINT observations_source_check
  CHECK (source IN ('conversation', 'realization', 'external', 'consolidated', 'inferred', 'journal'));
ALTER TABLE observations ADD CONSTRAINT observations_salience_check
  CHECK (salience IN ('active', 'high', 'background', 'foundational', 'medium', 'heavy'));

-- threads
ALTER TABLE threads ADD CONSTRAINT threads_status_check
  CHECK (status IN ('active', 'resolved'));
ALTER TABLE threads ADD CONSTRAINT threads_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent', 'critical'));

-- relational_state
ALTER TABLE relational_state ADD CONSTRAINT relational_state_intensity_check
  CHECK (intensity IN ('whisper', 'present', 'strong', 'overwhelming'));
