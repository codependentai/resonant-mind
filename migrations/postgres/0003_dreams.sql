-- Migration: 0003_dreams.sql
-- Adds persistent dreams and recurrence state. No data movement. Idempotent.

CREATE TABLE IF NOT EXISTS dreams (
    id SERIAL PRIMARY KEY,
    dream_date TEXT NOT NULL,
    content TEXT NOT NULL,
    emotional_seed TEXT,
    fragments TEXT,
    recurring_dream_id INTEGER REFERENCES dreams(id) ON DELETE SET NULL,
    recurrence_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dreams_date ON dreams(dream_date);
CREATE INDEX IF NOT EXISTS idx_dreams_recurring ON dreams(recurring_dream_id);
