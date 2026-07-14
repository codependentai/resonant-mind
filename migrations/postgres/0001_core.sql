-- Resonant Mind: Postgres schema foundation
-- Translated from 14 D1/SQLite migrations into final-state Postgres DDL
-- Tables ordered by foreign key dependencies

-- ============================================================
-- PHASE 1: Independent tables (no foreign key dependencies)
-- ============================================================

-- Entities (people, concepts, things)
-- Final state after migration 0014: globally unique by name
CREATE TABLE entities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    primary_context TEXT DEFAULT 'default',
    salience TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relations between entities (uses TEXT names, not FK IDs)
CREATE TABLE relations (
    id SERIAL PRIMARY KEY,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    from_context TEXT DEFAULT 'default',
    to_context TEXT DEFAULT 'default',
    store_in TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active threads (intentions across sessions)
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    thread_type TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'active',
    source TEXT DEFAULT 'self',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution TEXT
);

-- Context layer (situational awareness)
CREATE TABLE context_entries (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    links TEXT DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relational state (feelings toward people)
CREATE TABLE relational_state (
    id SERIAL PRIMARY KEY,
    person TEXT NOT NULL,
    feeling TEXT NOT NULL,
    intensity TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Identity graph
CREATE TABLE identity (
    id SERIAL PRIMARY KEY,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    weight DOUBLE PRECISION DEFAULT 0.7,
    connections TEXT DEFAULT '[]',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Journals (episodic memory)
CREATE TABLE journals (
    id SERIAL PRIMARY KEY,
    entry_date TEXT,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    emotion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notes (deprecated - superseded by observations)
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    weight TEXT DEFAULT 'medium',
    context TEXT DEFAULT 'default',
    emotion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    charge TEXT DEFAULT 'fresh',
    sit_count INTEGER DEFAULT 0,
    last_sat_at TIMESTAMPTZ,
    resolution_note TEXT,
    resolved_at TIMESTAMPTZ,
    linked_insight_id INTEGER REFERENCES notes(id)
);

-- Vault chunks (GPT-era conversation archive)
CREATE TABLE vault_chunks (
    id SERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    era TEXT,
    month TEXT,
    conversation_title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_file, chunk_index)
);

-- Session chunks (Claude Code transcript archive)
CREATE TABLE session_chunks (
    id SERIAL PRIMARY KEY,
    session_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    session_date TEXT,
    project TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_path, chunk_index)
);

-- Subconscious state (daemon processing state, single row)
CREATE TABLE subconscious (
    id SERIAL PRIMARY KEY,
    state_type TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consolidation candidates (daemon-proposed identity integrations)
CREATE TABLE consolidation_candidates (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    suggested_section TEXT,
    suggested_content TEXT,
    evidence TEXT DEFAULT '[]',
    weight DOUBLE PRECISION DEFAULT 0.7,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    resolution TEXT
);

-- Tensions (productive contradictions)
CREATE TABLE tensions (
    id TEXT PRIMARY KEY,
    pole_a TEXT NOT NULL,
    pole_b TEXT NOT NULL,
    context TEXT,
    visits INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_visited TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution TEXT
);

-- ============================================================
-- PHASE 2: Tables depending on entities
-- ============================================================

-- Observations about entities
-- Final state after migrations 0001, 0004, 0005, 0007, 0009, 0010, 0013, 0014
CREATE TABLE observations (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    salience TEXT DEFAULT 'active',
    emotion TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    weight TEXT DEFAULT 'medium',
    updated_at TIMESTAMPTZ,
    charge TEXT DEFAULT 'fresh',
    sit_count INTEGER DEFAULT 0,
    last_sat_at TIMESTAMPTZ,
    resolution_note TEXT,
    resolved_at TIMESTAMPTZ,
    linked_observation_id INTEGER REFERENCES observations(id),
    last_surfaced_at TIMESTAMPTZ,
    surface_count INTEGER DEFAULT 0,
    novelty_score DOUBLE PRECISION DEFAULT 1.0,
    certainty TEXT DEFAULT 'believed',
    source TEXT DEFAULT 'conversation',
    archived_at TIMESTAMPTZ,
    source_date DATE,
    context TEXT DEFAULT 'default'
);

-- ============================================================
-- PHASE 3: Tables depending on observations
-- ============================================================

-- Observation sitting history
CREATE TABLE observation_sits (
    id SERIAL PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    sit_note TEXT,
    sat_at TIMESTAMPTZ DEFAULT NOW()
);

-- Observation revision history
CREATE TABLE observation_versions (
    id SERIAL PRIMARY KEY,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    version_num INTEGER NOT NULL,
    content TEXT NOT NULL,
    weight TEXT,
    emotion TEXT,
    edited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Co-surfacing patterns (observations appearing together)
CREATE TABLE co_surfacing (
    id SERIAL PRIMARY KEY,
    obs_a_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    obs_b_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    co_count INTEGER DEFAULT 1,
    first_co_surfaced TIMESTAMPTZ DEFAULT NOW(),
    last_co_surfaced TIMESTAMPTZ DEFAULT NOW(),
    relation_proposed INTEGER DEFAULT 0,
    relation_created INTEGER DEFAULT 0,
    UNIQUE(obs_a_id, obs_b_id)
);

-- Orphan tracking (observations that never surface)
CREATE TABLE orphan_observations (
    id SERIAL PRIMARY KEY,
    observation_id INTEGER NOT NULL UNIQUE REFERENCES observations(id) ON DELETE CASCADE,
    first_marked TIMESTAMPTZ DEFAULT NOW(),
    rescue_attempts INTEGER DEFAULT 0,
    last_rescue_attempt TIMESTAMPTZ
);

-- Daemon proposals (system-proposed relations)
CREATE TABLE daemon_proposals (
    id SERIAL PRIMARY KEY,
    proposal_type TEXT NOT NULL,
    from_obs_id INTEGER REFERENCES observations(id) ON DELETE CASCADE,
    to_obs_id INTEGER REFERENCES observations(id) ON DELETE CASCADE,
    from_entity_id INTEGER,
    to_entity_id INTEGER,
    reason TEXT NOT NULL,
    confidence DOUBLE PRECISION DEFAULT 0.5,
    status TEXT DEFAULT 'pending',
    proposed_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Note sitting history (deprecated)
CREATE TABLE note_sits (
    id SERIAL PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    sit_note TEXT,
    sat_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PHASE 4: Tables depending on entities + observations
-- ============================================================

-- Images (visual memory)
CREATE TABLE images (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    description TEXT NOT NULL,
    context TEXT,
    emotion TEXT,
    weight TEXT DEFAULT 'medium',
    entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
    observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
    charge TEXT DEFAULT 'fresh',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_viewed_at TIMESTAMPTZ,
    view_count INTEGER DEFAULT 0,
    novelty_score DOUBLE PRECISION DEFAULT 1.0,
    last_surfaced_at TIMESTAMPTZ,
    surface_count INTEGER DEFAULT 0
);

-- ============================================================
-- INDEXES
-- ============================================================

-- entities
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_salience ON entities(salience);

-- observations
CREATE INDEX idx_observations_entity ON observations(entity_id);
CREATE INDEX idx_observations_weight ON observations(weight);
CREATE INDEX idx_observations_charge ON observations(charge);
CREATE INDEX idx_observations_weight_charge ON observations(weight, charge);
CREATE INDEX idx_observations_last_surfaced ON observations(last_surfaced_at);
CREATE INDEX idx_observations_novelty ON observations(novelty_score);
CREATE INDEX idx_observations_surface_count ON observations(surface_count);
CREATE INDEX idx_observations_certainty ON observations(certainty);
CREATE INDEX idx_observations_source ON observations(source);
CREATE INDEX idx_observations_archived ON observations(archived_at);
CREATE INDEX idx_observations_source_date ON observations(source_date);
CREATE INDEX idx_observations_context ON observations(context);

-- relations
-- (no specific index beyond PK in migrations, but useful)

-- threads
CREATE INDEX idx_threads_status ON threads(status);

-- context_entries
CREATE INDEX idx_context_scope ON context_entries(scope);

-- relational_state
CREATE INDEX idx_relational_person ON relational_state(person);

-- identity
CREATE INDEX idx_identity_section ON identity(section);

-- journals
CREATE INDEX idx_journals_date ON journals(entry_date);

-- notes (deprecated)
CREATE INDEX idx_notes_context ON notes(context);
CREATE INDEX idx_notes_charge ON notes(charge);
CREATE INDEX idx_notes_weight_charge ON notes(weight, charge);

-- vault_chunks
CREATE INDEX idx_vault_source ON vault_chunks(source_file);
CREATE INDEX idx_vault_era ON vault_chunks(era);

-- session_chunks
CREATE INDEX idx_session_path ON session_chunks(session_path);
CREATE INDEX idx_session_date ON session_chunks(session_date);

-- subconscious
CREATE INDEX idx_subconscious_type ON subconscious(state_type);

-- consolidation_candidates
CREATE INDEX idx_consolidation_status ON consolidation_candidates(status);

-- tensions
CREATE INDEX idx_tensions_status ON tensions(resolved_at);
CREATE INDEX idx_tensions_created ON tensions(created_at DESC);

-- observation_sits
CREATE INDEX idx_observation_sits_obs ON observation_sits(observation_id);

-- observation_versions
CREATE INDEX idx_observation_versions_obs ON observation_versions(observation_id);
CREATE INDEX idx_observation_versions_num ON observation_versions(observation_id, version_num DESC);

-- co_surfacing
CREATE INDEX idx_co_surfacing_count ON co_surfacing(co_count DESC);
CREATE INDEX idx_co_surfacing_obs_a ON co_surfacing(obs_a_id);
CREATE INDEX idx_co_surfacing_obs_b ON co_surfacing(obs_b_id);

-- orphan_observations
CREATE INDEX idx_orphan_observations_obs ON orphan_observations(observation_id);

-- daemon_proposals
CREATE INDEX idx_daemon_proposals_status ON daemon_proposals(status);

-- note_sits (deprecated)
CREATE INDEX idx_note_sits_note ON note_sits(note_id);

-- images
CREATE INDEX idx_images_entity ON images(entity_id);
CREATE INDEX idx_images_emotion ON images(emotion);
CREATE INDEX idx_images_weight ON images(weight);
CREATE INDEX idx_images_charge ON images(charge);
CREATE INDEX idx_images_novelty ON images(novelty_score);
CREATE INDEX idx_images_last_surfaced ON images(last_surfaced_at);

-- ============================================================
-- PHASE 5: pgvector embeddings (v3.0.0)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
    id          TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id   INTEGER NOT NULL,
    embedding   vector(768) NOT NULL,
    content     TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);
