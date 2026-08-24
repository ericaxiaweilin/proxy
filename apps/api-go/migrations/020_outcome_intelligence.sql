-- M6.5 Outcome Intelligence — ObservationSet, Observation, Delta, Learning

CREATE SCHEMA IF NOT EXISTS outcome;

CREATE TABLE IF NOT EXISTS outcome.observation_sets (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    finalized_at TIMESTAMPTZ,
    CHECK (status IN ('DRAFT','FINALIZED'))
);

CREATE TABLE IF NOT EXISTS outcome.observations (
    id TEXT PRIMARY KEY,
    set_id TEXT NOT NULL REFERENCES outcome.observation_sets(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS outcome.deltas (
    id TEXT PRIMARY KEY,
    baseline_id TEXT NOT NULL,
    result_id TEXT NOT NULL,
    result TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS outcome.learnings (
    id TEXT PRIMARY KEY,
    delta_id TEXT NOT NULL REFERENCES outcome.deltas(id),
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (status IN ('SUGGESTED','CONFIRMED','DISMISSED'))
);
