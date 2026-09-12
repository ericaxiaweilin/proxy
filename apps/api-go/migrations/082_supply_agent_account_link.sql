-- 082_supply_agent_account_link.sql
--
-- IDENTITY-ID-001（用户要求：用户 ID 系统生成、每个用户独立；用户名可编辑、可重复；
-- mock 数据不许分散）
--
-- 现状（实测）：supply.agent_profiles 只有手写 agent_id（agent_linh…）+ 显示名 name，
-- 没有任何指向账号的列；头像写死在 photos（randomuser.me 外链）。于是同一个显示名
-- "Linh" 在首页 fixture（u_linh + R34 原型肖像）与发布订单候选（agent_linh +
-- randomuser.me 头像）各不相同 —— 不是缓存问题，是结构上没有同一性。
--
-- 本迁移先补上「agent 属于哪个账号」的系统 ID 链接列：之后 agent 的显示名与头像
-- 一律经 user_account_id 读 identity.profiles（账号头像走媒体资产 id），
-- 显示名允许重复（identity.profiles.handle 本就无唯一约束，PK 是系统生成的
-- user_<random>）。
--
-- 说明：不回填、不改动既有行。回填与种子绑定在应用侧（seedPostgresSupply）完成，
-- 避免在迁移里造账号（账号必须由 identity 域生成系统 ID）。

BEGIN;

ALTER TABLE supply.agent_profiles
  ADD COLUMN IF NOT EXISTS user_account_id text;

COMMENT ON COLUMN supply.agent_profiles.user_account_id IS
  'IDENTITY-ID-001: 系统生成的账号 id（identity.user_accounts.id）。agent 的显示名/头像经此读账号 profile；显示名可重复，身份以本列为准。';

CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_account
  ON supply.agent_profiles (user_account_id);

COMMIT;
