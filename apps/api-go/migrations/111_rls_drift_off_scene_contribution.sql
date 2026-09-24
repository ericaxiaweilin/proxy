-- 111_rls_drift_off_scene_contribution.sql — P0 修复（与 065 同一类，同一修法）。
--
-- 现状：scene.scenes / scene.invitations / contribution.contributions 三张表被开了
-- ENABLE + FORCE ROW LEVEL SECURITY，而 pg_policies 里**一行 policy 都没有**。
-- 应用角色 proxy 正是这三张表的 owner（走 TCP 连接，非超级用户）⇒ FORCE 下连 owner
-- 也要过 policy，而没有任何 policy 可用 = deny-all：
--   * SELECT **不报错，静默返回 0 行**（"没有数据"和"没有权限"长得一模一样）；
--   * INSERT / UPDATE / DELETE 报 "new row violates row-level security policy"。
--
-- 2026-09-22 实测（本地库，连接角色 proxy，rolsuper=f）：
--   scene.scenes              真实 6 行 -> proxy 读到 0 行
--   contribution.contributions 真实 3 行 -> proxy 读到 0 行
--   scene.invitations         真实 3 行 -> proxy 读到 0 行
-- 读路径因此把"场景/邀请/贡献"全渲染成空列表，且没有任何报错。
--
-- 证据链（为什么判定是漂移，不是设计）：
--   * `grep -rn "ROW LEVEL SECURITY" apps/api-go/migrations/` 只命中 032/035/042
--     （media.media_review_decisions）与 065（supply，065 已把它关掉）——
--     **没有任何迁移给这三张表开过 RLS**；
--   * observer 边界靠 **REVOKE 裸表 + 聚合视图**（047/051/053），RLS 从来不是那道
--     边界；065 的注释亲口写明这一点，cmd/data-audit 的
--     observer_raw_table_privileges 检查也在守这一条（当前读数 0 = 边界完好）；
--   * 这三张表上零 policy ⇒ 没有任何角色被授予过任何访问，RLS 在这里只产生破坏。
--
-- 修复 = 显式收归迁移管理并关掉（与 065 同形），并在表上留 COMMENT 说明边界在哪，
-- 免得下一个人再把 RLS 当成安全边界加回来。
--
-- 幂等：ENABLE/FORCE/DISABLE 天然幂等；DO 块里防御性 DROP 可能残留的 policy。

ALTER TABLE scene.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene.scenes FORCE ROW LEVEL SECURITY;
ALTER TABLE scene.scenes DISABLE ROW LEVEL SECURITY;

ALTER TABLE scene.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene.invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE scene.invitations DISABLE ROW LEVEL SECURITY;

ALTER TABLE contribution.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution.contributions FORCE ROW LEVEL SECURITY;
ALTER TABLE contribution.contributions DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS scene_scenes_select_observer ON scene.scenes';
  EXECUTE 'DROP POLICY IF EXISTS scene_invitations_select_observer ON scene.invitations';
  EXECUTE 'DROP POLICY IF EXISTS contribution_select_observer ON contribution.contributions';
END
$$;

COMMENT ON TABLE scene.scenes IS 'Reality scenes (R14). RLS deliberately OFF: the API role is the table owner; the observer boundary is enforced by 047/051/053 views + REVOKE, not RLS. RLS-on-with-zero-policies silently returned 0 rows to the app (fixed in 111).';
COMMENT ON TABLE scene.invitations IS 'Scene invitations. RLS deliberately OFF — same reason as scene.scenes (fixed in 111).';
COMMENT ON TABLE contribution.contributions IS 'Contributions. RLS deliberately OFF — same reason as scene.scenes (fixed in 111).';
