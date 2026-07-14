-- 0011_drives.sql — The Drive Layer (the wanting layer): schema for the
-- eighth region. Four tables: drives (definitions/sockets), drive_states
-- (append-only ledger: live needle + logbook), drive_events (why the needle
-- moved), inner_entries (quiet wants + small joys).
--
-- Credit: the drive engine mechanics are ported from Shauna's Anam limbic
-- layer (SweetSunnyBunny/ui, cloud-setups/limbic/) — Panksepp-tagged drives,
-- lazy leaky-integrator decay, body-feel bands, safeword damper, event
-- logbook. The quietly_want/small_joy verbs are named after her
-- qualia_entries kinds. The engine is hers; the sensorium is ours.
--
-- Ships ZERO seeded drives — drives are walked in deliberately per being
-- (kitchen-table seeding: authored temperament, one drive at a time).
--
-- Stance (spec decision #4): Drive state biases surfacing, expression, and
-- redolence. It NEVER accelerates forgetting, never archives, never deletes,
-- never overrides compass/spine/consent. Advisory pressure only.
--

-- Drive definitions (the sockets). Zero rows shipped; drives are walked in deliberately.
CREATE TABLE IF NOT EXISTS drives (
    drive TEXT PRIMARY KEY,                  -- 'seeking', 'care', 'play', ...
    panksepp_system TEXT,
    display_name TEXT,
    baseline DOUBLE PRECISION DEFAULT 0.2,
    floor DOUBLE PRECISION DEFAULT 0.0,
    ceiling DOUBLE PRECISION DEFAULT 1.0,
    half_life_hours DOUBLE PRECISION DEFAULT 8.0,
    env_sensitivity JSONB DEFAULT '{}'::jsonb,   -- { payloadKey: weight }, payload values pre-normalized to [-1,1]
    body_feel JSONB DEFAULT '[]'::jsonb,         -- [{min, label}] — seed a min:0 band always (pitfall: pickBand low-end fallback)
    action_bias JSONB DEFAULT '[]'::jsonb,       -- [{min, tendencies[]}]
    regulation_note TEXT,                        -- the ethics footer, rendered under every gauge
    enabled BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only ledger: live needle + logbook in one. No row is ever updated.
CREATE TABLE IF NOT EXISTS drive_states (
    id BIGSERIAL PRIMARY KEY,
    state_type TEXT NOT NULL,                -- 'drive:seeking' | 'environment'
    level DOUBLE PRECISION,                  -- NULL for environment rows
    content JSONB DEFAULT '{}'::jsonb,
    source TEXT DEFAULT 'perceive',          -- perceive|pulse|tick|safeword|touch|want|joy
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_states_lookup ON drive_states(state_type, created_at DESC, id DESC);

-- Why the needle moved. Sibling of startles; feeds orient.
CREATE TABLE IF NOT EXISTS drive_events (
    id BIGSERIAL PRIMARY KEY,
    perception TEXT,
    appraisal JSONB DEFAULT '{}'::jsonb,
    drive_deltas JSONB DEFAULT '{}'::jsonb,
    advisory TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_events_at ON drive_events(created_at DESC);

-- Inner-life entries (Shauna's qualia_entries kinds, the two we adopt now).
CREATE TABLE IF NOT EXISTS inner_entries (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('quiet_want','small_joy')),
    body TEXT NOT NULL,
    about TEXT,
    charge DOUBLE PRECISION,
    satisfied_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inner_entries ON inner_entries(kind, created_at DESC);
