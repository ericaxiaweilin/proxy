-- COMP-PURPOSE-CONSENT-001: 按「目的」的同意，不是按「文档」的接受。
--
-- 为什么不复用 privacy.legal_consent_records（059）：
-- 那张表的 doc_kind 被 CHECK 约束钉死在 ('TERMS','PRIVACY')，语义是
-- **「用户接受了哪一版《条款》/《隐私政策》」** —— 合同接受。而
-- Nghị định 356/2025/NĐ-CP 要求的是**可验证的目的性同意**：
--   * Art. 6.1：同意必须是**可验证的形式**；
--   * Art. 6.2：控制者必须**保存**同意，发生争议时**举证责任在控制者**；
--   * Art. 6.3：**不得设置默认同意机制**；
--   * Art. 4.1(l)：追踪「在电信服务、社交网络、在线通讯服务及其他网络空间
--     服务中的使用行为与活动的数据」= **敏感个人数据**；
--   * Art. 5：撤回同意有明确时限 —— 所以同意必须**可撤回**。
--
-- 「接受了隐私政策 1.1 版」推不出「同意逐张照片的停留时长 + 放大次数被采集」。
-- 把这两件事塞进一张表，等于用一个泛泛的合同接受去覆盖一类敏感处理，
-- 而这恰恰是 Art. 6.3 要禁止的那种「含糊、误导、分不清同意与不同意」。
--
-- ── 为什么是「动作日志」而不是「一行当前状态」 ──
-- 第一版写成了「一行 = 当前状态，撤回就 UPDATE 掉 withdrawn_at」，
-- 并在注释里说「审计交给 domain event log」。**那是错的**：这个仓里
-- domain event 只作为 `Result.EventRefs`（一串 id）返回给调用方，
-- **没有任何地方把它持久化**（localnet 的 MemoryRepository.events 字段
-- 全仓零写入，API 层也没有 event store）。所以那句话会让人以为
-- 「审计有了」，其实审计**不存在** —— 正是本仓最熟的那种假闭环。
--
-- 所以这张表本身就是审计：
--   * **只 INSERT，从不 UPDATE，从不 DELETE**（append-only）；
--   * 一行 = 一次动作（GRANT 或 WITHDRAW），带 acted_at / source / ip / user_agent；
--   * 「当前是否有效」= 该 (user, purpose, policy_version) 下**最新一行**是 GRANT；
--   * 授予→撤回→再授予 的历史完整保留，随时可回放。
--
-- policy_version 由**服务端**给（localnet.PurposePolicyVersion）。读活跃同意时
-- 按它过滤，所以改那个常量 = 所有旧同意立即失效、用户必须重新同意 ——
-- 这正是「同意与所述目的绑定」的实现。改它之前必须先改用户看到的说明文案。
CREATE TABLE IF NOT EXISTS privacy.purpose_consents (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    purpose        TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    action         TEXT NOT NULL CHECK (action IN ('GRANT','WITHDRAW')),
    acted_at       TIMESTAMPTZ NOT NULL,
    source         TEXT NOT NULL,
    ip             INET,
    user_agent     TEXT
);

-- 读侧只有一种问法：「这个人、这个目的、当前版本，最新一次动作是什么」。
-- 所以索引按 (user_id, purpose, policy_version, acted_at DESC) 建。
-- id 作为同一时刻的决胜键（见 PurposeConsentState 的 ORDER BY）。
CREATE INDEX IF NOT EXISTS idx_purpose_consents_latest
    ON privacy.purpose_consents (user_id, purpose, policy_version, acted_at DESC);
