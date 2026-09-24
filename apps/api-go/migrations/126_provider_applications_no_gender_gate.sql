-- ORDER-PERMISSION-001（2026-09-24，用户：「不是申请成为小美 是申请接单权限 如果只是小美有性别歧视限制」）：
-- 125 把「自证女性」做成了必填 —— 接单权限按性别设门是歧视。改成「照片为本人真实照片」的承诺；
-- 性别不再是任何门槛（以前那列的值全部作废为 false，重新提交时由本人勾照片承诺）。
ALTER TABLE supply.provider_applications RENAME COLUMN gender_attested TO photos_attested;
UPDATE supply.provider_applications SET photos_attested = FALSE;
