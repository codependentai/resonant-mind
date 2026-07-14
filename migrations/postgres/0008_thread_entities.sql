-- 0008_thread_entities.sql
-- Open Q3: explicit thread → entity join table.
-- Removes substring matching in bond_enter; provides stable graph edge
-- for future explicit tagging.

CREATE TABLE IF NOT EXISTS thread_entities (
  id SERIAL PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'mentioned',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(thread_id, entity_id, role)
);

CREATE INDEX IF NOT EXISTS idx_thread_entities_thread ON thread_entities(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_entities_entity ON thread_entities(entity_id);

-- Backfill from current substring matching (person names only, ≥3 chars).
-- Mirrors the existing bond_enter logic so backfill captures everything
-- that was previously findable.
INSERT INTO thread_entities (thread_id, entity_id, role)
SELECT DISTINCT t.id, p.id, 'mentioned'
FROM threads t
JOIN people p ON (
  t.content ILIKE '%' || p.name || '%'
  OR (t.context IS NOT NULL AND t.context ILIKE '%' || p.name || '%')
)
WHERE length(p.name) >= 3
ON CONFLICT (thread_id, entity_id, role) DO NOTHING;
