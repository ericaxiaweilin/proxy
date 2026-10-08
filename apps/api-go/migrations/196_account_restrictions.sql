-- OPS-RESTRICT-001（2026-10-08）：让举报处置真的生效——账号受限 / 封禁。
-- append-only：每次设置 / 解除都是新的一行（谁、为什么、关联哪条举报）；当前状态由最新一行推出。
-- 与 moderation.reports / dispositions 同口径：只有 INSERT，UPDATE / DELETE 由触发器拒绝（这是举证材料）。
CREATE TABLE IF NOT EXISTS moderation.account_restriction_changes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('SET', 'LIFT')),
    level      TEXT NOT NULL DEFAULT '' CHECK (level IN ('', 'RESTRICTED', 'SUSPENDED')),
    reason     TEXT NOT NULL CHECK (btrim(reason) <> ''),
    report_id  TEXT NOT NULL DEFAULT '',
    actor_id   TEXT NOT NULL CHECK (btrim(actor_id) <> ''),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK ((action = 'SET' AND level <> '') OR (action = 'LIFT' AND level = ''))
);
CREATE INDEX IF NOT EXISTS idx_account_restriction_user ON moderation.account_restriction_changes (user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION moderation.account_restriction_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'moderation.account_restriction_changes is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_restriction_append_only ON moderation.account_restriction_changes;
CREATE TRIGGER trg_account_restriction_append_only
    BEFORE UPDATE OR DELETE ON moderation.account_restriction_changes
    FOR EACH ROW EXECUTE FUNCTION moderation.account_restriction_append_only();
