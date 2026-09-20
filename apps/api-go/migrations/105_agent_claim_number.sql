-- AGENT-CLAIM-NUMBER-001: 接单编号（技师号）。用户注册时按顺序分配，
-- 1 起不跳号；上限 10000000，展示时至少 3 位零填充（001、010、100、1000…）。
--
-- 不跳号的保证：分配与注册同事务（identity.go EnsurePasswordlessIdentity 内
-- SELECT … FOR UPDATE 拿计数器），回滚则号码一并作废，不存在“占了号但没建成
-- 账户”的空洞。Postgres SEQUENCE 做不到这点（回滚也消耗），所以用计数器表。
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行；回填只填还没有号的账户。
CREATE TABLE IF NOT EXISTS identity.agent_claim_numbers (
    user_account_id TEXT PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
    claim_number INTEGER NOT NULL UNIQUE CHECK (claim_number >= 1 AND claim_number <= 10000000),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.agent_claim_number_counter (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1)
);

INSERT INTO identity.agent_claim_number_counter (id, next_number)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

-- 存量回填：按注册顺序（created_at, id）从 1 起排号；已有号的不动。
WITH ranked AS (
    SELECT ua.id AS user_account_id,
           ROW_NUMBER() OVER (ORDER BY ua.created_at, ua.id) AS rn
    FROM identity.user_accounts ua
    WHERE NOT EXISTS (
        SELECT 1 FROM identity.agent_claim_numbers c WHERE c.user_account_id = ua.id
    )
), ins AS (
    INSERT INTO identity.agent_claim_numbers (user_account_id, claim_number)
    SELECT user_account_id, (rn + COALESCE((SELECT next_number - 1 FROM identity.agent_claim_number_counter WHERE id = 1), 0))::INTEGER
    FROM ranked
    ON CONFLICT DO NOTHING
    RETURNING claim_number
)
UPDATE identity.agent_claim_number_counter
SET next_number = GREATEST(next_number, COALESCE((SELECT MAX(claim_number) + 1 FROM identity.agent_claim_numbers), 1))
WHERE id = 1;
