-- ORDER-AGENT-CLAIM-NO-001：接单编号（技师号）随订单快照冻结 + 存量回填。
--
-- 背景（用户：「我的订单 每个订单记录recipe没有匹配的用户接单编号 必须要有 因为只要
-- 去线下接单赚钱 必须有一个唯一的接单编号」）：接单编号（identity.agent_claim_numbers，
-- 注册时顺序分配、1 起无跳号、至少 3 位零填充）以前**只活在 profile 一条链路上**——
-- 订单侧只有 agent_id（usr_xxx 内部主键）和订单编号（21 位，双方共用）。技师号才是
-- 「打电话能报、扫一眼能认」的那个号，usr_xxx 线下对不上。
--
-- 为什么写进 snapshot 而不是 orders 表新列：OrderSnapshot 是 Gate G 冻结的确认快照，
-- 「写入后不变、条款变更走 amendment 版本链」这套语义已经在跑；把新字段塞进快照就自动
-- 继承这些性质，不用另立一套冻结规则。snapshot 是 JSONB 整块存（见 postgres/fulfillment.go
-- encodeOrderJSON），所以**不需要 ALTER TABLE**。
--
-- 为什么回填要破窗：143 的 orders_guard 明确禁止「snapshot changes only through an
-- accepted amendment」，而回填按定义就是绕过 amendment 的历史订正。走和其它历史订正
-- 一样的口子（144 补 order_no 就是这么做的）：set_config('proxy.guard_override', …)，
-- 理由和操作者进审计行，不留无名改写。
--
-- 回填口径：按 agent_id 关联 identity.agent_claim_numbers，把当时的技师号补进快照。
-- 关联不上的（该账户没有号：内存仓注册的老数据、号未分配）**保持缺失**——不写 0、
-- 不拿别的号顶。客户端按「未分配」隐藏那一行（用户：「不接单 接单编号暂时隐藏」）。
-- 这里回填的是「当时那个接单方的号」，号本身在注册时就定了、终身不变，所以事后回填
-- 与当时冻结等价。
BEGIN;

SELECT set_config('proxy.guard_override', 'migration 148: backfill agent claim number into order snapshots', true);
SELECT set_config('proxy.audit_actor', 'migration:148', true);

WITH numbered AS (
    SELECT o.id, c.claim_number
    FROM fulfillment.orders o
    JOIN identity.agent_claim_numbers c ON c.user_account_id = o.agent_id
    -- 只补「真的缺编号」的：已有非零值的不动（重跑幂等），也不覆盖任何已冻结的值。
    WHERE COALESCE((o.snapshot->>'agentClaimNumber')::int, 0) = 0
      AND c.claim_number >= 1 AND c.claim_number <= 10000000
)
UPDATE fulfillment.orders o
SET snapshot = jsonb_set(o.snapshot, '{agentClaimNumber}', to_jsonb(numbered.claim_number), true),
    -- guard 要求 version 每次 +1；回填也是一次写，按规矩推进，不原地覆盖。
    version = o.version + 1,
    updated_at = now()
FROM numbered
WHERE o.id = numbered.id;

SELECT set_config('proxy.guard_override', '', true);
SELECT set_config('proxy.audit_actor', '', true);

COMMIT;
