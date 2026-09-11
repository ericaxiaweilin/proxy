-- 065_supply_rls_off.sql — P0 修复：dev 库 supply 两表被开了 FORCE ROW LEVEL
-- SECURITY 且零 policy，导致 proxy 角色（表 owner，走 TCP 连接）的 INSERT 全部
-- deny-all → CreateAgentProfile/CreateAgentService/SetAvailabilityWindow 全线 500。
--
-- 背景（audit 2026-09-04）：
--   * 047_cross_domain_rls_observer.sql 只建 observer 视图 + REVOKE，从不开 RLS；
--   * 任意迁移文件都没有 ENABLE/FORCE ROW LEVEL SECURITY 作用于 supply 表；
--   * dev 库实测：supply.agent_profiles / supply.availability_windows relrowsecurity=t
--     relforcerowsecurity=t，pg_policies 零行 → 非超级用户写入全被 RLS 拦死；
--   * main.go:182 注释亲口承认 "seed fails on SMTP mode" 并用 gated seed 绕过。
-- 该状态与迁移账本漂移（可能来自某次手工演练），正确修复 = 显式收归迁移管理并关掉。
--
-- 幂等：ENABLE/FORCE 开关语句天然幂等；DO 块里再防御性 DROP 可能残留的空名 policy。
-- 047 的 observer 边界（REVOKE raw + 视图聚合）不受影响——RLS 从来不是那道边界。

ALTER TABLE supply.agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply.agent_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE supply.agent_profiles DISABLE ROW LEVEL SECURITY;

ALTER TABLE supply.availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply.availability_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE supply.availability_windows DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 清理可能挂在表上的历史 policy 残留（无 policy 时为 no-op）
  EXECUTE 'DROP POLICY IF EXISTS supply_profiles_select_observer ON supply.agent_profiles';
  EXECUTE 'DROP POLICY IF EXISTS supply_availability_select_observer ON supply.availability_windows';
END
$$;

COMMENT ON TABLE supply.agent_profiles IS 'Agent profiles (R14 §6). RLS deliberately OFF: the API role is the table owner; the observer boundary is enforced by 047 views+REVOKE, not RLS.';
