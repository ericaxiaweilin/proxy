-- AGENT-CLAIM-NUMBER-002: 105 的计数器同步在部分环境未生效（回填行在、
-- 计数器停留 1），下一次分配会撞 claim_number 唯一键。这里幂等地把计数器
-- 推到 MAX(claim_number)+1，只增不减，可重复执行。
UPDATE identity.agent_claim_number_counter
SET next_number = (SELECT COALESCE(MAX(claim_number), 0) + 1 FROM identity.agent_claim_numbers)
WHERE id = 1
  AND next_number < (SELECT COALESCE(MAX(claim_number), 0) + 1 FROM identity.agent_claim_numbers);
