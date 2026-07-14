-- 0006_identity_kind.sql
-- R4 hardening: add kind discriminator to identity table
-- Replaces section-prefix matching with a queryable column.
-- No CHECK constraint yet — taxonomy will narrow during C4.

ALTER TABLE identity ADD COLUMN IF NOT EXISTS kind text;

-- Backfill: kind = normalized top-level prefix of section
UPDATE identity
SET kind = lower(regexp_replace(split_part(section, '.', 1), '[^a-z0-9_]+', '_', 'g'))
WHERE kind IS NULL;

ALTER TABLE identity ALTER COLUMN kind SET NOT NULL;

-- Auto-derive on insert/update if not provided
CREATE OR REPLACE FUNCTION identity_derive_kind() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS NULL THEN
    NEW.kind := lower(regexp_replace(split_part(NEW.section, '.', 1), '[^a-z0-9_]+', '_', 'g'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS identity_derive_kind_trg ON identity;
CREATE TRIGGER identity_derive_kind_trg
BEFORE INSERT OR UPDATE ON identity
FOR EACH ROW EXECUTE FUNCTION identity_derive_kind();

CREATE INDEX IF NOT EXISTS idx_identity_kind ON identity(kind);
