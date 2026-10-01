-- 紧急联系人 + 紧急事件（只追加）。2026-10-01，设置页「位置与隐私」的真实后端。
--
-- 为什么需要后端而不是只做 UI：原型里的「紧急联系人 / 一键求助」是安全相邻的
-- 承诺。画一个开关而背后没有通道，等于拿人身安全做假承诺 —— 比画一个假的评分
-- 星严重得多。所以这一版**只做能被验证的东西**，做不到的在界面上明说。
--
-- 越南 PDP 91/2025/QH15 下有两件事必须在这里编码：
--   1. 联系人手机号是**第三方**的个人数据。平台无法核实用户是否取得对方同意，
--      所以不假装能核实 —— 只记录用户**声明**已取得同意的时刻
--      （permission_attested_at）。声明与事实分开存，读的人能分辨。
--   2. 紧急事件里的位置是该用户的**敏感**个人数据。这里**只存粗化后的坐标**，
--      并同时存下粗化精度（coarse_precision_m），这样读的人能区分
--      「我们刻意粗化过」和「当时根本没拿到位置」（后者是 NULL）。
--      精确坐标永远不落这张表 —— 粗化发生在写库之前，不是查询时。
--
-- 关于只追加：用触发器强制（BEFORE UPDATE OR DELETE），与 142/143 同法。
-- ⚠️ 刻意**没有**把这张表加进 internal/platform/postgres/role_posture.go 的
--   appendOnlyTables 列表 —— 那份列表驱动的是启动期姿态检查，而迁移以属主
--   身份运行 ⇒ 一旦加进去，RUNTIME_OWNS_AUDIT_TABLE 会开火、姿态基线从
--   1 finding 变成 2，会把既有的姿态断言打红。要不要把它纳入姿态检查是一个
--   独立决定（等于重述基线姿态），留待显式确认，这里先靠触发器兜住。

CREATE SCHEMA IF NOT EXISTS safety;

CREATE TABLE IF NOT EXISTS safety.emergency_contacts (
    id                     TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL,
    display_name           TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
    -- E.164。越南号码形如 +84912345678。收紧了位数，避免存进一个拨不出去的串。
    phone                  TEXT NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
    relation               TEXT CHECK (relation IS NULL OR length(relation) <= 40),
    priority               SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 3),
    -- 用户**声明**已取得该联系人同意的时刻。平台不核实，只留痕。
    permission_attested_at TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 软删除：号码是审计事实，不物理删除（AGENTS.md「Data is never deleted by code」）。
    deleted_at             TIMESTAMPTZ
);

-- 同一个号码在一个用户名下只能有一条活行。软删除的行掉出这个部分索引，
-- 所以「删掉再加回来」是允许的，历史仍在。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_emergency_contact_phone
    ON safety.emergency_contacts (user_id, phone) WHERE deleted_at IS NULL;

-- 产品口径是「1–3 位」。在库里也钉住，否则一个有 bug 的客户端可以悄悄建出第 4 位。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_emergency_contact_priority
    ON safety.emergency_contacts (user_id, priority) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_emergency_contact_user
    ON safety.emergency_contacts (user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS safety.emergency_events (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('SOS','MEETUP_CHECKIN')),
    occurred_at        TIMESTAMPTZ NOT NULL,
    -- 粗化后的坐标。两个一起为 NULL 或一起非 NULL —— 半个坐标没有意义。
    coarse_lat         DOUBLE PRECISION,
    coarse_lng         DOUBLE PRECISION,
    -- 粗化到多少米。有了它，读者才能把「刻意粗化」和「没有位置」分开。
    coarse_precision_m INTEGER CHECK (coarse_precision_m IS NULL OR coarse_precision_m > 0),
    -- 当时是否**因为**粗化而丢弃了更精确的 fix。恒为 true 是刻意的：这张表
    -- 永远不接受精确坐标，写成 NOT NULL DEFAULT TRUE 让「以后有人放宽」必须显式改。
    precise_withheld   BOOLEAN NOT NULL DEFAULT TRUE,
    -- 本次事件被指到的联系人（存 id 数组，不存号码副本：号码以联系人行为准）。
    contact_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 交给系统拨号器 / 短信的交接记录。**不是投递回执** —— 我们只知道
    -- 「把动作交给了系统」，不知道对方是否收到。两个字段名刻意不叫 delivered*。
    dialer_opened      BOOLEAN NOT NULL DEFAULT FALSE,
    dialed_number      TEXT,
    sms_handoff_count  INTEGER NOT NULL DEFAULT 0 CHECK (sms_handoff_count >= 0),
    note               TEXT CHECK (note IS NULL OR length(note) <= 280),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((coarse_lat IS NULL) = (coarse_lng IS NULL)),
    CHECK (coarse_lat IS NULL OR (coarse_lat BETWEEN -90 AND 90)),
    CHECK (coarse_lng IS NULL OR (coarse_lng BETWEEN -180 AND 180)),
    CHECK (jsonb_typeof(contact_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_emergency_event_user
    ON safety.emergency_events (user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION safety.reject_emergency_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'safety.emergency_events is append-only (% rejected)', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS emergency_events_append_only ON safety.emergency_events;
CREATE TRIGGER emergency_events_append_only
    BEFORE UPDATE OR DELETE ON safety.emergency_events
    FOR EACH ROW EXECUTE FUNCTION safety.reject_emergency_event_mutation();

DROP TRIGGER IF EXISTS emergency_events_no_truncate ON safety.emergency_events;
CREATE TRIGGER emergency_events_no_truncate
    BEFORE TRUNCATE ON safety.emergency_events
    FOR EACH STATEMENT EXECUTE FUNCTION safety.reject_emergency_event_mutation();

COMMENT ON TABLE safety.emergency_events IS
    'Append-only emergency events. Coarse location only (precise_withheld is always true); '
    'dialer_opened / sms_handoff_count record an OS hand-off, NOT message delivery.';
COMMENT ON COLUMN safety.emergency_events.precise_withheld IS
    'Always true by design: precise coordinates never enter this table.';
