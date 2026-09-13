-- COMP-AGE-001: 把「注册时已经核验过的年龄」留下来。
--
-- 现状（实测）：CreateAnonymousSession 在服务端做了 18+ 判定
-- （internal/identity/service.go，dob.AddDate(18,0,0)），判定完就把
-- dateOfBirth 丢了 —— identity.user_accounts 只有 id/status/created_at/
-- updated_at 四列，全仓库 Go 代码里没有 date_of_birth 的落点。
--
-- 后果：18+ 这道关只在「注册那一瞬间」成立，之后无法复查、无法举证，
-- 任何不走匿名注册的账号（Google 登录、其它登录路径、种子账号）根本没有
-- 年龄证据。AI 法 134/2025（2026-03-01 生效）要求对未成年人采取保护措施，
-- 而「没有年龄信号」意味着这件事根本无从做起。
--
-- 本表是 append-only 的「年龄断言流水」，不是 profile 字段：
--   * source 记录这条断言是怎么来的（注册自填 / 证件 / 运营人工）
--   * 每次重新断言追加一行，不覆盖历史 —— 篡改历史年龄应该留下痕迹
--   * 取「当前年龄」= 按 asserted_at 取最新一行
--
-- 只存出生日期，不存证件扫描件；IP / UA 与合法同意记录（059）一致，
-- 用于举证时说明「这条断言是谁在什么时候、从哪个客户端做的」。

CREATE TABLE IF NOT EXISTS identity.user_age_assertions (
    id              TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL,
    date_of_birth   DATE NOT NULL,
    source          TEXT NOT NULL,
    asserted_at     TIMESTAMPTZ NOT NULL,
    ip              TEXT,
    user_agent      TEXT,
    CHECK (source IN ('SELF_DECLARED_AT_SIGNUP', 'DOCUMENT', 'OPERATOR')),
    CHECK (date_of_birth > '1900-01-01')
);

-- 取「当前年龄」的常见查询：某账号最新一条断言。
CREATE INDEX IF NOT EXISTS idx_user_age_assertions_latest
    ON identity.user_age_assertions (user_account_id, asserted_at DESC);

COMMENT ON TABLE identity.user_age_assertions IS
  'COMP-AGE-001: 年龄断言流水（append-only）。注册时的 18+ 判定此前没有落点，本表让它可复查、可举证；取当前年龄 = 按 asserted_at 取最新一行。';
