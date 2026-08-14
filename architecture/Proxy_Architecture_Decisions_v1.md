# Proxy Architecture Decision Records v1

本文件记录实现前已经锁定的架构决策。Luna 可以优化实现细节，但改变任何 `ACCEPTED` 决策前必须提交新的 ADR，说明原因、迁移、风险与验证方法。

---

# ADR-001 — Public Product Is a Mobile App

**状态**：ACCEPTED  
**决策**：Requester、Agent、Business 使用同一个 iOS / Android App。P0 不建设公开 Web、PWA 或响应式浏览器产品。Operator 使用独立内部桌面 Console。

**结果**：

- 导航、弱网、Push、Deep Link、Location、Camera、Secure Storage、App release 是一等架构能力。
- Business 复杂操作也必须设计成 App flow，不能要求用户打开 Web。
- Operator Console 不能共享公开 App 的授权假设。

---

# ADR-002 — React Native + TypeScript

**状态**：ACCEPTED BASELINE  
**决策**：公开 App 使用 React Native + TypeScript，采用 Expo development build / prebuild；具体版本在 repository bootstrap 时固定。

**理由**：双端共享、设备能力成熟、可编写 Swift/Kotlin module、可共享 TypeScript contracts。

**不选择**：

- WebView / PWA 作为 App 主体；
- 三套独立 App；
- 仅因个别 native module 就提前维护两套 Swift / Kotlin 产品代码。

若实测关键设备能力无法满足，才允许以新 ADR 评估原生双端。

---

# ADR-003 — Go Backend + TypeScript Mobile Contract Workspace

**状态**：ACCEPTED  
**决策**：Backend 使用 Go；App、Operator Console 和共享契约仍使用 TypeScript；所有代码与测试放在同一 monorepo。pnpm 管理移动端/契约 workspace，Go 使用独立 `go.mod`。

```text
apps/mobile
apps/api-go
apps/api-go/cmd/worker
apps/ai-runtime
apps/operator-console
packages/contracts
packages/observability
packages/test-fixtures
```

共享 package 只放稳定的 JSON/OpenAPI contract、value object 和无平台依赖逻辑；不得把 Go Domain entity 或 App component 放入共享包。Go backend 不直接依赖 TypeScript package。

---

# ADR-004 — Modular Monolith Before Microservices

**状态**：ACCEPTED  
**决策**：P0 Backend 是模块化单体。模块有独立 write ownership、schema、command handler 和 event contract，但部署在同一 API / Worker codebase。

**理由**：首发阶段正确性、开发速度与运维能力高于独立扩缩容；Order、Slot、Payment 与 Safety 不适合在没有运行证据时提前分布式化。

**拆分门槛**：测量到独立 scaling/security/deployment 需求，且 contract、owner、SLO、reconciliation 已稳定。

---

# ADR-005 — PostgreSQL / PostGIS Is Canonical Store

**状态**：ACCEPTED  
**决策**：使用 PostgreSQL + PostGIS 保存所有 canonical state。Redis、search、read projections、Provider、AI 不是事实来源。

**规则**：

- Slot 并发、Order 唯一性、Ledger 平衡由数据库 transaction / constraint 保证。
- Money 使用 integer minor units + currency。
- Aggregate 使用 version 实现 optimistic concurrency；关键竞争可用 row lock / conditional update。
- Geo P0 使用 PostGIS，不提前引入独立搜索集群。

---

# ADR-006 — CQRS-lite, Not Full Event Sourcing

**状态**：ACCEPTED  
**决策**：Command 与 Query 分离；Aggregate 当前状态保存在业务表，Domain Event 和 Outbox 保存不可变事实与集成记录。不以 event replay 作为所有 aggregate 的唯一重建方式。

**理由**：保留明确的行为契约与审计，同时控制实现复杂度。

---

# ADR-007 — Transactional Outbox

**状态**：ACCEPTED  
**决策**：Domain state mutation 与 OutboxMessage 在同一 PostgreSQL transaction 中提交。Worker 至少一次发送；consumer 使用 inbox / dedupe。

**不选择**：

- 先提交数据库、再 best-effort 发消息；
- 假设 queue exactly once；
- P0 引入 Kafka 解决尚不存在的吞吐问题。

---

# ADR-008 — REST/JSON + OpenAPI for Mobile Contract

**状态**：ACCEPTED  
**决策**：App 使用 HTTPS REST/JSON，OpenAPI 3.1 为 transport contract，生成 typed client。Query 和 canonical Command endpoint 分离。

**不选择**：P0 GraphQL federation。原因是当前页面契约明确，写入需要严格 command envelope、idempotency 和 error semantics；GraphQL 不提供额外必要价值。

---

# ADR-009 — No Offline High-risk Mutation

**状态**：ACCEPTED  
**决策**：App 可离线读取批准缓存、编辑 Draft、保存待上传媒体；AcceptOffer、Payment、KYC、Check-in、Completion、Safety、Consent withdrawal、Account lifecycle 必须在线 revalidate。

**结果**：App 不显示虚假成功；网络结果未知时展示 `PENDING / VERIFYING`，通过 operation status 查询。

---

# ADR-010 — One App, Explicit Principal Context

**状态**：ACCEPTED  
**决策**：Individual Requester、AgentProfile、BusinessMembership 在同一 App 中切换。每个 query / command 都带 explicit principal context，服务端重新验证。

**规则**：客户端最近一次选择不能成为授权；支付主体、Business scope、Agent identity 必须在高影响动作前再次展示。

---

# ADR-011 — Provider Adapter Isolation

**状态**：ACCEPTED  
**决策**：Payment、KYC、Geo、Media、Notification 使用独立 adapter。Domain 只识别 normalized result，不识别供应商 SDK enum。

Provider secret 只存在 Secret Manager / adapter runtime。Timeout unknown result 进入 query/reconciliation，不盲目 retry mutation。

---

# ADR-012 — AI Runtime Has No Database Authority

**状态**：ACCEPTED  
**决策**：AI Runtime 是独立进程，无数据库凭证、无任意 shell、无任意 HTTP、无 Provider secret。它只能调用 allowlisted Tool API，默认只读；写入必须产生 typed CommandProposal，并按风险进入审批和 revalidation。

AI 不得成为 User、Operator、Business 或 Domain principal。

---

# ADR-013 — Mobile Credentials in OS Secure Storage

**状态**：ACCEPTED  
**决策**：refresh token、device credential 使用 iOS Keychain / Android Keystore。普通 local storage、SQLite、analytics、crash log 不保存 token 或 raw D5。

高风险 command 支持 recent auth / biometric step-up。Session revoke、device revoke、minimum app version 必须由 Backend 强制。

---

# ADR-014 — Single Region, Multi-AZ for P0

**状态**：ACCEPTED  
**决策**：首发部署在一个 residency-approved Region、多个可用区。Stateless API 可多实例；PostgreSQL managed primary/standby；failover 初期人工受控。

**不选择**：multi-region active-active writes。Money、Order、Identity 和 Safety 在无 fencing / reconciliation 证明前保持单写 owner。

---

# ADR-015 — No Kubernetes for P0

**状态**：ACCEPTED  
**决策**：优先使用托管 container runtime / app platform、managed PostgreSQL、managed Redis 和 Object Storage。没有真实的 cluster 运维需求前不引入 Kubernetes。

该决策不绑定具体云厂商。

---

# ADR-016 — Read Models Are Freshness-aware and Redacted

**状态**：ACCEPTED  
**决策**：App / Console 不拼接多个 endpoint 创造业务真相。每个页面使用 purpose-built Read Model，包含 `as_of`、freshness、aggregate version、allowed actions 和 redactions。

Stale Read Model 不能授权写入；Command handler 必须读取 owner 的当前事实。

---

# ADR-017 — Object Storage Quarantine for Media

**状态**：ACCEPTED  
**决策**：App 通过短期 signed upload session 上传到 quarantine；扫描、hash 与 metadata 验证通过后才能由 `SubmitEvidence` 绑定为 Evidence。

上传成功不等于 Evidence submitted。Object Storage key 不直接成为公开 URL。

---

# ADR-018 — Remote Config Cannot Replace Policy

**状态**：ACCEPTED  
**决策**：App remote config 可控制 UI rollout、capability visibility 和 minimum version，但 Money、Safety、Eligibility、Permission、Retention、KYC、Matching 与 Cancellation 规则必须来自 Backend versioned PolicySet。

客户端 flag 不能使 server-disabled action 可执行。

---

# ADR-019 — Observability and Audit Are Separate

**状态**：ACCEPTED  
**决策**：OpenTelemetry logs/metrics/traces 用于运行可观测性；OperatorAuditLog、Ledger、SensitiveAccessAudit、Approval 与 ActionReceipt 是业务审计，必须 append-only、可关联、独立保留。

普通日志不能替代合规证据，审计也不能保存不必要的 raw secret。

---

# ADR-020 — Architecture Change Process

**状态**：ACCEPTED  
**决策**：出现以下情况必须新增 ADR，并检查 Canonical Registry / PRD 是否需要同步：

```text
new canonical object or status
new write owner
new database / queue / search system
module split into service
new public client surface
offline high-risk behavior
new provider authority
new AI tool / autonomous action
multi-region write
security / privacy boundary change
```

代码 review 不能用“实现方便”绕过已接受的架构决策。

---

# ADR-021 — Outcome Intelligence Has Its Own Domain Gate

**状态**：ACCEPTED — R3
**决策**：OutcomeTemplate、ObservationSet、OutcomeObservation、OutcomeDelta 和 OutcomeLearning 由独立 `OutcomeIntelligence` 模块持有。Before / After 的比较必须经过 Domain compatibility gate；客户端原型、Read Model 或 AI 不能授权生成 Delta。

**强制顺序**：

```text
ObservationSet DRAFT
→ FinalizeObservationSet
→ FINALIZED
→ compatibility validation
→ CreateOutcomeComparison
→ OutcomeDelta
```

**兼容性至少包括**：

```text
same target
compatible template lineage
same venue / store / entity
compatible unit / ordinal scale / state vocabulary
active comparison policy
persisted comparison_policy_version
```

**结果**：

- 不兼容时拒绝创建 OutcomeDelta；
- 数据缺失但对象兼容时，`comparison_result = UNKNOWN`；
- 结果只能是 `IMPROVED / WORSE / SAME / UNKNOWN`；
- Raw Evidence 与结构化 Observation 分别由 ExecutionEvidence / OutcomeIntelligence 持有；
- Suggested Learning 必须经过 Requester Confirm 或 Dismiss；
- 订单数、五星或单次结果只能触发 Outcome Verification Review，不能直接生成 `OUTCOME_VERIFIED`。

详细 contract 见 `architecture/Proxy_Outcome_Intelligence_Architecture_R3.md`。
