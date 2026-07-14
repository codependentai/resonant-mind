-- 0006_mood_log.sql — Limbic mood-history layer
--
-- Mood history: one row per daemon tick (~48/day). Gives the Weather region
-- a real trend line (previously the subconscious snapshot was a singleton —
-- every tick overwrote the last; "has this week been heavy?" was unanswerable).
--
-- valence/arousal come from the core-affect centroid (src/daemon/affect.ts);
-- NULL when there wasn't enough mappable emotion signal in the window.
-- coverage = fraction of emotion-token votes the lexicon could map.
--

CREATE TABLE IF NOT EXISTS mood_log (
    id SERIAL PRIMARY KEY,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    dominant TEXT,
    valence DOUBLE PRECISION,
    arousal DOUBLE PRECISION,
    signals INTEGER,
    coverage DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_mood_log_logged_at ON mood_log(logged_at);
