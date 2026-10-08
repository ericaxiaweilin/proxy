-- IDENTITY-POINTS-001（2026-10-08，用户：激励围绕 用户 / 小美 / 商家；固定的是「身份体系（铜银金 + 星）+ 积分」，
-- 奖励活动（咖啡券等）不固定：按分数、在特定时间窗口由运营开启）。
--
-- 积分账本：只追加，不能改（UPDATE 被拒）。删除保留给「账号注销 / 数据保留期」（用户的删除权），所以不挡 DELETE。积分 = 账本里 delta 之和；身份等级由积分算出来，不单独存。
-- 积分不是钱、不能提现；赚取规则在代码里（固定），奖励活动规则在 incentive.rules（运营配，带时间窗口和分数门槛）。
CREATE SCHEMA IF NOT EXISTS growth;

CREATE TABLE IF NOT EXISTS growth.point_ledger (
    id           TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('USER', 'PROVIDER', 'MERCHANT')),
    subject_id   TEXT NOT NULL CHECK (btrim(subject_id) <> ''),
    delta        INTEGER NOT NULL CHECK (delta > 0),
    reason       TEXT NOT NULL CHECK (btrim(reason) <> ''),
    ref          TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL,
    -- 同一件事只算一次：重跑收集器不会重复加分。
    UNIQUE (subject_kind, subject_id, reason, ref)
);
CREATE INDEX IF NOT EXISTS idx_point_ledger_subject ON growth.point_ledger (subject_kind, subject_id);

CREATE OR REPLACE FUNCTION growth.forbid_ledger_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'growth.point_ledger rows cannot be updated';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS point_ledger_append_only ON growth.point_ledger;
CREATE TRIGGER point_ledger_append_only BEFORE UPDATE ON growth.point_ledger
    FOR EACH ROW EXECUTE FUNCTION growth.forbid_ledger_change();

-- 奖励活动：对象（用户 / 小美 / 商家）、时间窗口、分数门槛。
ALTER TABLE incentive.rules ADD COLUMN IF NOT EXISTS audience   TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE incentive.rules ADD COLUMN IF NOT EXISTS starts_at  TIMESTAMPTZ;
ALTER TABLE incentive.rules ADD COLUMN IF NOT EXISTS ends_at    TIMESTAMPTZ;
ALTER TABLE incentive.rules ADD COLUMN IF NOT EXISTS min_points INTEGER NOT NULL DEFAULT 0 CHECK (min_points >= 0);
ALTER TABLE incentive.rules DROP CONSTRAINT IF EXISTS rules_audience_check;
ALTER TABLE incentive.rules ADD CONSTRAINT rules_audience_check CHECK (audience IN ('USER', 'PROVIDER', 'MERCHANT'));
ALTER TABLE incentive.rules DROP CONSTRAINT IF EXISTS rules_window_check;
ALTER TABLE incentive.rules ADD CONSTRAINT rules_window_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
ALTER TABLE incentive.rules DROP CONSTRAINT IF EXISTS rules_trigger_check;
ALTER TABLE incentive.rules ADD CONSTRAINT rules_trigger_check CHECK (trigger IN ('FIRST_POST', 'FIRST_DEMAND', 'FIRST_ACTIVITY', 'SCORE_REACHED'));
