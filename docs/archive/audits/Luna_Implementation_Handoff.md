# Luna Implementation Handoff

**当前基线**：Proxy v1.5.2 Outcome Finalization · Chapter 21D R3 FINAL · P0 Addendum R3 FINAL ALIGNED  
**Handoff 包**：`Proxy_Brand_Final_Handoff_v1.0(1).zip`（rebuilt final）
**实现状态**：[Implementation Status](./Implementation_Status.md)

## 任务

把 Proxy PRD v1.1 和 System Architecture v1 实现为一个可运行的 iOS / Android App、模块化 Backend，以及最低必要的内部 Operator Console。

Luna 开始编码前按顺序阅读：

1. `Proxy_PRD_v1.1_Canonical_Registry.md`
2. `architecture/Proxy_System_Architecture_v1.md`
3. `architecture/Proxy_Architecture_Decisions_v1.md`
4. `architecture/Proxy_Outcome_Intelligence_Architecture_R3.md`
5. `Proxy_PRD_v1.1_Chapter21_P0_Screen_Flow_Information_Architecture_Page_Spec.md`
6. `Proxy_PRD_v1.1_Chapter25_E2E_Acceptance_Test_Matrix_Invariant_Gate.md`
7. `Proxy_PRD_v1.1_Chapter26_Engineering_API_Event_Schema_Contract.md`
8. `Proxy_PRD_v1.1_Chapter21D_Outcome_Data_Learning_Contract_R3_FINAL.md`
9. `Proxy_PRD_v1.1_P0_Engineering_Acceptance_Addendum_R3_FINAL_ALIGNED.md`
10. 当前要实现功能对应的专题 Chapter

遇到冲突时优先级：

```text
Canonical Registry / Invariant
→ Accepted ADR
→ System Architecture
→ Chapter 25 / 26 Contract
→ Feature Chapter
→ UI convenience
```

---

# 1. 不可更改的边界

```text
这是 App 项目，不是公开 Web 项目
Requester / Agent / Business 共用一个 iOS / Android App
Operator Console 仅内部使用
P0 Backend 是模块化单体
PostgreSQL 是 canonical truth
每个 object 只有一个 write owner
跨模块不能直接写表
所有 mutation 必须是 typed Command
所有不可逆动作必须有 idempotency
跨模块事实通过 Event + Outbox
Redis / Read Model / Provider / AI 不是 truth
Money 使用 integer minor units
Ledger append-only and balanced
高风险动作不能离线
AI 无数据库凭证，只能调用 allowlisted Tool API
```

不要为了先跑起来而临时跳过这些边界；这些正是 MVP 最容易形成不可修复技术债的位置。

---

# 2. 建议 Repository Layout

```text
proxy/
├── apps/
│   ├── mobile/
│   │   ├── src/app
│   │   ├── src/features
│   │   ├── src/components
│   │   ├── src/api
│   │   ├── src/storage
│   │   ├── src/device
│   │   └── src/telemetry
│   ├── api-go/
│   │   ├── cmd/api
│   │   ├── cmd/worker
│   │   └── internal
│   ├── ai-runtime/
│   └── operator-console/
├── packages/
│   ├── contracts/
│   ├── observability/
│   └── test-fixtures/
├── tooling/
│   ├── eslint-config
│   ├── typescript-config
│   └── scripts
├── infrastructure/
│   ├── local
│   ├── migrations
│   └── deployment
├── docs/
│   ├── architecture
│   └── api
├── pnpm-workspace.yaml
└── turbo.json
```

如果现有代码仓库已经有明确结构，保持功能等价即可，不要机械重排用户已有代码。

---

# 3. Stack Baseline

## Mobile

```text
React Native + TypeScript
Expo development build / prebuild
React Navigation
TanStack Query
Zustand only for small client state
React Hook Form
schema validation from contracts
SQLite for approved cache / drafts
Keychain / Keystore for credentials
```

## Backend

```text
Go
standard library net/http API baseline
typed Domain modules with explicit ports
PostgreSQL + PostGIS
Redis
S3-compatible Object Storage
OpenAPI 3.1
OpenTelemetry
```

## Test / Tooling

```text
Vitest or Jest, one choice across repository
Supertest-compatible API integration
Testcontainers or isolated PostgreSQL integration database
React Native Testing Library
Maestro or Detox for critical device E2E
gofmt + go test
TypeScript strict mode for mobile/shared contracts
```

不要同时引入多个功能重叠的 state manager、ORM、validation library 或 test runner。

---

# 4. First Coding Assignment — Foundation Slice

第一批代码只完成“可运行地基”，不要同时实现整个 Marketplace。

## 4.1 Deliverables

- monorepo 能 install / lint / typecheck / test / build；
- iOS simulator 与 Android emulator 能启动 App；
- API 与 Worker 能本地启动；
- PostgreSQL / PostGIS、Redis、Object Storage local services 可启动；
- `/health/live`、`/health/ready`；
- OpenAPI 生成与 Mobile typed client；
- shared command / error / read model envelopes；
- migration runner；
- request correlation id；
- structured redacted logging；
- Transactional Outbox 最小实现与 worker poller；
- App bootstrap、environment config、error boundary、offline banner；
- CI pipeline；
- Architecture docs 链接进入 repository README。

## 4.2 Foundation Acceptance

```text
fresh clone works
one command starts local dependencies
one command starts API + Worker
one command starts Mobile dev build
one command runs all tests
OpenAPI drift fails CI
database migration can run twice safely
outbox event survives API process restart
logs include correlation id and exclude fixture secret
```

Foundation Slice 已完成并经过 architecture review；当前代码已进入 M1 Identity baseline。M1 的第一版仍明确使用 in-memory adapter，直到 PostgreSQL repository、secure token storage 和真实 recovery provider 通过验收前，不标记为 production-ready。

---

# 5. Vertical Milestones

## M1 — Identity / Session / Principal App Shell

实现：

```text
UserAccount
LoginIdentity
Session
DeviceRegistration
AccountRecovery baseline
Individual / Agent / Business principal switch shell
secure token storage
session revoke
minimum app version
```

验收：wrong principal、revoked session、device revoke、token refresh race、logout all devices、deep-link authentication。

## M2 — Catalog / Task Draft / Publish

实现 Launch Catalog read、Task Draft、Slot plan、Policy snapshot、PublishTask。Draft 可离线保存；Publish 必须在线。

当前代码已完成 Demand Draft / Preview / PublishTask 的 in-memory baseline：Draft 使用 version 乐观并发，Preview 不创建 Task / Offer / Payment，PublishTask 只有在 Admission 与 Funding gate 明确允许时才会冻结版本并展开原子 TaskSlot；默认 gate 未配置时返回 `PENDING`。下一步是接 PostgreSQL、Catalog/Admission/Funding adapters 和移动端 SQLite Draft 恢复。

验收：stale catalog、missing must requirement、wrong business permission、duplicate publish、policy version binding。

## M3 — Agent Passport / Availability

实现 AgentProfile、Capability Passport、verification summary、AvailabilitySession、location consent 与 TTL。

验收：expired KYC、permission denied、availability conflict、location precision redaction。

## M4 — Matching / Offer / Accept / Order

实现 eligibility、candidate snapshot、ranking baseline、offer wave、push、deep link、concurrent Accept、唯一 Order。

验收：two-agent race、stale Offer、expired TTL、slot unavailable、risk block、idempotency payload mismatch。

## M5 — Payment / Ledger

先使用 sandbox adapter，实现 PaymentIntent、FundingHold、ledger entries、refund、payout hold/release、webhook dedupe、reconciliation。

验收：unknown timeout、duplicate callback、amount/currency mismatch、unbalanced ledger impossible、manual adjustment dual control。

## M6 — Execution / Evidence / Completion

实现 Check-in、purpose-bound location、media quarantine、scan result、Evidence、Completion、Payout eligibility。

验收：offline check-in denied、permission expiry、upload success but evidence absent、duplicate evidence submit、completion versus cancellation race。

## M6.5 — Outcome Intelligence / Satisfaction / Memory

先实现 `architecture/Proxy_Outcome_Intelligence_Architecture_R3.md`，再接 App 页面。

实现：

```text
ObservationTemplate
ObservationSet DRAFT / FINALIZED
OutcomeObservation
comparison compatibility gate
OutcomeDelta
Suggested Learning
Confirm / Dismiss / Delete Memory
BusinessOutcomeHistory read model
```

强制顺序：

```text
RecordOutcomeObservation
→ AttachEvidenceToObservation
→ FinalizeObservationSet
→ CreateOutcomeComparison
→ Confirm / Dismiss OutcomeLearning
```

验收：未 Finalized 不能比较；Finalized 不能直接修改；target / template lineage / venue / unit 不兼容时不能创建 Delta；缺失值只能得到 `UNKNOWN`；订单数不能直接产生 `OUTCOME_VERIFIED`；Recovery 未处理时 Repeat 隐藏。

## M7 — Inbox / Notification / Deep Link

实现 device token lifecycle、NotificationEvent、delivery dedupe、InboxItem、quiet hours、frequency cap、安全 push payload。

验收：wrong principal deep link、revoked device、expired object、duplicate push callback、D4/D5 absent from payload。

## M8 — Safety / Operator / Privacy

实现 Incident、SafetyBlock、RiskHold、OperatorCase、JIT access、Consent、LegalHold、Deletion / Export request baseline。

验收：cross-tenant deny、expired grant、sensitive read audit、LegalHold blocks deletion、Safety event creates downstream holds。

## M9 — Business Workspace

实现 BusinessAccount、Membership、Store/Venue scope、Template、Task、Members、Spend summary 和 approval。

所有能力进入 Mobile App；不要创建 Business public web portal。

## M10 — AI-assisted Operator

只实现 A0/A1：case summary、evidence index、missing information、CommandProposal。AI Runtime 无数据库凭证，所有 Tool read 受 scope 控制，高风险 action 不执行。

---

# 6. Base Contracts to Implement First

## Command Envelope

```ts
type CommandEnvelope<TPayload> = {
  commandId: string;
  commandType: string;
  commandVersion: number;
  actor: { type: 'USER' | 'OPERATOR' | 'SYSTEM' | 'PROVIDER'; id: string };
  principal: { type: 'INDIVIDUAL' | 'BUSINESS' | 'SYSTEM'; id: string };
  target: { type: string; id: string };
  idempotencyKey: string;
  expectedAggregateVersion?: number;
  policySnapshot?: { policySetId: string; policySetVersion: string };
  authContext: {
    sessionId?: string;
    reauthenticatedAt?: string;
    operatorAccessGrantId?: string;
  };
  purpose: string;
  correlationId: string;
  causationId?: string;
  requestedAt: string;
  payload: TPayload;
};
```

## Command Result

```ts
type CommandResult = {
  commandId: string;
  outcome: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'ALREADY_APPLIED';
  aggregate?: { type: string; id: string; version: number; state?: string };
  eventRefs: string[];
  operationRef?: string;
  error?: ErrorEnvelope;
  correlationId: string;
};
```

## Read Model

```ts
type ReadModelEnvelope<T> = {
  modelType: string;
  modelVersion: number;
  aggregateRefs: string[];
  lastEventId?: string;
  asOf: string;
  freshness: 'CURRENT' | 'STALE' | 'PENDING_REBUILD';
  allowedActions: string[];
  redactions: string[];
  data: T;
};
```

## Error

```ts
type ErrorEnvelope = {
  errorCode: string;
  category:
    | 'AUTHENTICATION'
    | 'AUTHORIZATION'
    | 'ACCOUNT_STATE'
    | 'VALIDATION'
    | 'BUSINESS_STATE'
    | 'ELIGIBILITY'
    | 'CONSENT_PERMISSION'
    | 'PAYMENT'
    | 'CONCURRENCY'
    | 'PROVIDER'
    | 'PRIVACY'
    | 'INTERNAL';
  retryability: 'NO' | 'SAFE_RETRY' | 'AFTER_REAUTH' | 'AFTER_USER_ACTION' | 'ASYNC_PENDING';
  messageKey: string;
  safeDetails: Record<string, unknown>;
  requiredAction?: string;
  correlationId: string;
  supportCaseRef?: string;
};
```

这些是初始 transport contract；最终字段名若调整，必须保持 Chapter 26 的语义并更新 OpenAPI、generated client 与 contract tests。

---

# 7. Domain Coding Rules

1. Aggregate method 产生 Domain Event；Repository 不自行决定业务状态。
2. Controller 不写 business rule，只做 validation / mapping / auth context extraction。
3. ORM model 不跨 module import；跨 module 使用 id/ref、port 或 event。
4. Event payload 不携带 secret、raw OTP、完整 Government ID 或不必要精确位置。
5. 每个 mutating command 都有 idempotency policy；Money、Order、Offer、Safety 必须显式测试。
6. 每个 aggregate transition 都有 positive + negative state tests。
7. Read Model 在 Backend 裁剪字段，App 不承担安全过滤。
8. Provider callback 必须 signature、dedupe、scope、object、amount/currency、transition validation。
9. Worker consumer 必须保存 inbox / dedupe；重复 event 不重复 side effect。
10. AI output 只能是 inference / draft / proposal，不能直接写 canonical state。

---

# 8. App Coding Rules

1. 不使用 DOM / browser-only API 作为公开产品主路径。
2. 不用 AsyncStorage 保存 token、KYC、bank、精确位置或 raw Evidence。
3. 不用 local state 伪造 Payment、Order、Offer accepted、KYC 或 Safety success。
4. 所有 Server state 使用 Query cache；Zustand 不复制整套 Backend 数据。
5. Deep link 必须先解析 session / principal / permission，再显示对象。
6. Push 只当提醒，点击后读取最新 Read Model。
7. 每个页面实现 loading、empty、error、stale、restricted、offline 状态。
8. 关键 CTA 使用 server `allowedActions`，command 前仍准备 version / idempotency。
9. 设备 permission denial 必须有明确降级，不诱导或反复弹窗。
10. iOS / Android 真机测试覆盖 Camera、Location、Push、Background upload、Secure Storage。

---

# 9. Forbidden Shortcuts

```text
direct database write from Operator Console
one giant status for Task / Order / Payment
Redis lock as only concurrent-accept guarantee
float money
provider SUCCESS mapped without local validation
HTTP 200 treated as business completion
silent retry after unknown payment result
storing secrets in env committed files or logs
front-end-only permission checks
generic candidate / people search endpoint
raw D4 / D5 in analytics or push
AI with database credentials
AI arbitrary tool / URL / shell
offline high-risk command marked successful
hardcoded market/provider exception in Domain logic
microservice split without ADR and measured need
public Business Web portal in P0
```

---

# 10. Definition of Done for Every Vertical Slice

- App happy path works on iOS and Android emulator/device。
- Domain unit/state transition tests pass。
- PostgreSQL integration and migration tests pass。
- Command idempotency tested。
- Permission / wrong-principal / cross-tenant negative tests pass。
- Event + Outbox + consumer replay tested。
- Read Model includes freshness, allowed actions and redaction。
- Loading / error / stale / offline / restricted App states exist。
- Structured logs and metrics include correlation id and no sensitive payload。
- OpenAPI and generated client are synchronized。
- Chapter 25 relevant AC mapped to automated tests。
- No unresolved blocker hidden behind TODO or fake provider success。

---

# 11. Questions Luna Must Escalate

Luna 不应自行猜测以下内容：

- 首发国家 / Metro / currency / timezone；
- Payment、KYC、Map、Media、Notification 供应商；
- Legal / tax / retention values；
- PRD 中不存在的新 object / status / command / event；
- Money、Safety、KYC、Privacy 的例外；
- 是否允许新的 offline mutation；
- 是否拆 service 或引入新的 infrastructure system；
- App Store / signing / cloud credentials。

这类问题先提交给架构/产品决策；可以用 typed adapter / config placeholder 继续安全推进，但不能硬编码假答案。

---

# 12. Handoff Completion Signal

Luna 完成每个 milestone 后应提供：

```text
changed modules
implemented commands / events / read models
database migrations
tests mapped to PRD AC
security / privacy checks
known limitations
operational metrics / alerts
demo path on iOS / Android
next architecture decision required
```

第一步只执行 Foundation Slice。不要一次性生成整个 App 的空页面、全部数据库表和几十个没有业务行为的 service。
