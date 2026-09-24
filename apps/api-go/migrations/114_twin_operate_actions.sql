-- 114_twin_operate_actions.sql — AI 分身「好友洞察」运营动作审计（TWIN-INSIGHT-002）。
--
-- 为什么需要一张新表：PRD §1 第 6 条要求「开启单独运营」必须留审计
-- （谁 / 何时 / 对谁 / 什么动作）。当前这个动作在客户端只是个按钮，
-- 服务端没有任何落点 —— 点完之后无法回答「谁在什么时候对谁开了单独运营」。
--
-- 设计取舍：
--   * **只追加**。「当前这个好友是什么状态」= 这张表里最新那一行，
--     不 UPDATE 上一行。本仓的数据不变式是不硬删、走状态机 + 审计
--     （PRD §1 第 7 条），跟 media.media_review_decisions 同一形状。
--     和 032 不同的是：032 只靠"service 里没有 UPDATE 路径"这条约定，
--     而 111 那次漂移的教训正是「约定没有强制力」。所以这里用触发器把
--     append-only 变成**数据库保证**，而不是注释里的承诺。
--   * **不开 RLS**。112 的教训是 ENABLE + FORCE + 零 policy = 连表属主
--     都被 deny-all，SELECT 静默返回 0 行。这张表不需要按行隔离 ——
--     读路径一律 owner_id 过滤（见 internal/twininsight），写入一律
--     由服务端盖章 owner_id，客户端传不了。
--   * ⚠️ DELETE 也被拦住 ⇒ 清数据（含擦除请求）必须走**显式迁移**
--     （ALTER TABLE ... DISABLE TRIGGER + DELETE + ENABLE），不是应用能做的。
--     这是「不硬删」这条不变式的代价；如果后续法务要求可擦除，改这里，
--     不要给应用角色开 DELETE。
--   * twin_id / target_id 不加外键到 ai.ai_personas / identity.user_accounts：
--     审计行必须在被审计对象消失后**仍然存在**（人注销了，审计不能跟着没），
--     加级联外键会把审计变成可被删除的数据。这是审计表的常规取舍。
--
-- 幂等：CREATE TABLE / INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
-- DROP TRIGGER IF EXISTS 后重建。

CREATE TABLE IF NOT EXISTS ai.twin_operate_actions (
    id         text        PRIMARY KEY,
    twin_id    text        NOT NULL,
    owner_id   text        NOT NULL,
    target_id  text        NOT NULL,
    action     text        NOT NULL,
    acted_at   timestamptz NOT NULL,
    CONSTRAINT twin_operate_actions_action_check CHECK (action IN ('observe', 'operate')),
    CONSTRAINT twin_operate_actions_ids_check CHECK (
        length(twin_id) > 0 AND length(owner_id) > 0 AND length(target_id) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_twin_operate_actions_owner_target
    ON ai.twin_operate_actions (owner_id, target_id, acted_at DESC);

CREATE OR REPLACE FUNCTION ai.twin_operate_actions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'ai.twin_operate_actions is append-only (attempted %)', TG_OP
        USING ERRCODE = 'restrict_violation';
END
$$;

-- 属主对齐 —— 在**建表这一步**就把 111 那类漂移堵掉。
--
-- 实测（2026-09-22，本地库）：以超级用户（个人 macOS 账号）apply 后，
-- CREATE TABLE 把属主记成超级用户，而应用角色 proxy 对这张表**一条权限都没有**：
--     INSERT INTO ai.twin_operate_actions ... -> ERROR: permission denied for table
-- 写路径当场失效，且不报错在别处 —— 就是"点了按钮但没留痕"的静默降级。
-- 同 schema 的 ai.ai_personas 是应用角色拥有的表（实测 tableowner = proxy），
-- 拿它的属主当基准让新表跟邻居一致。刻意**不硬编码**角色名：
-- 本地、CI、production 的应用角色名不该由这段 SQL 猜。
--
-- 幂等：只在两者不一致时才 ALTER，重跑是 no-op。
DO $$
DECLARE
    sibling_owner TEXT;
    current_owner TEXT;
BEGIN
    IF to_regclass('ai.ai_personas') IS NOT NULL THEN
        SELECT pg_get_userbyid(c.relowner) INTO sibling_owner
            FROM pg_class c WHERE c.oid = 'ai.ai_personas'::regclass;
        SELECT pg_get_userbyid(c.relowner) INTO current_owner
            FROM pg_class c WHERE c.oid = 'ai.twin_operate_actions'::regclass;
        IF sibling_owner IS NOT NULL AND current_owner IS DISTINCT FROM sibling_owner THEN
            RAISE NOTICE '114: 属主 % -> %（对齐 ai.ai_personas，修复应用角色无权限）',
                current_owner, sibling_owner;
            EXECUTE format('ALTER TABLE ai.twin_operate_actions OWNER TO %I', sibling_owner);
            EXECUTE format('ALTER FUNCTION ai.twin_operate_actions_append_only() OWNER TO %I', sibling_owner);
        END IF;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_twin_operate_actions_append_only ON ai.twin_operate_actions;
CREATE TRIGGER trg_twin_operate_actions_append_only
    BEFORE UPDATE OR DELETE ON ai.twin_operate_actions
    FOR EACH ROW EXECUTE FUNCTION ai.twin_operate_actions_append_only();

COMMENT ON TABLE ai.twin_operate_actions IS
    'TWIN-INSIGHT-002: append-only audit of AI-twin 好友洞察 operations (observe/operate). Current state = latest row per (owner_id, target_id). UPDATE/DELETE are blocked by trigger, not by convention. Deliberately no RLS — read paths filter by owner_id, writes are stamped server-side.';
