-- NUDGE-OPTOUT-001：引导推送（发第一条动态 / 发第一个需求）的退订。有这一行 = 不再推。
-- 账号注销时随账号一起删（用户的删除权）。
CREATE TABLE IF NOT EXISTS notification.nudge_optouts (
    user_account_id TEXT PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
    opted_out_at    TIMESTAMPTZ NOT NULL
);
