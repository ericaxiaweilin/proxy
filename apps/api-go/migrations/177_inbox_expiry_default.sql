-- 177_inbox_expiry_default.sql
--
-- MERCHANT-CREATOR-NOTIFY-001：给 expires_at 一个数据库默认值。
--
-- 176 把它设成 NOT NULL，管线（notification.Pipeline.Emit）会显式写 created_at
-- + 90 天。但 NOT NULL + 无默认值意味着：**任何**直接写这张表的语句都必须自己算
-- 一个过期时间 —— 手写 SQL、临时脚本、以后新加的写路径，一个漏掉就是
-- "null value in column expires_at" 的写入失败。
--
-- 这个默认值让「忘了算」不再是一个错误，而是一个明确的默认保留期。
-- 显式的值仍然优先（管线写的就是显式值），所以这个 DEFAULT 不改变任何现有行为。
--
-- 为什么是单独一个迁移而不是改 176：176 已经 apply 了，改它的内容会触发
-- migrator 的 drift 检测（已 apply 的文件 checksum 变了 ⇒ 拒绝启动）。
ALTER TABLE notification.inbox_items
    ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '90 days');

COMMENT ON COLUMN notification.inbox_items.expires_at IS
    '读件箱保留期终点。176 引入（NOT NULL，Pipeline 显式写 created_at+90 天）；177 加数据库默认值 (now()+90 天)，让漏算的写入不再是错误。回收只删读件箱，事实本身在业务表里不动。';
