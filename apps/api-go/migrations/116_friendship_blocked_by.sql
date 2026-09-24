-- FRIEND-BLOCK-UNDO-001: friendships 记"谁按的拉黑"。
--
-- 背景：BLOCKED 是防骚扰边界，但行里不记 blocker —— 显式 Unblock 命令
-- （block_reentry_test 要求"解除必须是显式命令"）将来只能由按的人发起，
-- 没有这个字段就无从判定，只能两边都拒到底（含拉黑者本人，拉黑变永久）。
-- 本迁移只加列、不改行：历史 BLOCKED 行 blocked_by 为空 = 未知，
-- service 侧未知一律按"对方拉的"处理（宁严勿松），行为不变。
-- 编号说明：110–112、114–115 是同期另一会话的未合入迁移；113 已合入
-- （media RLS forward partitions）；116 是当前空闲号。

ALTER TABLE relationship.friendships
    ADD COLUMN IF NOT EXISTS blocked_by TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN relationship.friendships.blocked_by IS
  'FRIEND-BLOCK-UNDO-001: 按下拉黑的人（user id）。空=未知（字段落地前的历史行）。显式 Unblock 命令的唯一凭证。';
