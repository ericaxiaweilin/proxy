CREATE SCHEMA IF NOT EXISTS marketplace;

CREATE TABLE IF NOT EXISTS marketplace.opportunities (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    responses INTEGER NOT NULL DEFAULT 0 CHECK (responses >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_opportunities_created_at
    ON marketplace.opportunities (created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace.applications (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL REFERENCES marketplace.opportunities(id) ON DELETE CASCADE,
    applicant_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (opportunity_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS marketplace.dismissals (
    opportunity_id TEXT NOT NULL REFERENCES marketplace.opportunities(id) ON DELETE CASCADE,
    viewer_id TEXT NOT NULL,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (opportunity_id, viewer_id)
);

COMMENT ON TABLE marketplace.opportunities IS
    'Durable market opportunity aggregates. Mobile renders server data and never owns this dataset.';
COMMENT ON TABLE marketplace.applications IS
    'Durable creator applications, unique per opportunity and applicant.';
COMMENT ON TABLE marketplace.dismissals IS
    'Per-viewer opportunity visibility preference; never bundled into the client.';
