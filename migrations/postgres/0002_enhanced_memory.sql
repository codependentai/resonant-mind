-- Phase 1: Access tracking for multi-factor retrieval scoring
ALTER TABLE observations ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
ALTER TABLE images ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;
ALTER TABLE images ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_observations_access ON observations(access_count);
CREATE INDEX IF NOT EXISTS idx_observations_last_accessed ON observations(last_accessed_at);

-- Phase 2: Temporal validity for fact management
ALTER TABLE observations ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS superseded_by INTEGER REFERENCES observations(id);
ALTER TABLE observations ADD COLUMN IF NOT EXISTS supersedes INTEGER REFERENCES observations(id);

CREATE INDEX IF NOT EXISTS idx_observations_valid_until ON observations(valid_until);
CREATE INDEX IF NOT EXISTS idx_observations_superseded ON observations(superseded_by);

-- Phase 3: Consolidation groups and reflection journals
CREATE TABLE IF NOT EXISTS consolidation_groups (
    id SERIAL PRIMARY KEY,
    summary TEXT NOT NULL,
    entity_id INTEGER REFERENCES entities(id),
    source_observation_ids INTEGER[] NOT NULL,
    consolidated_observation_id INTEGER REFERENCES observations(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consolidation_entity ON consolidation_groups(entity_id);

ALTER TABLE journals ADD COLUMN IF NOT EXISTS journal_type TEXT DEFAULT 'entry';
CREATE INDEX IF NOT EXISTS idx_journals_type ON journals(journal_type);
