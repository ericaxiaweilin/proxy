-- 119_ai_engine_settings.sql — AI 引擎设置 + 本月 Token 计量（AI-MANAGE-002）。
--
-- 为什么需要：AI 管理页（我的 → 账户 → AI 管理）的暂停、对话风格/节奏/权限、
-- 出图偏好、动态发帖偏好、本月 Token 用量，之前全是客户端假状态或根本没有。
-- 暂停/权限必须服务端认（客户端开关挡不住 curl）；Token 必须从真实推理累计，
-- 不能写死 120K/200K。
--
-- 设计取舍：
--   * 设置一行一用户（upsert），与 identity.account_preferences 同形。
--     偏好是可变业务状态，不是审计 —— 允许 UPDATE + version 自增。
--   * Token 计量按 (user, period='YYYY-MM') 一行，月初自然翻页；
--     只追加计数，不回写历史月。限额不进库 —— 平台策略可配置，
--     库里只存已用量，避免把运营可调数字冻进 schema。
--   * 不开 RLS（112 教训：零 policy 的 FORCE = 连表主都 deny）。
--     读写一律 user_account_id 过滤，服务端盖章 actor，客户端传不了别人的 id。
--   * 擦除：privacy 走 DELETE（用户自己的设置/用量是个人数据），
--     与 account_preferences 同批（见 identity ErasePersonalData 扩展）。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + CHECK。

CREATE TABLE IF NOT EXISTS identity.ai_engine_settings (
    user_account_id TEXT PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    -- 对话：风格（语气）
    chat_tone TEXT NOT NULL DEFAULT 'warm',
    -- 对话：回复长度
    chat_reply_length TEXT NOT NULL DEFAULT 'short',
    -- 对话：emoji 频率
    chat_emoji TEXT NOT NULL DEFAULT 'sometimes',
    -- 对话：节奏（instant | human_3_5 | human_10_30 | random）
    chat_rhythm TEXT NOT NULL DEFAULT 'human_3_5',
    -- 对话：权限（off=不替你回 | confirm=起草待确认 | auto=全自动）
    chat_permission TEXT NOT NULL DEFAULT 'confirm',
    -- 出图：场景 / 姿态 / 运镜 / 提示词草稿 / 比例 / 精度 / 厂商偏好（平台路由用，客户端不直连）
    image_scene TEXT NOT NULL DEFAULT 'cafe',
    image_pose TEXT NOT NULL DEFAULT '',
    image_camera TEXT NOT NULL DEFAULT 'static',
    image_prompt TEXT NOT NULL DEFAULT '',
    image_prompt_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_aspect TEXT NOT NULL DEFAULT '3:4',
    image_quality TEXT NOT NULL DEFAULT '1536',
    image_vendor_pref TEXT NOT NULL DEFAULT 'platform_default',
    image_model_pref TEXT NOT NULL DEFAULT '',
    -- 动态：节奏 / 内容偏好 / 发布权限（off | confirm | auto）
    post_pace TEXT NOT NULL DEFAULT 'every_3_days',
    post_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    post_permission TEXT NOT NULL DEFAULT 'off',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ai_engine_settings_chat_tone_check CHECK (
        chat_tone IN ('cool', 'warm', 'softer', 'lively', 'pro')
    ),
    CONSTRAINT ai_engine_settings_chat_reply_length_check CHECK (
        chat_reply_length IN ('xshort', 'short', 'medium', 'long')
    ),
    CONSTRAINT ai_engine_settings_chat_emoji_check CHECK (
        chat_emoji IN ('never', 'sometimes', 'often', 'every')
    ),
    CONSTRAINT ai_engine_settings_chat_rhythm_check CHECK (
        chat_rhythm IN ('instant', 'human_3_5', 'human_10_30', 'random')
    ),
    CONSTRAINT ai_engine_settings_chat_permission_check CHECK (
        chat_permission IN ('off', 'confirm', 'auto')
    ),
    CONSTRAINT ai_engine_settings_post_pace_check CHECK (
        post_pace IN ('daily', 'every_3_days', 'weekly')
    ),
    CONSTRAINT ai_engine_settings_post_permission_check CHECK (
        post_permission IN ('off', 'confirm', 'auto')
    ),
    CONSTRAINT ai_engine_settings_json_array_check CHECK (
        jsonb_typeof(image_prompt_history) = 'array'
        AND jsonb_typeof(post_topics) = 'array'
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_engine_settings_paused
    ON identity.ai_engine_settings (paused)
    WHERE paused = TRUE;

CREATE TABLE IF NOT EXISTS identity.ai_token_usage (
    user_account_id TEXT NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_account_id, period),
    CONSTRAINT ai_token_usage_period_check CHECK (period ~ '^[0-9]{4}-[0-9]{2}$')
);
