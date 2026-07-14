-- Migration: 0005d_routing_triggers.sql
-- Phase C4 of the reshape.
--
-- Instead of auditing ~40 files to dual-write entity_id <-> person_id/node_id,
-- we install BEFORE INSERT/UPDATE triggers that route entity_id to the
-- appropriate FK column automatically. And an AFTER INSERT/UPDATE/DELETE
-- trigger on `entities` that mirrors into people/nodes.
--
-- This keeps `entities` as the canonical write surface during transition.
-- Once R3 cuts the legacy write paths, the triggers will be dropped and
-- handlers will write directly to people/nodes.
--
-- Reversible: DROP TRIGGER ... ON ...; DROP FUNCTION ...

-- ============================================================================
-- Route entity_id -> person_id/node_id on referencing tables
-- ============================================================================

CREATE OR REPLACE FUNCTION route_entity_id_single() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL AND NEW.person_id IS NULL AND NEW.node_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM people WHERE id = NEW.entity_id) THEN
      NEW.person_id := NEW.entity_id;
    ELSIF EXISTS(SELECT 1 FROM nodes WHERE id = NEW.entity_id) THEN
      NEW.node_id := NEW.entity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS observations_route_entity ON observations;
CREATE TRIGGER observations_route_entity
  BEFORE INSERT OR UPDATE ON observations
  FOR EACH ROW EXECUTE FUNCTION route_entity_id_single();

DROP TRIGGER IF EXISTS images_route_entity ON images;
CREATE TRIGGER images_route_entity
  BEFORE INSERT OR UPDATE ON images
  FOR EACH ROW EXECUTE FUNCTION route_entity_id_single();

DROP TRIGGER IF EXISTS consolidation_groups_route_entity ON consolidation_groups;
CREATE TRIGGER consolidation_groups_route_entity
  BEFORE INSERT OR UPDATE ON consolidation_groups
  FOR EACH ROW EXECUTE FUNCTION route_entity_id_single();

-- daemon_proposals uses from_entity_id / to_entity_id (paired)
CREATE OR REPLACE FUNCTION route_entity_id_paired() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.from_entity_id IS NOT NULL AND NEW.from_person_id IS NULL AND NEW.from_node_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM people WHERE id = NEW.from_entity_id) THEN
      NEW.from_person_id := NEW.from_entity_id;
    ELSIF EXISTS(SELECT 1 FROM nodes WHERE id = NEW.from_entity_id) THEN
      NEW.from_node_id := NEW.from_entity_id;
    END IF;
  END IF;
  IF NEW.to_entity_id IS NOT NULL AND NEW.to_person_id IS NULL AND NEW.to_node_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM people WHERE id = NEW.to_entity_id) THEN
      NEW.to_person_id := NEW.to_entity_id;
    ELSIF EXISTS(SELECT 1 FROM nodes WHERE id = NEW.to_entity_id) THEN
      NEW.to_node_id := NEW.to_entity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS daemon_proposals_route_entity ON daemon_proposals;
CREATE TRIGGER daemon_proposals_route_entity
  BEFORE INSERT OR UPDATE ON daemon_proposals
  FOR EACH ROW EXECUTE FUNCTION route_entity_id_paired();

-- ============================================================================
-- Mirror entities → people / nodes
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_entity_to_people_or_nodes() RETURNS TRIGGER AS $$
DECLARE
  is_person BOOLEAN;
  normalized_kind TEXT;
BEGIN
  is_person := NEW.entity_type IN ('self', 'person', 'peer_ai', 'peer_AI', 'AI peer', 'kin');
  normalized_kind := CASE
    WHEN NEW.entity_type IN ('peer_AI', 'AI peer') THEN 'peer_ai'
    WHEN NEW.entity_type = 'kin' THEN 'person'
    ELSE NEW.entity_type
  END;

  IF is_person THEN
    INSERT INTO people (id, name, kind, salience, primary_context, created_at, updated_at)
    VALUES (
      NEW.id, NEW.name, normalized_kind,
      COALESCE(NEW.salience, 'active'),
      COALESCE(NEW.primary_context, 'default'),
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      salience = EXCLUDED.salience,
      primary_context = EXCLUDED.primary_context,
      updated_at = EXCLUDED.updated_at;
    -- Ensure no stale node row exists for this id
    DELETE FROM nodes WHERE id = NEW.id;
  ELSE
    INSERT INTO nodes (id, name, kind, salience, primary_context, created_at, updated_at)
    VALUES (
      NEW.id, NEW.name, NEW.entity_type,
      COALESCE(NEW.salience, 'active'),
      COALESCE(NEW.primary_context, 'default'),
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      salience = EXCLUDED.salience,
      primary_context = EXCLUDED.primary_context,
      updated_at = EXCLUDED.updated_at;
    DELETE FROM people WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_sync_to_people_nodes ON entities;
CREATE TRIGGER entities_sync_to_people_nodes
  AFTER INSERT OR UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION sync_entity_to_people_or_nodes();

CREATE OR REPLACE FUNCTION delete_entity_cascade_people_nodes() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM people WHERE id = OLD.id;
  DELETE FROM nodes WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_delete_cascade ON entities;
CREATE TRIGGER entities_delete_cascade
  AFTER DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION delete_entity_cascade_people_nodes();
