-- INCENTIVE-001（2026-10-08，用户：激励 = 券 + 成长值，不可能是现金，现金违规；券以咖啡券为主）
--
-- 规则表 + 发放账本。奖励只有两种：
--   BENEFIT_CLAIM  给用户领一份已有福利活动（benefit.Campaign / BenefitDefinition，咖啡券 = FREE_DRINK / VOUCHER…）。
--                  预算、名额、资格由福利活动自己的容量池和资格引擎管，这里不另造一套钱的账。
--   GROWTH_POINTS  成长值（点数），只记账，不是钱、不能提现。
-- 没有「现金 / 余额 / 红包」这个类型——CHECK 约束把它挡在库里，不只是代码里。
CREATE SCHEMA IF NOT EXISTS incentive;

CREATE TABLE IF NOT EXISTS incentive.rules (
    id                    TEXT PRIMARY KEY,
    label                 TEXT NOT NULL CHECK (btrim(label) <> ''),
    trigger               TEXT NOT NULL CHECK (trigger IN ('FIRST_POST', 'FIRST_DEMAND', 'FIRST_ACTIVITY')),
    reward_kind           TEXT NOT NULL CHECK (reward_kind IN ('BENEFIT_CLAIM', 'GROWTH_POINTS')),
    campaign_id           TEXT NOT NULL DEFAULT '',
    benefit_id            TEXT NOT NULL DEFAULT '',
    points                INTEGER NOT NULL DEFAULT 0,
    -- 防刷：账号至少存在这么久、资料完善之后才发。
    min_account_age_hours INTEGER NOT NULL DEFAULT 24 CHECK (min_account_age_hours >= 0),
    active                BOOLEAN NOT NULL DEFAULT false,
    created_by            TEXT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,
    CHECK (
        (reward_kind = 'BENEFIT_CLAIM' AND campaign_id <> '' AND benefit_id <> '' AND points = 0) OR
        (reward_kind = 'GROWTH_POINTS' AND points BETWEEN 1 AND 1000 AND campaign_id = '' AND benefit_id = '')
    )
);

-- 每条规则对每个人最多一行（UNIQUE）：发放幂等，重跑不会重复发。
CREATE TABLE IF NOT EXISTS incentive.grants (
    id         TEXT PRIMARY KEY,
    rule_id    TEXT NOT NULL REFERENCES incentive.rules(id),
    user_id    TEXT NOT NULL,
    reward_kind TEXT NOT NULL,
    claim_id   TEXT NOT NULL DEFAULT '',
    points     INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL CHECK (status IN ('GRANTED', 'FAILED')),
    error      TEXT NOT NULL DEFAULT '',
    granted_at TIMESTAMPTZ NOT NULL,
    UNIQUE (rule_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_incentive_grants_user ON incentive.grants (user_id, granted_at DESC);
