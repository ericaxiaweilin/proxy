CREATE SCHEMA IF NOT EXISTS activity;

CREATE TABLE IF NOT EXISTS activity.activities (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    interested_count INTEGER NOT NULL DEFAULT 0 CHECK (interested_count >= 0),
    joined_count INTEGER NOT NULL DEFAULT 0 CHECK (joined_count >= 0),
    capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity.interests (
    activity_id TEXT NOT NULL REFERENCES activity.activities(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, actor_id)
);

CREATE TABLE IF NOT EXISTS activity.participants (
    activity_id TEXT NOT NULL REFERENCES activity.activities(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, actor_id)
);

COMMENT ON TABLE activity.activities IS 'Durable activity catalog and authoritative aggregate counters.';
COMMENT ON TABLE activity.interests IS 'Per-account reversible interest state.';
COMMENT ON TABLE activity.participants IS 'Confirmed activity participation; unique per account and activity.';
