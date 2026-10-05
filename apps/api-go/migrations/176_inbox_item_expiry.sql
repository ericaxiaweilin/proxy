-- 176_inbox_item_expiry.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：收件箱会一直涨，而且**必然**会撑爆读取路径。
--
-- 实况（2026-10-05 本地库）：notification.inbox_items 926 行，全部没有过期时间。
-- 而 ListInbox 一次全量返回、客户端一次全拉 ⇒ 一年后打开 App 是几百条，
-- 一次请求拉完，弱网下首屏直接卡住。这不是「可能发生」，是没有任何机制阻止它。
--
-- 保留期 90 天，比消息的 30 天长：通知是**平台说过的话**，已读之后仍然可能是
-- 用户回看事实的依据（「我的专属折扣当时是多少」）；会话消息 30 天后归档是
-- 社交流的常识，收件箱不是。
--
-- 为什么这不违反仓库铁律「数据永不按代码删除」：那条铁律列的例外里包含
-- 「infra GC（幂等记录）」，而这里正是同一类基础设施回收 —— 有明确期限、
-- 有 sweeper、有日志行，不是业务代码顺手删一行。conversation 域的
-- PurgeExpiredMessages（30 天 TTL + 每小时 sweeper）是同一个模式、同一类例外。
-- 被删的**只有**读件箱，事实本身（订单、内容任务、邀约）在业务表里不动。
--
-- 回填：历史行按 created_at + 90 天算。宁可让它晚一点被回收，也不要
-- expires_at 为 NULL 变成「永不过期」——那正是现在的问题。
ALTER TABLE notification.inbox_items
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ⚠️ 必须先关掉 RLS 再回填（migration 173 给这张表开了 FORCE RLS，policy 只认
--    事务级 GUC proxy.recipient_id，而**迁移自己不声明收件人**）。
--
--    踩过一次：直接在 RLS 开着的情况下 UPDATE，PG 不报错，只是**一行都匹配不到**
--    （policy 判 NULL）—— 926 行全是 NULL，接着 SET NOT NULL 失败，而 psql 默认
--    继续往下跑，于是留下一个「列存在、可空、全部为 NULL」的半应用状态：
--    看起来迁移成功了，实际等于什么都没做，而且 sweeper 永远不会删任何东西
--    （NULL 比较永远是 NULL）。这是最坏的一种失败形态：安静。
--
--    所以这段显式 DISABLE → 回填 → 收紧 → ENABLE + FORCE 全部还原。FORCE 必须
--    重新声明：ENABLE 单独用对表属主不生效，而迁移连接用的就是属主。
--    迁移在事务里跑（migrator.applyOne 现在逐文件开事务），所以这段窗口不会
--    对外可见。
ALTER TABLE notification.inbox_items DISABLE ROW LEVEL SECURITY;

-- 173 只授了 UPDATE(read) 一列（「投递事实不可改」），而回填要写 expires_at ⇒
-- permission denied。这里**只**补 expires_at 这一列，而不是把表级 UPDATE 还回去：
-- 保留期不是投递事实（标题/正文/深链/收件人才是），给这一列写权限与 173 的意图
-- 一致，也不会悄悄放宽别的列。
DO $$
DECLARE app_role TEXT := current_user;
BEGIN
    EXECUTE format('GRANT UPDATE (expires_at) ON notification.inbox_items TO %I', app_role);
END
$$;

UPDATE notification.inbox_items
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

ALTER TABLE notification.inbox_items
    ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE notification.inbox_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.inbox_items FORCE ROW LEVEL SECURITY;

-- sweeper 的驱动索引：只扫已过期的。
CREATE INDEX IF NOT EXISTS ix_inbox_items_expires_at
    ON notification.inbox_items (expires_at);

COMMENT ON COLUMN notification.inbox_items.expires_at IS
    '读件箱保留期终点（created_at + 90 天）。176：没有过期机制的收件箱是必然撑爆的 —— ListInbox 全量返回、客户端全量拉。被回收的只是「读件箱」这一条，事实本身在业务表里不动（同 PurgeExpiredMessages 的 30 天 TTL 模式，铁律里的 infra GC 例外）。';
