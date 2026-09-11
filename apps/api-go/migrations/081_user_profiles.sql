-- 081_user_profiles.sql — P1：服务端个人资料持久化（原型 gap 修复）
--
-- 背景（audit 2026-09-04）：mobile "我的" 页 profile（name/handle/bio/city/avatar）
-- 只存手机本地 Keychain（profile-store.ts），服务端零持久化 —— 换设备/重装即丢，
-- 且他人无法读到你的名片。PRD Ch01 §31 UserAccount / Ch07 AgentProfile 的
-- display_name/handle 维度长期缺失。
--
-- 设计：
--   * user_profiles 以 user_account_id 为主键（1:1），Upsert 语义；
--   * handle 唯一（全局），保留 @ 前缀由应用层处理，DB 存 raw；
--   * avatar 保持 URL/路径文本（媒体上传管线后续接入）；
--   * 长度校验与 mobile profile-store 一致：name≤60 handle≤60 bio≤280 city≤60。

CREATE SCHEMA IF NOT EXISTS profile;

CREATE TABLE IF NOT EXISTS profile.user_profiles (
    user_account_id TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    handle          TEXT NOT NULL,
    bio             TEXT NOT NULL DEFAULT '',
    city            TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_handle_key
    ON profile.user_profiles (handle);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_name_display_key
    ON profile.user_profiles (user_account_id);

COMMENT ON TABLE profile.user_profiles IS 'Server-side user profile card (PRD Ch01 §31 / Ch07): name/handle/bio/city/avatar. 1:1 with identity.user_accounts, upsert semantics.';
