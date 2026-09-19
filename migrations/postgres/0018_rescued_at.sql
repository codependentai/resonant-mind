-- Preserve a deliberate rescue until the observation genuinely surfaces.
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS rescued_at TIMESTAMPTZ;

COMMENT ON COLUMN observations.rescued_at IS
  'Time an archived observation was restored; pending while last_surfaced_at is null';
