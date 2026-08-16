-- Proxy contribution schema（R14.2 Chapter21J Network Contribution System）
CREATE SCHEMA IF NOT EXISTS contribution;

CREATE TABLE IF NOT EXISTS contribution.contributions (
    contribution_id TEXT PRIMARY KEY,
    contributor_principal_id TEXT NOT NULL,
    contribution_type TEXT NOT NULL,
    campaign_id TEXT,
    target_type TEXT NOT NULL,
    target_id TEXT,
    referral_invite_id TEXT,
    attribution_id TEXT NOT NULL,
    state TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    qualified_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    value_created_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ,
    reject_reason TEXT,
    review_access TEXT NOT NULL DEFAULT 'PENDING',
    review_domain TEXT NOT NULL DEFAULT 'PENDING',
    review_reward_gate TEXT NOT NULL DEFAULT 'PENDING',
    reward_vnd BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contribution_contributor ON contribution.contributions (contributor_principal_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_contribution_target ON contribution.contributions (contribution_type, target_type, target_id);

CREATE TABLE IF NOT EXISTS contribution.referral_invites (
    referral_invite_id TEXT PRIMARY KEY,
    contributor_principal_id TEXT NOT NULL,
    campaign_id TEXT,
    invite_code TEXT NOT NULL UNIQUE,
    contribution_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    state TEXT NOT NULL DEFAULT 'ACTIVE'
);
