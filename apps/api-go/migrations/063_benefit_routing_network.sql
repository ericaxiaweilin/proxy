CREATE SCHEMA IF NOT EXISTS benefit;
-- R0: Benefit Routing Network core schema
-- Covers: Campaign, BenefitDefinition, Allocation, Offer, Claim, Redemption, Settlement, Capacity

-- ============================================================
-- 1. Campaign Types Enum
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.campaign_type AS ENUM (
    'SCENE_IGNITION',
    'CREATOR_SEED',
    'NEW_TO_SCENE',
    'REACTIVATION',
    'NEWCOMER',
    'ACTIVITY_ATTACH',
    'ORDER_COMPLETION',
    'CREATOR_GIFT',
    'MERCHANT_CAMPAIGN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE benefit.campaign_status AS ENUM (
    'DRAFT',
    'REVIEW',
    'SCHEDULED',
    'ACTIVE',
    'PAUSED',
    'ENDED',
    'EXHAUSTED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Campaign — core entity
-- ============================================================
CREATE TABLE IF NOT EXISTS benefit.campaigns (
  campaign_id   TEXT PRIMARY KEY,
  campaign_type benefit.campaign_type NOT NULL,
  status        benefit.campaign_status NOT NULL DEFAULT 'DRAFT',
  owner_type    TEXT NOT NULL,  -- 'proxy' | 'merchant' | 'creator'
  owner_id      TEXT NOT NULL,
  scene_ids     TEXT[] NOT NULL DEFAULT '{}',
  goal          TEXT,           -- human-readable goal
  budget_minor  BIGINT NOT NULL DEFAULT 0,
  spent_minor   BIGINT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'VND',
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  version       INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON benefit.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON benefit.campaigns(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_scene ON benefit.campaigns USING GIN(scene_ids);

-- ============================================================
-- 3. BenefitDefinition — benefit templates
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.benefit_kind AS ENUM (
    'FREE_DRINK',
    'FREE_MEAL',
    'DISCOUNT_PERCENT',
    'DISCOUNT_FIXED',
    'GIFT',
    'UPGRADE',
    'VOUCHER',
    'ACTIVITY_CREDIT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.definitions (
  benefit_id       TEXT PRIMARY KEY,
  campaign_id      TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  benefit_kind     benefit.benefit_kind NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,
  retail_value_minor BIGINT NOT NULL DEFAULT 0,
  user_pay_minor   BIGINT NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'VND',
  terms_version    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_definitions_campaign ON benefit.definitions(campaign_id);

-- ============================================================
-- 4. CapacityPool — total/daily/timeslot capacity
-- ============================================================
CREATE TABLE IF NOT EXISTS benefit.capacity_pools (
  pool_id         TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  total_capacity  INT NOT NULL,
  daily_capacity  INT,
  timeslot_capacity INT,
  claimed         INT NOT NULL DEFAULT 0,
  reserved        INT NOT NULL DEFAULT 0,
  redeemed        INT NOT NULL DEFAULT 0,
  date            DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INT NOT NULL DEFAULT 1,
  UNIQUE(campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_capacity_campaign ON benefit.capacity_pools(campaign_id);

-- ============================================================
-- 5. BenefitAllocation — distributor inventory/quota
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.distributor_type AS ENUM (
    'PROXY',
    'MERCHANT',
    'STAFF',
    'CREATOR',
    'SCOUT',
    'USER_REFERRAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.allocations (
  allocation_id    TEXT PRIMARY KEY,
  campaign_id      TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  benefit_id       TEXT NOT NULL REFERENCES benefit.definitions(benefit_id),
  distributor_type benefit.distributor_type NOT NULL,
  distributor_id   TEXT NOT NULL,
  quota            INT NOT NULL,
  distributed      INT NOT NULL DEFAULT 0,
  consumed         INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version          INT NOT NULL DEFAULT 1,
  UNIQUE(campaign_id, benefit_id, distributor_type, distributor_id)
);

CREATE INDEX IF NOT EXISTS idx_allocations_distributor ON benefit.allocations(distributor_type, distributor_id);
CREATE INDEX IF NOT EXISTS idx_allocations_campaign ON benefit.allocations(campaign_id);

-- ============================================================
-- 6. BenefitOffer — contextual offers to users
-- ============================================================
CREATE TABLE IF NOT EXISTS benefit.offers (
  offer_id       TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  benefit_id     TEXT NOT NULL REFERENCES benefit.definitions(benefit_id),
  user_id        TEXT NOT NULL,
  context_type   TEXT,          -- 'HOME' | 'SCENE' | 'POST' | 'ACTIVITY' | 'PUSH'
  context_id     TEXT,          -- scene_id, post_id, etc.
  reason_code    TEXT,          -- eligibility reason for audit
  status         TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, CLAIMED, EXPIRED, REVOKED
  offered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  claimed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_user ON benefit.offers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_campaign ON benefit.offers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_offers_context ON benefit.offers(context_type, context_id);

-- ============================================================
-- 7. BenefitClaim — user claims with state machine
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.claim_status AS ENUM (
    'CLAIMED',
    'RESERVED',
    'REDEEMED',
    'EXPIRED',
    'VOID',
    'RELEASED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.claims (
  claim_id       TEXT PRIMARY KEY,
  offer_id       TEXT REFERENCES benefit.offers(offer_id),
  campaign_id    TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  benefit_id     TEXT NOT NULL REFERENCES benefit.definitions(benefit_id),
  user_id        TEXT NOT NULL,
  claim_token    TEXT NOT NULL,  -- QR code / dynamic code
  status         benefit.claim_status NOT NULL DEFAULT 'CLAIMED',
  reserved_until TIMESTAMPTZ,
  redeemed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  version        INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_token ON benefit.claims(claim_token);
CREATE INDEX IF NOT EXISTS idx_claims_user ON benefit.claims(user_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_campaign ON benefit.claims(campaign_id);

-- ============================================================
-- 8. BenefitRedemption — atomic redemption with evidence
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.redemption_status AS ENUM (
    'PENDING',
    'CONFIRMED',
    'SETTLED',
    'VOID',
    'FRAUD_HOLD'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.redemptions (
  redemption_id    TEXT PRIMARY KEY,
  claim_id         TEXT NOT NULL REFERENCES benefit.claims(claim_id),
  campaign_id      TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  merchant_id      TEXT NOT NULL,
  staff_id         TEXT,
  user_id          TEXT NOT NULL,
  -- cost breakdown
  retail_value_minor   BIGINT NOT NULL,
  user_pay_minor       BIGINT NOT NULL,
  proxy_subsidy_minor  BIGINT NOT NULL DEFAULT 0,
  merchant_contribution_minor BIGINT NOT NULL DEFAULT 0,
  creator_allocation_minor    BIGINT NOT NULL DEFAULT 0,
  staff_reward_minor  BIGINT NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'VND',
  -- evidence
  evidence_type   TEXT,          -- 'MERCHANT_SCAN' | 'ORDER_VERIFIED' | 'ACTIVITY_CHECKIN'
  evidence_ref    TEXT,          -- receipt/order/activity ID
  status          benefit.redemption_status NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT NOT NULL,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_idempotency ON benefit.redemptions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_redemptions_claim ON benefit.redemptions(claim_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_merchant ON benefit.redemptions(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_campaign ON benefit.redemptions(campaign_id);

-- ============================================================
-- 9. SubsidySettlement — ledger entries for cost tracking
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.settlement_actor AS ENUM (
    'PROXY',
    'MERCHANT',
    'CREATOR',
    'PARTNER',
    'STAFF',
    'SCOUT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.settlements (
  settlement_id  TEXT PRIMARY KEY,
  redemption_id  TEXT NOT NULL REFERENCES benefit.redemptions(redemption_id),
  campaign_id    TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  actor_type     benefit.settlement_actor NOT NULL,
  actor_id       TEXT NOT NULL,
  amount_minor   BIGINT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'VND',
  settled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_redemption ON benefit.settlements(redemption_id);
CREATE INDEX IF NOT EXISTS idx_settlements_actor ON benefit.settlements(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_settlements_campaign ON benefit.settlements(campaign_id);

-- ============================================================
-- 10. Reward — staff/scout/creator incentives
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.reward_status AS ENUM (
    'PENDING',
    'QUALIFIED',
    'SETTLED',
    'REVERSED',
    'REJECTED',
    'CAPPED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE benefit.reward_type AS ENUM (
    'STAFF_QUALIFIED_REDEMPTION',
    'CREATOR_DISTRIBUTION',
    'SCOUT_ACTIVATION',
    'SCOUT_TAIL',
    'USER_REFERRAL',
    'MERCHANT_STAFF_QUALITY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.rewards (
  reward_id      TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  redemption_id  TEXT REFERENCES benefit.redemptions(redemption_id),
  reward_type    benefit.reward_type NOT NULL,
  beneficiary_type TEXT NOT NULL,  -- 'staff' | 'creator' | 'scout' | 'user'
  beneficiary_id TEXT NOT NULL,
  amount_minor   BIGINT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'VND',
  status         benefit.reward_status NOT NULL DEFAULT 'PENDING',
  cap_ref        TEXT,           -- reference to cap rule
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at     TIMESTAMPTZ,
  version        INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rewards_beneficiary ON benefit.rewards(beneficiary_type, beneficiary_id, status);
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON benefit.rewards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_rewards_redemption ON benefit.rewards(redemption_id);

-- ============================================================
-- 11. AttributionEdge — benefit attribution graph
-- ============================================================
DO $$ BEGIN
  CREATE TYPE benefit.attribution_level AS ENUM (
    'VERIFIED',
    'ATTRIBUTED',
    'ASSISTED',
    'INFERRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS benefit.attribution_edges (
  edge_id          TEXT PRIMARY KEY,
  source_type      TEXT NOT NULL,  -- 'proxy' | 'staff' | 'creator' | 'scout' | 'user_referral'
  source_id        TEXT NOT NULL,
  target_user_id   TEXT NOT NULL,
  campaign_id      TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  redemption_id    TEXT REFERENCES benefit.redemptions(redemption_id),
  scene_id         TEXT,
  attribution_level benefit.attribution_level NOT NULL,
  evidence_level   TEXT NOT NULL DEFAULT 'CLAIMED',  -- 'CLAIMED' | 'REDEEMED' | 'ORDER' | 'VISIT'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version          INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_attribution_source ON benefit.attribution_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_attribution_user ON benefit.attribution_edges(target_user_id);
CREATE INDEX IF NOT EXISTS idx_attribution_campaign ON benefit.attribution_edges(campaign_id);

-- ============================================================
-- 12. Campaign audience/eligibility rules (JSONB for R0 flexibility)
-- ============================================================
CREATE TABLE IF NOT EXISTS benefit.campaign_audiences (
  campaign_id        TEXT PRIMARY KEY REFERENCES benefit.campaigns(campaign_id),
  eligibility_rules JSONB NOT NULL DEFAULT '{}',
  source_allowlist   TEXT[],        -- allowed distributor types
  geo_cities         TEXT[],
  lifecycle_preds    JSONB,         -- {"min_account_age_days": 7, "max_redemptions": 3}
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. Campaign event log (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS benefit.campaign_events (
  event_id     BIGSERIAL PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES benefit.campaigns(campaign_id),
  event_type   TEXT NOT NULL,
  actor_id     TEXT,
  payload      JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events ON benefit.campaign_events(campaign_id, occurred_at);
