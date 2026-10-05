-- MERCHANT-CREATOR-NOTIFY-001：device_tokens.status 的 CHECK 与代码实际写入的值对齐。
--
-- 真 bug（2026-10-05 查通知管线时实证）：DeactivateDeviceToken 退役一个被
-- APNs/FCM 判死的令牌时写 status='INACTIVE'，而 021 建表时的 CHECK 只允许
-- ACTIVE/REVOKED/EXPIRED ⇒ 每次退役都撞约束失败。失败又被 push.go 静默忽略，
-- 于是失效令牌永远留在 ACTIVE 里，每次推送都白跑一遍死令牌。
-- 实证（事务回滚，不留数据）：
--   INSERT ... status='INACTIVE' ⇒ ERROR: violates check constraint
--     "device_tokens_status_check"
--
-- 为什么不改代码去写 REVOKED：INACTIVE 这套词汇已经是本域的既有语义
-- （内存仓储、UpsertDeviceToken 重新登录时置回 ACTIVE、push_test 的退役用例都按
-- INACTIVE 写），把四处一起改会动到别的含义。这里把约束补齐 —— 加值是纯增量，
-- 既有行不受影响。
ALTER TABLE notification.device_tokens DROP CONSTRAINT IF EXISTS device_tokens_status_check;
ALTER TABLE notification.device_tokens
    ADD CONSTRAINT device_tokens_status_check
    CHECK (status IN ('ACTIVE','INACTIVE','REVOKED','EXPIRED'));
