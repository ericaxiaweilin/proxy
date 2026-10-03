-- 157_agent_socials.sql
-- CREATOR-SOCIAL-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
-- 也看不到关联的社媒账户」）
--
-- AgentProfile 本来没有社媒字段 —— 全仓搜不到 social。商家想看 Creator 的
-- 社媒，只能看到一句"尚未关联"。现在加一列 socials（JSONB 数组），元素形状：
--   { platform, handle, visibility, createdAt }
--   · platform 只能是 tiktok | zalo | instagram | facebook（封闭集合，
--     服务端校验，见 supply.isValidSocialPlatform）；
--   · handle 只存用户名，不存 URL（URL 由客户端按平台拼 canonical 链接，
--     服务端不接受任意外部地址）；
--   · visibility 只能是 public | merchants | private（见 SOCIAL-VISIBILITY-001）。
--
-- 为什么是 JSONB 列而不是独立表：社媒是 profile 的附属展示属性（读多写少、
-- 跟 profile 同生命周期、无独立查询），独立表是过度设计。真到要按平台查
-- "所有挂了 TikTok 的 Creator" 那天再拆。
ALTER TABLE supply.agent_profiles
  ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '[]';

-- 非法形状防一手（应用层也会校验，这里是第二道）：platform / visibility 必须是
-- 封闭集合里的值，handle 非空。CHECK 只管形状，语义（比如 handle 字符集）
-- 归应用层—— CHECK 里写正则以后加平台要改表，不值。
ALTER TABLE supply.agent_profiles
  DROP CONSTRAINT IF EXISTS agent_profiles_socials_ck;
ALTER TABLE supply.agent_profiles
  ADD CONSTRAINT agent_profiles_socials_ck CHECK (
    jsonb_typeof(socials) = 'array'
  );
