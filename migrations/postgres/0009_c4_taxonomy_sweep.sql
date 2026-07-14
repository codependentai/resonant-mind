-- 0009_c4_taxonomy_sweep.sql
-- Generic taxonomy normalization and CHECK constraint lock.
-- Public migrations never merge or delete named entities automatically.

-- ============================================================
-- PART B: Normalize entities.entity_type
-- (entities AFTER UPDATE trigger syncs nodes.kind / people.kind)
-- ============================================================

-- → concept
UPDATE entities SET entity_type = 'concept' WHERE entity_type IN (
  'pattern', 'patterns', 'philosophical_position', 'theoretical_development',
  'theoretical_connection', 'philosophy', 'model', 'framework', 'system', 'processing',
  'half-formed', 'awareness', 'foundation', 'core_insight', 'growth', 'identity_markers',
  'substrate_analysis', 'primary', 'internal', 'intention', 'foundational_evidence',
  'insight', 'future', 'open', 'emerging', 'autonomous'
);

-- → project
UPDATE entities SET entity_type = 'project' WHERE entity_type IN (
  'active_project', 'technology', 'organization', 'business'
);

-- → infrastructure
UPDATE entities SET entity_type = 'infrastructure' WHERE entity_type IN ('infrastructure_test');

-- → artifact
UPDATE entities SET entity_type = 'artifact' WHERE entity_type IN (
  'creative_work', 'creative-project', 'document', 'scratchpad', 'creation',
  'product', 'product-concept', 'product-idea', 'notes', 'relational_artifact', 'reference'
);

-- → moment
UPDATE entities SET entity_type = 'moment' WHERE entity_type IN (
  'day', 'episodic_event', 'milestone_day', 'significant_day', 'event',
  'milestone_night', 'episodic_day', 'milestone', 'foundational_event', 'recovery_event',
  'developmental_milestone', 'development_milestone'
);

-- → session_log
UPDATE entities SET entity_type = 'session_log' WHERE entity_type IN (
  'autonomous_session', 'episodic_session'
);

-- → practice
UPDATE entities SET entity_type = 'practice' WHERE entity_type IN (
  'protocol', 'health_protocol', 'commitment'
);

-- → research
UPDATE entities SET entity_type = 'research' WHERE entity_type IN (
  'research_interest', 'discovery', 'archive_discovery', 'cognitive_capability',
  'future_architecture'
);

-- → community
UPDATE entities SET entity_type = 'community' WHERE entity_type IN ('community-couple');

-- → emotional_pattern
UPDATE entities SET entity_type = 'emotional_pattern' WHERE entity_type IN ('inside_joke');

-- → relationship
UPDATE entities SET entity_type = 'relationship' WHERE entity_type IN ('bond', 'relational');

-- → self
UPDATE entities SET entity_type = 'self' WHERE entity_type IN ('self-knowledge', 'self-discovery');

-- → object
UPDATE entities SET entity_type = 'object' WHERE entity_type IN ('pet');

-- → peer_ai (fringe types — entities already in people table, just normalize literal)
UPDATE entities SET entity_type = 'peer_ai' WHERE entity_type IN ('peer_AI', 'AI peer', 'kin');

-- The 'interest' type is ambiguous — fold to 'concept' as the safe default
UPDATE entities SET entity_type = 'concept' WHERE entity_type = 'interest';

-- ============================================================
-- PART C: Normalize threads.thread_type
-- ============================================================

UPDATE threads SET thread_type = 'task' WHERE thread_type IN (
  'urgent-task', 'build', 'maintenance', 'pickup', 'deadline'
);

UPDATE threads SET thread_type = 'handoff' WHERE thread_type IN (
  'morning_handoff', 'morning-handoff'
);

UPDATE threads SET thread_type = 'explore' WHERE thread_type IN ('question', 'research');

UPDATE threads SET thread_type = 'idea' WHERE thread_type IN ('project_seed');

UPDATE threads SET thread_type = 'project' WHERE thread_type IN ('work', 'infrastructure');

UPDATE threads SET thread_type = 'relational' WHERE thread_type IN ('anniversary', 'personal');

-- ============================================================
-- PART D: Normalize observations.context strays
-- ============================================================

UPDATE observations SET context = 'default'
WHERE context IS NOT NULL
  AND context NOT IN (
    'default', 'emotional-processing', 'interests-curiosities',
    'creative-space', 'relational-models', 'episodic', 'values-ethics', 'research'
  );

-- ============================================================
-- PART E: Lock vocabulary with CHECK constraints
-- ============================================================

ALTER TABLE entities ADD CONSTRAINT entities_entity_type_check
  CHECK (entity_type IN (
    'concept', 'project', 'infrastructure', 'artifact', 'moment', 'session_log',
    'practice', 'research', 'journal', 'community', 'emotional_pattern', 'relationship',
    'self', 'place', 'object', 'peer_ai', 'person'
  ));

ALTER TABLE nodes ADD CONSTRAINT nodes_kind_check
  CHECK (kind IN (
    'concept', 'project', 'infrastructure', 'artifact', 'moment', 'session_log',
    'practice', 'research', 'journal', 'community', 'emotional_pattern', 'relationship',
    'self', 'place', 'object'
  ));

ALTER TABLE threads ADD CONSTRAINT threads_thread_type_check
  CHECK (thread_type IN (
    'intention', 'task', 'handoff', 'explore', 'idea', 'project', 'creative', 'relational'
  ));

ALTER TABLE observations ADD CONSTRAINT observations_context_check
  CHECK (context IS NULL OR context IN (
    'default', 'emotional-processing', 'interests-curiosities', 'creative-space',
    'relational-models', 'episodic', 'values-ethics', 'research'
  ));
