# Proxy PRD v1.1
## Chapter 26 — Engineering API / Event / Schema Contract

**文档类型**：服务边界 / Command API / Domain Event / Read Model / Schema Evolution / Provider Adapter
**状态**：ACTIVE — Engineering Contract v1
**前置依赖**：Canonical Registry、Chapter 20–25、PSET_LAUNCH_V1
**后续依赖**：Provider Integration Contract、Market Legal / KYC / Payment Review、Implementation Design

---

# 0. 本章目标

Chapter 25 已定义“什么行为才算通过”。本章进一步定义“服务之间如何表达这些行为”：

```text
Command Envelope
Domain Event Envelope
Aggregate Version
Idempotency
Authorization Context
Policy Snapshot
Read Model Contract
Error Contract
Provider Adapter Boundary
Schema Version / Compatibility
```

本章不绑定具体编程语言、数据库、消息队列或云厂商。实现可以采用 REST、gRPC、GraphQL、internal RPC 或 message-driven architecture，但跨边界的语义必须等价。

---

# 1. Contract Constitution

## 1.1 Domain Truth 优先

```text
Command → Domain Decision → State Mutation → Domain Event → Read Model Projection
```

规则：

```text
Client 不得直接写 Domain state
Read Model 不得作为授权真相
Event 不得反向伪造未发生的 Domain fact
Provider callback 不得绕过本地 aggregate transition
```

## 1.2 每个边界必须带上下文

所有 Command、Event、Sensitive Query 至少可追踪到：

```text
actor
principal
purpose
authorization decision
policy snapshot
correlation_id
causation_id
```

缺少 Principal 的 Business command 默认拒绝；缺少 Purpose 的 D4 / D5 query 默认拒绝。

## 1.3 Sync Result 不是最终事实的替代品

同步响应只表示：

```text
accepted
rejected
pending
already_completed
```

最终 Domain fact 由 aggregate state 与事件确认。Provider 等待、异步 KYC、Payout processing、Export generation 等不能为了返回 200 而伪装成完成。

## 1.4 Stable Contract，具体实现可变

以下必须稳定：

```text
semantic command name
state transition rule
error code meaning
idempotency behavior
event ordering / version rule
privacy redaction rule
```

以下可以替换：

```text
transport
database
queue
cache
projector implementation
provider vendor
```

---

# 2. Service Boundary Map

## 2.1 P0 Bounded Contexts

| Context | 负责 | 不负责 |
|---|---|---|
| Identity & Account | UserAccount、LoginIdentity、Session、Recovery、Account lifecycle | Agent capability、Order pricing |
| Principal & Business | BusinessAccount、Membership、Owner transfer、Principal context | 个人登录凭证、Provider secrets |
| Graph & Capability | Industry、Scenario、Role、Capability、Evidence requirement | 当前 Risk、支付扣款 |
| Demand | Task、SlotGroup、TaskSlot、TaskNeedProfile | Candidate ranking、Ledger |
| Supply | AgentProfile、AvailabilitySession、Location visibility | Order settlement |
| Match & Offer | MatchAttempt、Candidate snapshot、Offer、wave、revalidation | KYC raw storage、payout |
| Marketplace Transaction | Quote、Order、CompensationTerms、Cancellation、No-show | Provider token、原始 KYC |
| Payment & Ledger | PaymentIntent、FundingHold、Refund、Payout、Ledger、Settlement | Agent capability、页面 CTA |
| Execution & Evidence | ExecutionContext、Check-in、Evidence、Contact grant、Exception | 账户登录、资金记账 |
| Trust & Safety | Review、Incident、RiskDecision、SafetyBlock、DisputeHold、Appeal | 修改已发生 Ledger fact |
| Notification & Inbox | NotificationEvent、Delivery、InboxItem | 决定交易是否成立 |
| Privacy & Data Lifecycle | ConsentRecord、PermissionGrant、RetentionPolicy、LegalHold、DeletionRequest、ExportRequest | 重新写业务历史 |
| Operator | Case、JIT grant、ManualAdjustment request、OperatorAuditLog | 代替用户执行命令 |

## 2.2 Ownership Rule

每个 Canonical object 必须只有一个写入 owner：

```text
UserAccount → Identity & Account
Task / TaskSlot → Demand
Offer → Match & Offer
Order → Marketplace Transaction
PaymentIntent / Ledger → Payment & Ledger
Evidence → Execution & Evidence
RiskDecision / SafetyBlock → Trust & Safety
Consent / Retention → Privacy & Data Lifecycle
OperatorAuditLog → Operator
```

其他 Context 只能通过：

```text
owned command
approved event
read projection
```

不得跨服务直接更新另一 Context 的表。

## 2.3 Cross-context Transaction

跨 Context 不要求分布式两阶段提交；必须使用：

```text
local atomic mutation
outbox event
consumer idempotency
compensating command
reconciliation case
```

涉及资金、Slot lock、Safety hold、身份状态的操作必须定义失败补偿，不允许“部分成功但无状态”。

---

# 3. Command Envelope

## 3.1 Canonical Envelope

所有写入 Command 使用同一逻辑 envelope：

```json
{
  "command_id": "cmd_...",
  "command_type": "AcceptOffer",
  "command_version": 1,
  "actor": {
    "type": "USER|OPERATOR|SYSTEM|PROVIDER",
    "id": "..."
  },
  "principal": {
    "type": "INDIVIDUAL|BUSINESS|SYSTEM",
    "id": "..."
  },
  "target": {
    "type": "Offer",
    "id": "..."
  },
  "idempotency_key": "...",
  "expected_aggregate_version": 7,
  "policy_snapshot": {
    "policy_set_id": "PSET_LAUNCH_V1",
    "policy_set_version": "..."
  },
  "auth_context": {
    "session_id": "...",
    "reauthenticated_at": "...",
    "operator_access_grant_id": null
  },
  "purpose": "MARKETPLACE_ACTION|SUPPORT|RISK|PAYMENT|EXPORT|RECOVERY",
  "correlation_id": "...",
  "causation_id": "...",
  "requested_at": "...",
  "payload": {}
}
```

字段约束：

| 字段 | 要求 |
|---|---|
| `command_id` | 全局唯一；用于单次提交追踪 |
| `command_type` | stable semantic name；不能把 UI button name 当 contract |
| `actor` | 真实发起者；Operator 不可伪装为 User |
| `principal` | 业务归属；Business command 必填 |
| `target` | 目标 aggregate / object；不可只靠 payload 猜测 |
| `idempotency_key` | 所有不可逆或可收费 command 必填 |
| `expected_aggregate_version` | 并发敏感 command 必填或明确使用 server-side conditional check |
| `policy_snapshot` | 会改变价格、候选、TTL、权限、保留期的 command 必填 |
| `auth_context` | 需 step-up、Session、Operator grant 的 command 必填 |
| `purpose` | D4 / D5、Recovery、Export、Operator command 必填 |
| `payload` | 只包含该 command 所需字段；拒绝未知高风险字段 |

## 3.2 Command Result Envelope

```json
{
  "command_id": "cmd_...",
  "outcome": "ACCEPTED|REJECTED|PENDING|ALREADY_APPLIED",
  "aggregate": {
    "type": "Offer",
    "id": "offer_...",
    "version": 8,
    "state": "ACCEPTED"
  },
  "event_refs": ["evt_..."],
  "read_model_hint": "order_...",
  "error": null,
  "correlation_id": "..."
}
```

`ACCEPTED` 不等于 Provider 已完成；如果资金、KYC、Export 或 Payout 仍异步处理，必须返回 `PENDING` 和可查询的 operation reference。

---

# 4. P0 Command Catalog

## 4.1 Identity / Privacy Commands

| Command | Owner | 必要授权 | 幂等 | 主要结果 / Event |
|---|---|---|---|---|
| `CreateUserAccount` | Identity | valid contact challenge | yes | `UserAccountCreated` |
| `VerifyContactChallenge` | Identity | OTP challenge | yes | `ContactVerified`、可能 `UserAccountActivated` |
| `CreateSession` | Identity | verified login method + risk check | yes per auth attempt | `SessionCreated` |
| `RevokeSession` | Identity | self / authorized operator | yes | `SessionRevoked` |
| `RevokeAllSessions` | Identity | re-auth / recovery | yes | batch `SessionRevoked` |
| `AddLoginIdentity` | Identity | current session + step-up | yes | `LoginIdentityAdded` |
| `RemoveLoginIdentity` | Identity | replacement identity + step-up | yes | `LoginIdentityRemoved` |
| `RequestAccountRecovery` | Identity | recovery proof | yes | `AccountRecoveryRequested` |
| `CompleteAccountRecovery` | Identity | approved recovery case | yes | `AccountRecoveryCompleted` |
| `RecordConsent` | Privacy | user / principal context | yes | `ConsentRecorded` |
| `WithdrawConsent` | Privacy | consent owner + step-up where required | yes | `ConsentWithdrawn` |
| `GrantPermission` | Privacy | product purpose + OS permission | yes | `PermissionGranted` |
| `RevokePermission` | Privacy | permission owner / expiry | yes | `PermissionRevoked` |
| `RequestDataExport` | Privacy | user + step-up | yes | `DataExportRequested` |
| `RequestDataDeletion` | Privacy | user + step-up | yes | `DataDeletionRequested` |
| `CancelDataDeletion` | Privacy | user + allowed window | yes | `DataDeletionCancelled` |
| `CreateLegalHold` | Privacy / authorized Operator | scoped reason + approval | yes | `LegalHoldCreated` |
| `ReleaseLegalHold` | Privacy / authorized Operator | approval | yes | `LegalHoldReleased` |

## 4.2 Demand / Match / Transaction Commands

| Command | Owner | 必要授权 | 幂等 | 主要结果 / Event |
|---|---|---|---|---|
| `CreateTaskDraft` | Demand | Requester principal | yes | `TaskDraftCreated` |
| `UpdateTaskDraft` | Demand | Task owner + principal | yes by version | `TaskDraftUpdated` |
| `PublishTask` | Demand | K1 + admission | yes | `TaskPublished` |
| `CreateTaskSlots` | Demand | Task owner | yes by slot plan hash | `TaskSlotsCreated` |
| `RequestQuote` | Marketplace | Task owner | yes | `QuoteCreated` |
| `StartMatchAttempt` | Match | Task action permission | yes | `MatchAttemptStarted` |
| `CreateOfferWave` | Match | active MatchAttempt | yes by wave number | `OfferWaveCreated` |
| `AcceptOffer` | Marketplace | Agent K2 + valid Offer | yes | `OfferAccepted`, `FundingRequested`, `OrderCreated` or `OrderPendingFunding` |
| `DeclineOffer` | Match | Offer recipient | yes | `OfferDeclined` |
| `ExpireOffer` | Match / System | TTL worker | yes | `OfferExpired` |
| `CancelTask` | Demand | Task owner / policy | yes | `TaskCancelled`, affected Offer events |
| `CancelOrder` | Marketplace | party + policy | yes | `OrderCancellationRequested` |
| `RevalidateOrder` | Marketplace | system / authorized operator | yes by revision | `OrderRevalidated` |
| `CreateReplacementOffer` | Match | replacement policy | yes | `ReplacementOfferCreated` |

## 4.3 Execution / Money / Safety Commands

| Command | Owner | 必要授权 | 幂等 | 主要结果 / Event |
|---|---|---|---|---|
| `CreateAvailabilitySession` | Supply | Agent K2 + Consent | yes | `AvailabilitySessionCreated` |
| `RevokeAvailabilitySession` | Supply | Agent / risk | yes | `AvailabilitySessionRevoked` |
| `CheckInOrder` | Execution | assigned Agent + window | yes | `OrderCheckedIn` |
| `SubmitEvidence` | Execution | assigned party + grant | yes | `EvidenceSubmitted` |
| `MarkNoShow` | Safety / Marketplace | policy / case | yes | `NoShowRecorded` |
| `OpenIncident` | Safety | actor / Operator | yes | `IncidentOpened` |
| `CreateSafetyBlock` | Safety | actor / safety decision | yes | `SafetyBlockCreated` |
| `RevokeSafetyBlock` | Safety | actor / authorized review | yes | `SafetyBlockRevoked` |
| `OpenDispute` | Safety / Marketplace | party + window | yes | `DisputeOpened` |
| `ResolveDispute` | Safety / Operator | authorized case permission | yes | `DisputeResolved`、hold update |
| `AuthorizeFunding` | Payment | Requester + Payment method | yes | `FundingSecured` or `FundingFailed` |
| `RequestRefund` | Payment | policy / case | yes | `RefundRequested` |
| `ReleasePayout` | Payment | payout policy + no hold | yes | `PayoutReleased` |
| `CreateManualAdjustmentRequest` | Operator / Finance | dual-control request | yes | `ManualAdjustmentRequested` |
| `ApproveManualAdjustment` | Operator / Finance | second approver | yes | `ManualAdjustmentApproved` |
| `PostManualAdjustment` | Payment | approved request | yes | `LedgerAdjustmentPosted` |
| `CompleteOrder` | Marketplace | execution / evidence rules | yes | `OrderCompleted` |

---

# 5. Domain Event Envelope

## 5.1 Canonical Event

```json
{
  "event_id": "evt_...",
  "event_type": "OfferAccepted",
  "event_version": 1,
  "aggregate_type": "Offer",
  "aggregate_id": "offer_...",
  "aggregate_version": 8,
  "occurred_at": "...",
  "producer_context": "Marketplace",
  "actor_ref": "user_...",
  "principal_ref": "business_...",
  "policy_snapshot": {
    "policy_set_id": "PSET_LAUNCH_V1",
    "policy_set_version": "..."
  },
  "correlation_id": "...",
  "causation_id": "cmd_...",
  "schema_version": 1,
  "data_class": "D1|D2|D3|D4|D5",
  "payload": {}
}
```

## 5.2 Event Rules

```text
event_id immutable
event payload describes a fact, not a future intention
event timestamp comes from domain clock
aggregate_version monotonically increases per aggregate
event schema version is explicit
consumer may replay safely
```

Events must not contain：

```text
raw OTP
access token / refresh token
provider secret
full Government ID
unnecessary precise location
unredacted internal fraud rule
```

## 5.3 P0 Event Families

```text
AccountCreated
ContactVerified
SessionCreated
SessionRevoked
AccountRestricted
AccountSuspended
AccountClosingStarted
AccountClosed
AccountRecoveryRequested
AccountRecoveryCompleted
ConsentRecorded
ConsentWithdrawn
PermissionGranted
PermissionRevoked
KYCVerificationStarted
KYCVerificationCompleted
KYCDocumentDeleted
TaskPublished
TaskSlotsCreated
MatchAttemptStarted
OfferCreated
OfferExpired
OfferAccepted
FundingSecured
FundingFailed
OrderCreated
OrderRevalidated
OrderCheckedIn
EvidenceSubmitted
OrderCompleted
OrderCancelled
NoShowRecorded
IncidentOpened
DisputeOpened
DisputeResolved
PaymentCaptured
RefundRequested
RefundSucceeded
PayoutHeld
PayoutReleased
LedgerAdjustmentPosted
DataExportCreated
DataDeletionCompleted
LegalHoldCreated
LegalHoldReleased
SafetyBlockCreated
SafetyBlockRevoked
BusinessOwnershipTransferred
OperatorSensitiveAccessGranted
OperatorSensitiveAccessExpired
```

Event name 可以因为实现拆分为更细粒度，但不得让同一业务事实存在两个互相竞争的 canonical event。

---

# 6. Aggregate / Concurrency Contract

## 6.1 Aggregate Owner and Version

每个 aggregate 写入必须遵循：

```text
load current version
authorize command
validate transition
apply one atomic mutation
append event(s)
write outbox
increment version
```

如果 `expected_aggregate_version` 不匹配：

```text
return AGGREGATE_VERSION_CONFLICT
do not apply mutation
provide safe reload / retry hint
```

## 6.2 Atomic Slot Lock

`AcceptOffer` 的最小原子范围必须包括：

```text
Offer validity
TaskSlot availability
Agent eligibility
conflict / travel check
Funding decision or pending funding reservation
Order creation precondition
```

不能先在 Match Context 标记 accepted，再异步“希望” Transaction Context 创建唯一 Order。

## 6.3 Money State and Business State

资金状态与交易状态通过明确 event / command 连接：

```text
FundingRequested
→ FundingSecured / FundingFailed
→ OrderCreated or OrderPendingFunding
```

Provider 的 `success` 只在 signature、provider reference、amount、currency、PaymentIntent identity 都校验后才可映射为 `FundingSecured`。

## 6.4 Invariant Check Placement

| 检查 | 必须在 |
|---|---|
| Session / account status | command ingress + aggregate decision |
| Principal / membership | command ingress + owner context |
| Offer TTL | Accept command transaction time |
| Slot lock | same atomic transaction |
| Funding ordering | payment / order boundary |
| KYC / capability | admission + final recheck |
| Risk / SafetyBlock | match、accept、execute 的关键边界 |
| D4 / D5 access | every sensitive read, not only page load |
| Policy version | quote、offer、pricing、retention、permission relevant command |

---

# 7. Read Model Contract

## 7.1 Read Model Envelope

```json
{
  "model_type": "RequesterTaskDetail",
  "model_version": 4,
  "aggregate_refs": ["task_...", "slot_..."],
  "last_event_id": "evt_...",
  "last_aggregate_version": 12,
  "as_of": "...",
  "freshness": "CURRENT|STALE|PENDING_REBUILD",
  "allowed_actions": ["CANCEL_TASK", "VIEW_OFFERS"],
  "redactions": ["PRECISE_LOCATION"],
  "data": {}
}
```

## 7.2 Read Model Safety

Read Model 必须：

```text
derive allowed_actions server-side
include freshness / as_of
include policy explanation where user-facing
redact by principal and data class
never expose raw secrets
never treat a stale accept CTA as authorization
```

## 7.3 P0 Read Models

```text
AccountSecurityOverview
SessionList
ConsentLedgerView
PrivacyDataLifecycleView
RequesterHome
TaskDetail
OfferInbox
AgentAvailabilityOverview
AgentOfferDetail
OrderDetailRequester
OrderDetailAgent
ExecutionChecklist
EvidenceReview
PaymentSummary
PayoutSummary
DisputeCaseView
BusinessWorkspaceOverview
BusinessMemberAccessView
OperatorCaseSummary
OperatorSensitiveAccessHistory
```

同一 aggregate 不同 actor 可使用不同 projection，但不能出现事实冲突。字段差异必须来自 permission / purpose / data classification，而不是前端自行过滤。

## 7.4 Page Contract Mapping

Chapter 21 的 Page Spec 至少映射：

```text
page_id
read_model
query parameters
allowed commands
state / empty / loading / error mapping
permission boundary
deep-link target
```

不存在 read model 的页面不能通过拼接多个不一致 endpoint 自己创造 Domain truth。

---

# 8. Error Contract

## 8.1 Error Envelope

```json
{
  "error_code": "OFFER_EXPIRED",
  "category": "BUSINESS_STATE",
  "retryability": "NO|SAFE_RETRY|AFTER_REAUTH|AFTER_USER_ACTION|ASYNC_PENDING",
  "message_key": "offer.expired",
  "safe_details": {},
  "required_action": "REQUEST_NEW_MATCH",
  "correlation_id": "...",
  "support_case_ref": null
}
```

## 8.2 Canonical Error Categories

| Category | 示例 |
|---|---|
| `AUTHENTICATION` | `OTP_EXPIRED`, `SESSION_REVOKED`, `REAUTH_REQUIRED` |
| `AUTHORIZATION` | `PRINCIPAL_SCOPE_DENIED`, `OPERATOR_IMPERSONATION_FORBIDDEN` |
| `ACCOUNT_STATE` | `ACCOUNT_SUSPENDED`, `ACCOUNT_CLOSED`, `RECOVERY_HOLD` |
| `VALIDATION` | `REQUIRED_FIELD_MISSING`, `POLICY_VALUE_INVALID` |
| `BUSINESS_STATE` | `OFFER_EXPIRED`, `SLOT_UNAVAILABLE`, `ORDER_IMMUTABLE` |
| `ELIGIBILITY` | `KYC_LEVEL_REQUIRED`, `CAPABILITY_REQUIRED`, `RISK_RESTRICTED` |
| `CONSENT_PERMISSION` | `CONSENT_REQUIRED`, `PERMISSION_EXPIRED`, `PURPOSE_MISMATCH` |
| `PAYMENT` | `FUNDING_NOT_SECURED`, `REFUND_AMOUNT_EXCEEDED`, `PAYOUT_ON_HOLD` |
| `CONCURRENCY` | `AGGREGATE_VERSION_CONFLICT`, `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| `PROVIDER` | `PROVIDER_TIMEOUT`, `PROVIDER_SIGNATURE_INVALID`, `RECONCILIATION_REQUIRED` |
| `PRIVACY` | `DATA_RETENTION_HOLD`, `EXPORT_REDACTION_REQUIRED` |
| `INTERNAL` | `RETRYABLE_INTERNAL`, `MANUAL_REVIEW_REQUIRED` |

## 8.3 Error Stability

同一语义错误不能因 transport、locale 或前端页面不同而换成不同 canonical code。`message_key` 可以本地化；`error_code` 不可以。

---

# 9. Idempotency / Outbox / Replay Contract

## 9.1 Idempotency Record

建议独立记录：

```text
IdempotencyRecord
├── idempotency_key
├── actor_id
├── principal_id
├── command_type
├── request_hash
├── first_command_id
├── outcome
├── response_snapshot_ref
├── created_at
├── expires_at
└── status
```

同一 key + 不同 actor / principal / payload 必须拒绝，不得只按字符串 key 全局复用。

## 9.2 Outbox Record

```text
OutboxMessage
├── outbox_id
├── event_id
├── aggregate_type
├── aggregate_id
├── aggregate_version
├── payload_ref
├── status: PENDING / SENT / FAILED / DEAD_LETTER
├── attempt_count
├── next_attempt_at
├── last_error_code
└── created_at
```

Outbox 与本地 aggregate mutation 必须在同一 atomic boundary 内提交。

## 9.3 Consumer Inbox / Dedupe

每个有副作用的 consumer 至少保存：

```text
consumer_name
event_id
aggregate_version
processing_status
processed_at
side_effect_ref
```

重复 delivery 应返回已处理结果或安全跳过；不能依赖消息队列“恰好一次”。

---

# 10. Provider Adapter Contract

## 10.1 Provider Isolation

Provider 只能通过 Adapter / Gateway 进入系统：

```text
Domain Command
→ Provider Adapter request
→ signed / authenticated provider call
→ normalized callback / polling result
→ local validation
→ Domain event / state transition
```

Domain Context 不得读取 provider SDK object 作为自己的状态枚举。

## 10.2 Common Adapter Envelope

```json
{
  "adapter_request_id": "adp_...",
  "provider": "...",
  "operation": "AUTHORIZE_FUNDING",
  "provider_account_ref": "masked_ref",
  "correlation_id": "...",
  "idempotency_key": "...",
  "requested_at": "...",
  "safe_payload": {}
}
```

Adapter 必须返回 normalized result：

```text
provider_reference
normalized_status
amount / currency where relevant
provider_event_id
failure_category
retryability
received_at
raw_payload_ref restricted
```

## 10.3 Payment Adapter

必须校验：

```text
signature / authenticity
provider event id
PaymentIntent identity
amount
currency
merchant / account scope
idempotency
```

禁止直接把 provider `SUCCESS` 映射成平台 `FundingSecured`，除非本地校验全部通过。

## 10.4 KYC Adapter

平台保留：

```text
provider_ref
attempt_ref
decision
verification_level
reason_code where permitted
timestamps
retention metadata
```

raw document / biometric 仅在受控存储边界内存在，不能进入普通 event、read model、日志或 error。

## 10.5 Map / Location Adapter

Adapter 可以返回：

```text
approx_distance
travel_duration
geocode reference
zone match
```

精确坐标进入 D4 purpose-bound storage；不能因 Map provider 返回完整坐标就扩大产品可见范围。

## 10.6 Media / Evidence Adapter

必须支持：

```text
content integrity reference
upload idempotency
virus / safety scan result
retention class
deletion eligibility
restricted raw storage reference
```

失败的 upload 不能生成已提交 Evidence。

---

# 11. Schema Versioning / Migration

## 11.1 Version Rules

每个 Command、Event、Read Model、Provider normalized result 都有 schema version。

```text
additive optional field = compatible minor change
new enum value = consumer review required
rename / remove field = breaking major change
semantic meaning change = new field or new version
```

不得只改字段名而保留旧 schema version。

## 11.2 Consumer Compatibility

Producer 必须在迁移窗口内支持：

```text
old consumer + new producer
new consumer + old event replay
duplicate event
unknown optional field
missing optional field
```

Consumer 必须对未知字段向前兼容，但对未知高风险 enum 默认拒绝并报警。

## 11.3 Enum Evolution

`UserAccount.status`、Offer、Order、Payment、Consent、Deletion、Session 等状态新增值时，必须：

```text
update Canonical Registry
update state transition matrix
update E2E / negative cases
define UI mapping
define migration / backfill
define monitoring
```

不能在 provider adapter 或页面层私自增加状态。

## 11.4 Migration Contract

迁移必须提供：

```text
source definition
target definition
mapping table
unknown / unmapped behavior
backfill idempotency
dual-read / dual-write window
rollback or forward-fix strategy
audit / metric
```

---

# 12. Security / Privacy Contract at API Boundary

## 12.1 Authorization Context

服务端每个 command / sensitive query 都要计算：

```text
actor identity
UserAccount status
principal membership
resource ownership
KYC / capability level
Risk / Restriction
Consent
PermissionGrant
OperatorAccessGrant
purpose
TTL / freshness
```

任一条件缺失时按 deny by default。

## 12.2 Field-level Redaction

同一 object 的不同 read model 可有不同字段，但 redaction 必须在服务端完成：

```text
raw KYC → never ordinary API
precise location → D4 grant only
payout identity → masked reference
other actor contact → TemporaryContactGrant
internal risk → safe reason category
operator secret → never
```

## 12.3 Sensitive Audit

每次 D4 / D5 read 或 write 记录：

```text
actor
team
purpose
reason_code
object
data_class
fields / action
grant / consent ref
policy version
timestamp
outcome
```

日志本身也不能复制 raw secret。

---

# 13. Observability / SLO Hooks

## 13.1 Required Metrics

```text
command_accept_rate by command_type
command_reject_rate by error_code
idempotency_replay_count
aggregate_version_conflict_count
outbox_lag / dead_letter_count
event_replay_count
read_model_staleness
funding_to_order latency
duplicate_provider_callback_count
reconciliation_mismatch_count
sensitive_access_grant_count
sensitive_access_denied_count
retention_delete_success / failure
legal_hold_delete_block_count
operator_impersonation_attempt_count
```

## 13.2 Correlation

必须能从任一用户可见 operation ref 追踪：

```text
page action
command_id
aggregate_id / version
event_id
outbox_id
provider adapter request
provider event
read model projection
audit record
```

## 13.3 Alerting Blockers

以下必须产生阻塞级告警或 Case：

```text
duplicate money side effect
slot oversell attempt
signature-invalid provider event
raw secret serialization attempt
cross-principal access success
LegalHold deletion attempt
expired operator grant success
outbox dead letter for money / safety event
```

---

# 14. Contract Test Matrix

## 14.1 Consumer-driven Contract

每个 Context 必须为其 producer / consumer 提供 contract tests：

| Contract | 必测 |
|---|---|
| Identity → all | account state、principal、session、reauth context |
| Demand → Match | Task / Slot、material change、policy snapshot |
| Match → Marketplace | Offer TTL、candidate eligibility、accept race |
| Marketplace → Payment | funding ordering、amount、currency、idempotency |
| Marketplace → Execution | Order state、check-in window、evidence requirement |
| Safety → all | Risk / Block / Hold decision propagation |
| Privacy → all | consent、permission、redaction、retention |
| Payment → Operator | payout / refund / adjustment / reconcile case |
| Event bus → projectors | event schema、version、replay、dedupe |
| Provider adapter → domain | normalized state、signature、timeout、reconcile |

## 14.2 Contract Failure Handling

当 consumer 不接受新 schema：

```text
producer 不直接删除旧字段
进入 compatibility window
记录 consumer version
阻止 breaking rollout
提供 migration owner / deadline
```

---

# 15. Acceptance Criteria

## AC-26-01 Context Ownership

每个 Canonical object 有唯一写入 owner；其他 Context 不直接写 owner 数据表。

## AC-26-02 Command Envelope

所有 P0 write command 带 actor、principal、target、idempotency、policy、auth、correlation context。

## AC-26-03 Command Result

同步结果能区分 `ACCEPTED`、`REJECTED`、`PENDING`、`ALREADY_APPLIED`，不会把异步 Provider 结果伪装成完成。

## AC-26-04 Policy Snapshot

会影响价格、TTL、资格、权限、保留期的 command 携带并保存 PolicySet snapshot。

## AC-26-05 Aggregate Version

并发敏感 command 使用 aggregate version / conditional check；冲突不产生 mutation。

## AC-26-06 Slot Atomicity Boundary

Accept Offer 在原子范围内完成 Offer validity、Slot lock、eligibility、funding precondition 和 Order precondition。

## AC-26-07 Event Envelope

P0 Domain Event 具备 event id、aggregate、version、schema、time、causation、correlation 和 policy references。

## AC-26-08 Event Is Fact

Event 不表达未发生的成功；Provider callback 只有在本地校验后才能转为 Domain fact。

## AC-26-09 Event Dedupe

Consumer 对重复 event 安全去重；重复消息不重复产生资金、通知、删除或安全副作用。

## AC-26-10 Read Model Freshness

P0 read model 明确 `CURRENT / STALE / PENDING_REBUILD`，stale 数据不能授权写操作。

## AC-26-11 Server-side Actions

allowed_actions、redaction 和 principal scope 在服务端计算；前端不能自行获得隐藏权限。

## AC-26-12 Error Stability

同一语义错误使用稳定 canonical error code；message 可以本地化但 code 不随页面改变。

## AC-26-13 Idempotency Payload

相同 key + 相同 canonical payload 返回原 operation；相同 key + 不同 payload / actor / principal 被拒绝。

## AC-26-14 Outbox Atomicity

Aggregate mutation 与 Outbox message 同一 atomic boundary 提交；crash 后可 replay。

## AC-26-15 Consumer Inbox

有副作用的 consumer 记录 event processing status，并能安全处理 duplicate / retry。

## AC-26-16 Provider Isolation

Domain 不直接依赖 Provider SDK state；所有 Provider callback 经 Adapter normalized result 和本地校验。

## AC-26-17 Payment Verification

Payment callback 校验 signature、event id、intent、amount、currency、account scope 后才可产生 FundingSecured。

## AC-26-18 KYC Raw Boundary

KYC raw document / biometric 不进入普通 event、read model、error、日志或 Command response。

## AC-26-19 Location Boundary

Map / Location adapter 不会因返回精确坐标而自动扩大 D4 可见范围；location scope 仍由 Order / Purpose / TTL 决定。

## AC-26-20 Media Integrity

失败或未扫描的上传不能变成已提交 Evidence；重复 upload 不产生重复 Evidence。

## AC-26-21 Schema Version

Command、Event、Read Model、Provider normalized result 都带 schema version；breaking change 必须升级版本并经过 contract review。

## AC-26-22 Enum Governance

新增 Canonical enum value 必须同步 Registry、状态转换、E2E、UI mapping、迁移和监控。

## AC-26-23 Migration Safety

迁移有 mapping、unknown handling、idempotent backfill、compatibility window 和 rollback / forward-fix 策略。

## AC-26-24 Privacy at Boundary

每个 sensitive query / command 在 API boundary 检查 Account、Principal、Consent、Permission、Purpose、TTL、Operator grant。

## AC-26-25 Sensitive Audit

D4 / D5 read / write 记录 actor、reason、object、fields、grant、policy、timestamp、outcome，且不复制 secrets。

## AC-26-26 Secret Exclusion

任何 P0 envelope、event、read model、error、log 都不包含 OTP、token、provider secret、完整 Government ID 或未加密 bank credential。

## AC-26-27 Correlation Trace

用户可见 operation ref 可以追到 command、aggregate、event、outbox、provider、projection 和 audit。

## AC-26-28 Provider Timeout

Provider timeout 不会自动产生成功事实；本地状态进入可恢复 pending / unknown / reconcile 路径。

## AC-26-29 Reconciliation

Provider 与本地事实不一致时创建 reconcile case / hold；不静默修正 Ledger 或 Order。

## AC-26-30 Cross-context Failure

跨 Context 失败可通过 retry、compensating command、outbox replay 或 manual case 恢复，且原始事实不被覆盖。

## AC-26-31 Contract Test Coverage

每个 P0 Context pair 都有 consumer-driven contract，覆盖 success、reject、duplicate、unknown optional field、version mismatch。

## AC-26-32 Security Alert Hooks

越权成功、过期 JIT 成功、LegalHold 删除、duplicate money effect、raw secret serialization 都能产生告警 / Case。

## AC-26-33 Chapter 25 Traceability

每个 Chapter 25 P0 E2E case 能映射到至少一个 command、event、read model 和 error / idempotency contract。

## AC-26-34 Backward Compatibility

兼容窗口内支持旧 consumer + 新 producer、旧 event replay + 新 consumer，以及未知 optional field。

## AC-26-35 No Direct Table Writes

服务、脚本、后台 job、Operator 工具都不能绕过 owned command 直接修改其他 Context 的 canonical state。

## AC-26-36 Implementation Readiness

Engineering 能根据本章生成 endpoint / RPC、schema、event topic、consumer、error、migration 和 observability 清单，不需重新发明 Domain 语义。

---

# 16. Locked Conclusions / Next Work

本章锁定：

```text
Command 是唯一业务写入入口
Event 是不可变事实，不是 UI 通知文案
Read Model 只负责投影和安全 CTA，不是授权真相
Aggregate version + idempotency 共同处理并发与重试
Provider 只能通过 Adapter 进入 Domain
Schema / enum / migration 受 Canonical Registry 管理
敏感数据在 API、Event、Read Model、Error、Log 五个边界均遵循最小化
```

下一步进入：

```text
Provider Integration Contract + Market Launch Readiness
```

优先收口：

```text
Payment provider state mapping
KYC provider state mapping
Map / location provider boundary
Media / evidence provider boundary
Notification delivery fallback
Market-specific Legal / Tax / KYC override
Pilot runbook / rollback / incident drill
```

