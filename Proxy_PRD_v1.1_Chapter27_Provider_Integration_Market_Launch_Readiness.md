# Proxy PRD v1.1
## Chapter 27 — Provider Integration Contract / Market Launch Readiness

**文档类型**：Provider Integration / Market Configuration / Pilot Readiness / Go-No-Go Contract  
**状态**：ACTIVE — Provider & Launch Readiness v1  
**前置依赖**：Canonical Registry、Chapter 09–18、Chapter 20–26、`PSET_LAUNCH_V1`  
**后续依赖**：Chapter 28 Pilot Runbook / Launch Operations / Incident Drill、Implementation Design、首发市场 Legal / Tax / KYC Approval

---

# 0. 本章目标

本章把 Chapter 26 的 Provider Adapter 原则具体化，并将“可以实现”推进到“可以在一个市场安全上线”：

```
Payment Provider
KYC / Identity Provider
Map / Geocoding / Routing Provider
Media / Evidence Storage / Scan Provider
Notification Provider
Provider credential / webhook / reconciliation
Market legal / tax / KYC / currency configuration
Pilot scope / rollback / incident drill
Launch Go / No-Go
```

本章不选择某一家供应商，也不把供应商状态直接变成 Proxy 的 Domain 状态。供应商可替换，但以下内容必须稳定：

```
normalized state
provider reference boundary
idempotency
callback authenticity
reconciliation
failure handling
data retention
market approval
rollback behavior
```

---

# 1. Provider Integration Constitution

## 1.1 Domain First, Provider Second

```
Proxy Domain Command
→ Adapter Request
→ Provider Operation
→ Normalized Result
→ Local Validation
→ Domain Transition / Pending / Reconcile Case
```

Provider 的以下内容不能直接成为 Proxy canonical truth：

```
provider status string
provider user id
provider order id
provider amount formatting
provider retry recommendation
provider webhook arrival order
provider SDK exception type
```

每个 Provider 必须映射到 Proxy 自己的：

```
provider_account_ref
provider_operation_ref
normalized_status
failure_category
retryability
reconciliation_state
```

## 1.2 One Adapter, One Responsibility

每个 Adapter 只负责一种外部能力和明确的账户边界：

```
PaymentAdapter
KYCAdapter
GeoAdapter
MediaAdapter
NotificationAdapter
```

不要把 Payment、KYC、Map、Media 和 Notification SDK 封装进一个 `ProviderService`，否则无法隔离权限、数据分类和回滚风险。

## 1.3 Secrets Never Cross Domain Boundary

Provider secret、access token、refresh token、签名私钥、原始凭证只能存在于：

```
Secret Manager
Adapter Runtime
Provider Connection Config
```

不得进入 Domain Event、Read Model、User-facing Error、普通 Operator 查询、Analytics raw event 或 E2E fixture。

## 1.4 Market Is Configuration, Not a Fork

市场差异进入版本化 `MarketLaunchProfile` 和 `PolicySet`：

```
market_id
currency
payment rails
tax rule reference
KYC coverage
payout rule
legal retention
consent copy / version
data residency
provider routing
```

不得为某个市场复制一套 Domain 状态机或在代码中散落 market-specific 业务例外。

---

# 2. Provider Registry / Connection Model

## 2.1 ProviderConnection

```
ProviderConnection
├── connection_id
├── provider_type: PAYMENT / KYC / GEO / MEDIA / NOTIFICATION
├── provider_name
├── market_id optional
├── environment: SANDBOX / STAGING / PRODUCTION
├── capability_set[]
├── credential_ref
├── webhook_endpoint_ref optional
├── status: DRAFT / ACTIVE / DEGRADED / DISABLED / RETIRED
├── priority
├── effective_at
├── expires_at optional
├── approved_by
├── last_health_check_at
└── config_version
```

## 2.2 ProviderCapability

Provider 能力必须显式登记：

```
Payment: AUTHORIZE, CAPTURE, REFUND, PAYOUT, WEBHOOK
KYC: DOCUMENT, SELFIE, LIVENESS, CALLBACK, MANUAL_REVIEW
Geo: GEOCODE, REVERSE_GEOCODE, ROUTE, ETA, ZONE_MATCH
Media: UPLOAD, VIRUS_SCAN, CONTENT_SCAN, THUMBNAIL, DELETE
Notification: OTP, PUSH, SMS, EMAIL, IN_APP, DELIVERY_STATUS
```

缺少能力时必须：

```
disable dependent P0 path
show explicit unavailable state
create launch blocker / operator case
```

不能用空响应、默认成功或假 Provider 结果掩盖缺失能力。

## 2.3 Provider Routing

Provider routing 按以下顺序决定：

```
market approval
capability support
data residency / legal constraint
currency / payment rail support
health status
priority
cost / rate-limit policy
```

Provider priority 不能越过 Legal、KYC、Payment rail 或 Data Classification 约束。

## 2.4 Provider Lifecycle

```
DRAFT
ACTIVE
DEGRADED
DISABLED
RETIRED
```

```
ACTIVE → DEGRADED
ACTIVE → DISABLED
DEGRADED → ACTIVE
DEGRADED → DISABLED
DISABLED → ACTIVE only after approval / health check
ACTIVE → RETIRED only after traffic drain and reconciliation
```

Provider 状态变化不得改写既有 Payment、KYC、Order、Evidence 历史事实，只影响新请求路由和恢复动作。

---

# 3. Common Adapter Contract

## 3.1 Request Envelope

```
{
  "adapter_request_id": "adp_...",
  "connection_id": "pc_...",
  "provider_type": "PAYMENT",
  "operation": "AUTHORIZE_FUNDING",
  "environment": "SANDBOX",
  "domain_object": {"type": "PaymentIntent", "id": "pi_..."},
  "idempotency_key": "...",
  "correlation_id": "...",
  "purpose": "PAYMENT",
  "requested_at": "...",
  "safe_payload": {}
}
```

Adapter request 必须带 Domain object reference，但不把全部 Domain object 序列化给 Provider。

## 3.2 Normalized Result

```
{
  "adapter_request_id": "adp_...",
  "provider_reference": "masked-or-scoped-ref",
  "provider_operation_ref": "...",
  "provider_event_id": "...",
  "normalized_status": "PENDING",
  "failure_category": null,
  "retryability": "ASYNC_RETRY",
  "amount": 100000,
  "currency": "VND",
  "received_at": "...",
  "raw_payload_ref": "restricted://...",
  "signature_verified": true,
  "schema_version": 1
}
```

`raw_payload_ref` 只能指向受限存储，不能放 raw payload 本身。

## 3.3 Failure / Retryability

统一失败分类：

```
AUTHENTICATION_FAILED
SIGNATURE_INVALID
INVALID_REQUEST
UNSUPPORTED_CAPABILITY
RATE_LIMITED
TEMPORARY_UNAVAILABLE
TIMEOUT_UNKNOWN_RESULT
PROVIDER_DECLINED
COMPLIANCE_REJECTED
DATA_MISMATCH
DUPLICATE_OPERATION
RECONCILIATION_REQUIRED
PERMANENT_CONFIGURATION_ERROR
```

| Failure | 默认处理 |
|---|---|
| `TEMPORARY_UNAVAILABLE` | 指数退避 + 次数上限 + 同一 idempotency |
| `RATE_LIMITED` | 尊重 Retry-After / quota，不立即放大请求 |
| `TIMEOUT_UNKNOWN_RESULT` | 查询 / reconcile，不盲目重复写操作 |
| `SIGNATURE_INVALID` | 永不重试业务 mutation，告警并拒绝 |
| `DATA_MISMATCH` | 转人工 / reconcile，不能自动覆盖本地事实 |
| `COMPLIANCE_REJECTED` | 返回安全 reason，允许规定的 correction path |
| `PERMANENT_CONFIGURATION_ERROR` | 阻塞该能力，创建 Launch / Operator blocker |

## 3.4 Callback Contract

每个 Callback 必须经过：

```
endpoint authentication
signature verification
timestamp / replay window check
provider event dedupe
connection / merchant scope check
object reference check
amount / currency check where relevant
normalized state mapping
aggregate transition validation
```

验证失败时：

```
不写 Domain state
不发送成功通知
记录安全事件
保留受限 raw payload reference
必要时创建 ReconciliationCase
```

---

# 4. Payment Provider Contract

## 4.1 Payment Scope

P0 Payment Provider 支持：

```
payment method tokenization / reference
funding authorization
capture or confirmed charge
refund
payout
provider webhook
reconciliation
```

Proxy 只保存 masked reference 和必要的 Payment / Ledger facts，不保存完整卡号、CVV、bank credential 或 provider secret。

## 4.2 Payment Objects

```
PaymentMethodReference
PaymentIntent
FundingHold
Refund
Payout
ProviderPaymentOperation
PaymentReconciliationCase
```

## 4.3 Normalized Payment Status

### PaymentIntent

```
CREATED
REQUIRES_ACTION
AUTHORIZED
CAPTURED
FAILED
CANCELLED
UNKNOWN
```

### FundingHold

```
REQUESTED
PENDING
SECURED
FAILED
RELEASED
EXPIRED
RECONCILIATION_REQUIRED
```

### Refund / Payout

```
Refund: REQUESTED / PENDING / SUCCEEDED / FAILED / UNKNOWN / RECONCILIATION_REQUIRED
Payout: ELIGIBLE / HELD / REQUESTED / PROCESSING / PAID / FAILED / UNKNOWN / RECONCILIATION_REQUIRED
```

## 4.4 Funding Ordering

```
Task committed
→ PaymentIntent created
→ Funding authorization
→ local signature / amount / currency validation
→ FundingHold SECURED
→ Order CREATED / executable
```

以下情况不得创建 paid executable Order：

```
amount mismatches
currency mismatches
merchant account mismatches
webhook signature invalid
provider result cannot be correlated to PaymentIntent
timeout with unknown outcome
FundingHold is only PENDING
```

## 4.5 Refund / Payout

Refund command 必须带：

```
order_id
payment_intent_id
requested_amount
currency
reason_code
actor / principal
policy_snapshot
idempotency_key
```

Provider 退款成功后才产生 `RefundSucceeded`；本地请求成功只代表 `RefundRequested` 或 `PENDING`。

Payout 在以下全部满足后才允许请求：

```
Order completed or policy-approved payable outcome
dispute window / hold check passed
PayoutIdentity valid
market payout rail active
tax / legal fields complete where required
24h default payout delay passed unless approved override
```

Provider `PAID` 不能覆盖本地 `HELD` / `RECONCILIATION_REQUIRED`，必须由 authorized reconciliation command 处理。

## 4.6 Payment Reconciliation

每日或按市场要求执行：

```
provider operation list
local PaymentIntent list
FundingHold list
Refund list
Payout list
Ledger entries
```

检查：

```
missing provider operation
missing local operation
amount / currency mismatch
duplicate provider event
stuck PENDING / UNKNOWN
provider PAID with local FAILED
local PAID with no provider proof
```

不一致进入 `PaymentReconciliationCase`，并根据风险自动 Hold payout / refund / new funding。

---

# 5. KYC / Identity Provider Contract

## 5.1 KYC Scope and Objects

P0 支持：

```
identity verification
document upload reference
selfie / liveness where required by market
provider callback or polling
manual review handoff
document deletion / retention signal
```

对象：

```
KYCProfile
IdentityVerificationAttempt
KYCDocument
PayoutIdentity
KYCProviderOperation
KYCReviewCase
```

## 5.2 Normalized KYC Status

```
CREATED
STARTED
SUBMITTED
PROCESSING
VERIFIED
REJECTED
EXPIRED
CANCELLED
REVIEW_REQUIRED
UNKNOWN
```

Provider `approved` 只有在结果与 `attempt_id`、user scope、provider account、market、document scope 绑定后才可映射为 `VERIFIED`。

## 5.3 Failure / Downtime

用户可见：

```
reason category
correction action
resubmission eligibility
next review point
```

用户不可见：

```
biometric threshold
fraud detection rule
provider internal score
other identity data
raw reviewer notes unless legally required
```

Provider unavailable 时：

```
new attempt → PROCESSING / PROVIDER_UNAVAILABLE
existing VERIFIED profile → retain until expiry / market rule
KYC-dependent action → deny or pending according to policy
raw document → follow retention, not indefinite preservation
```

不能把 Provider timeout 映射为 `REJECTED` 或 `VERIFIED`。

## 5.4 MarketKYCRequirement

```
MarketKYCRequirement
├── market_id
├── required_level: K0 / K1 / K2
├── accepted_document_types[]
├── provider_connection_id
├── manual_review_required
├── expiry_rule
├── retention_override_ref
├── legal_basis_ref
└── approved_version
```

没有 `legal_basis_ref` 和 approved version 的 KYC override 不能上线。

---

# 6. Map / Geocoding / Routing Provider Contract

## 6.1 Geo Scope and Objects

P0 支持：

```
geocode user-entered location
reverse geocode where allowed
approx distance
travel duration
zone / radius match
route estimate for travel buffer
```

对象：

```
LocationReference
GeoZone
LocationVisibilityGrant
GeoProviderOperation
RouteEstimate
```

第三方 place id 或 route id 只能作为 `provider_reference`，不能替代 `LocationReference.location_id`。

## 6.2 Normalized Geo Result

```
GEOCODED
APPROX_DISTANCE_READY
ROUTE_READY
ZONE_MATCHED
PARTIAL
NOT_FOUND
AMBIGUOUS
PROVIDER_UNAVAILABLE
```

## 6.3 Location Privacy / Failure

Provider 请求必须最小化：

```
use approximate location where sufficient
do not send home address when zone is sufficient
strip unrelated user metadata
bind precise request to Order / Purpose / TTL
retain raw response under D4 rule
```

Provider 返回完整坐标不代表 Proxy 可以展示、永久存储或扩大可见范围。

```
geocode ambiguous → ask user to confirm
route unavailable → safe fallback / manual review, not invented ETA
distance unavailable → do not claim travel compatibility
stale route → include calculated_at and freshness
```

过期 RouteEstimate 只能显示 stale / unavailable，不能作为精确 check-in 或 Offer eligibility 的唯一依据。

---

# 7. Media / Evidence Provider Contract

## 7.1 Media Scope and Objects

P0 支持：

```
scoped upload
content hash / integrity reference
virus / malware scan
content safety scan where required
thumbnail / preview derivative
retention and deletion
restricted raw download
```

对象：

```
MediaAsset
Evidence
MediaScanResult
MediaDeletionRequest
MediaProviderOperation
```

## 7.2 Normalized Media Status

```
UPLOAD_CREATED
UPLOADING
UPLOADED
SCANNING
SAFE
REJECTED
EXPIRED
DELETED
UNKNOWN
```

只有 `SAFE` 或市场明确允许的 `SCAN_PENDING` 路径，才能进入 Evidence 可见 / 完成判定。未扫描文件不得作为安全完成证据。

## 7.3 Upload / Deletion

每次 upload 必须校验：

```
asset owner / Order scope
content hash
content length
allowed MIME / extension
upload idempotency
scan result
retention class
```

删除时必须保留：

```
evidence_id
content hash / integrity reference where required
deletion event
legal hold reference if applicable
```

不能在用户删除媒体后伪造为“从未提交”。

---

# 8. Notification Provider Contract

## 8.1 Notification Scope and Objects

P0 支持：

```
OTP delivery
Offer / Order notification
Safety / security alert
Payment / payout notification
Consent / data lifecycle notification
delivery status
fallback channel
```

对象：

```
NotificationEvent
NotificationDelivery
InboxItem
DeliveryAttempt
NotificationPreference
```

优先级：

```
SECURITY / SAFETY
PAYMENT / ACCOUNT
ORDER / OFFER
GENERAL PRODUCT
MARKETING
```

## 8.2 Delivery / Fallback

Normalized status：

```
CREATED
QUEUED
SENT
DELIVERED
FAILED
BOUNCED
SUPPRESSED
EXPIRED
UNKNOWN
```

Provider `DELIVERED` 只代表渠道反馈成功，不代表用户已阅读或 Domain action 已完成。

```
primary channel failed
→ retry within policy limit
→ fallback if consent + verified + allowed
→ in-app Inbox
→ Operator / Safety case for critical undelivered alert
```

Fallback 不得绕过 marketing consent、quiet hours、verified-channel requirement 或 data minimization。

OTP 特别规则：

```
OTP value never logged
delivery failure ≠ verification success
new challenge invalidates old challenge when policy requires
retry stays within attempt / rate limit
```

---

# 9. Webhook / Polling / Reconciliation

## 9.1 Webhook Registry

```
ProviderWebhookEndpoint
├── endpoint_id
├── provider_connection_id
├── event_family
├── signature_scheme
├── key_version
├── replay_window
├── enabled
├── last_received_at
├── last_verified_at
└── failure_count
```

## 9.2 Processing States

```
RECEIVED
AUTHENTICATED
DEDUPED
NORMALIZED
APPLIED
IGNORED_STALE
REJECTED
RECONCILIATION_REQUIRED
```

## 9.3 Polling

Polling 只能用于：

```
provider has no reliable webhook
webhook delivery gap
UNKNOWN / PENDING recovery
reconciliation
```

必须使用 bounded retry window、同一 operation reference、backoff 和 last-seen provider state；每次轮询不能产生新的 Domain event。

## 9.4 ReconciliationCase

```
ReconciliationCase
├── case_id
├── provider_type
├── connection_id
├── market_id
├── domain_object_type
├── domain_object_id
├── provider_reference
├── mismatch_type
├── local_state
├── provider_state
├── monetary_delta optional
├── risk_level
├── status: OPEN / INVESTIGATING / RESOLVED / ESCALATED
├── owner_team
├── hold_ref optional
├── created_at
└── resolved_at optional
```

Payment、Payout、KYC、安全 mismatch 默认至少为 P0 review，不得被普通 retry worker 自动关闭。

---

# 10. Failover / Cutover

## 10.1 Failover Modes

```
NO_FAILOVER
SAFE_READ_FAILOVER
NEW_OPERATION_FAILOVER
MANUAL_ONLY
```

| Provider | 默认 P0 模式 |
|---|---|
| Payment authorization | `MANUAL_ONLY` 或批准的 `NEW_OPERATION_FAILOVER` |
| Refund | `MANUAL_ONLY`，除非结果已安全确认 |
| Payout | `MANUAL_ONLY` |
| KYC | 现有 VERIFIED 可 `SAFE_READ_FAILOVER`；新验证 pending / manual |
| Geo | `SAFE_READ_FAILOVER` 到 approximate / manual zone |
| Media | 只有完整性与 retention 等价时允许新操作 failover |
| Notification | 可 failover，但必须保持 dedupe 和 consent |

## 10.2 Payment Failover

未知结果的 Payment authorization 不能直接切 Provider 再次扣款。必须：

```
query original provider
reconcile PaymentIntent
decide void / release / confirmed failure
record operation relationship
```

## 10.3 KYC Failover

不得自动把未完成 verification 迁移为 Verified。可以保留当前等级至 expiry、把新 attempt 路由到已批准 Provider 或转 manual review，并保留 attempt lineage。

## 10.4 Cutover / Drain

切换前必须完成 contract、sandbox、signature、idempotency、reconcile dry run、traffic plan、rollback、support training 和必要审批。

旧 Provider 进入 retiring 后：

```
stop new operations
continue callbacks / polling for in-flight operations
finish reconciliation
preserve references and audit
RETIRE only after no unresolved P0 case
```

---

# 11. MarketLaunchProfile

## 11.1 Schema

```
MarketLaunchProfile
├── market_id
├── market_name
├── locale
├── timezone
├── supported_currencies[]
├── default_currency
├── payment_rail_refs[]
├── payout_rail_refs[]
├── fee_schedule_ref
├── tax_rule_ref
├── KYC_requirement_ref
├── age_requirement_ref
├── consent_document_refs[]
├── privacy_notice_ref
├── retention_override_ref
├── data_residency_rule_ref
├── provider_connection_refs[]
├── support_hours_ref
├── quiet_hours_ref
├── launch_scope_ref
├── status: DRAFT / REVIEW / APPROVED / ACTIVE / PAUSED / RETIRED
├── version
├── approved_by[]
├── approved_at
└── effective_at
```

## 11.2 Market Status / Required Decisions

```
DRAFT → REVIEW → APPROVED → ACTIVE
ACTIVE → PAUSED
PAUSED → ACTIVE after blocker cleared
ACTIVE → RETIRED after traffic / payout / data closeout
```

`APPROVED` 不等于 `ACTIVE`。Provider、Legal、Support、Pilot 和 Monitoring 均完成后才可激活。

首发市场必须明确：

```
currency and minor unit
payment authorization / capture semantics
refund and payout rails
fee / tax ownership and display
KYC required level and document types
minimum age
data retention and deletion exceptions
data residency / cross-border transfer
consent wording and versions
support language and hours
emergency / safety escalation
provider outage behavior
```

任何未决项目进入 `MARKET_LAUNCH_BLOCKER`，不能由工程默认猜测。

## 11.3 Policy Binding

MarketLaunchProfile 绑定：

```
policy_set_id = PSET_LAUNCH_V1
policy_set_version
market_override_version optional
```

Override 必须有业务原因、owner、legal / finance / risk approval、effective / review date、测试和回滚值。

---

# 12. Legal / Tax / KYC Readiness

## 12.1 Approval Matrix

| 领域 | 负责人 | 必须确认 | 阻塞项 |
|---|---|---|---|
| Legal | Legal owner | Terms、privacy、责任边界、数据转移 | 未批准文案或责任边界 |
| Tax / Finance | Finance owner | currency、fee、tax、invoice、payout | 金额或税务无法解释 |
| KYC / AML | Risk / Compliance | K0/K1/K2、document、manual review、retention | 身份要求未映射 |
| Payment | Payments owner | rail、authorization、refund、payout、reconcile | 资金链路未闭环 |
| Privacy | Privacy owner | Consent、D0–D5、LegalHold、deletion/export | raw sensitive boundary 未批准 |
| Safety | Safety owner | emergency、block、incident、support SLA | 高风险场景无处理路径 |
| Support | Operations owner | language、hours、case routing、fallback | 无人工接管路径 |
| Product | Product owner | launch scope、template、CTA、metric | 页面与 Policy 不一致 |
| Engineering | Tech owner | schema、observability、rollback、load | 无法回滚或不可追踪 |

## 12.2 Retention / Tax / Currency

市场法律要求更长保留时，新增版本化 `RetentionOverride`，标注 legal basis、访问范围、review date，并更新 deletion / export tests；不能永久保留全部 UserAccount。

金额配置必须固定：

```
currency
minor_unit
rounding_mode
display_precision
tax_inclusive / tax_exclusive
fee owner
refund tax behavior
payout statement fields
```

如果 Payment Provider 不支持 MarketLaunchProfile 的 currency，市场不能 `APPROVED`。

---

# 13. Pilot Scope / Guardrails

## 13.1 Pilot Guardrails

```
one approved market
one timezone / locale
PSET_LAUNCH_V1 only
limited scenario families and role templates
limited provider connections
manual review for P0 risk / payout exceptions
operator on-call
daily reconciliation
```

## 13.2 Pilot Cohort

```text
PilotCohort
├── pilot_cohort_id
├── market_id
├── included_user_ids / business_ids
├── excluded_scope
├── start_at
├── end_at
├── support_channel
└── consent_disclosure_version
```

```
pilot_cohort_id
included_user_ids / business_ids
excluded market / user groups
start_at
end_at
support channel
consent / disclosure version
```

不能用隐藏 Feature Flag 把真实用户无审计地混入 Pilot。

## 13.3 Volume / Success Metrics

Pilot 必须设定每日上限：

```
new Users
new Tasks
Orders
payment volume
payout volume
active Agents
notification volume
KYC attempts
Operator manual adjustments
```

达到阈值时停止 admission 或减速 ramp，保持已有 Order 安全，并通知 on-call。

成功指标至少包括：

```
Task publish / Offer acceptance
funding-to-order conversion
atomic slot conflict
no-show / cancellation
refund / dispute
payout success / age
KYC completion / manual review
notification delivery
provider timeout / reconcile
support first response
safety incident
privacy access violation = 0
duplicate money effect = 0
```

---

# 14. Go / No-Go Gate

## 14.1 Go

全部满足才允许激活：

```
MarketLaunchProfile = APPROVED
required ProviderConnection = ACTIVE
payment authorization / refund / payout reconcile dry run passed
KYC sandbox and manual-review path passed
Geo privacy / stale route / fallback tests passed
Media scan / deletion / retention tests passed
Notification OTP / safety / fallback tests passed
Chapter 25 P0 tests passed
Chapter 26 contract tests passed
Legal / Tax / Privacy / KYC / Safety sign-offs recorded
support runbook and on-call staffed
rollback target verified
monitoring and alerting live
pilot volume guardrails configured
```

## 14.2 No-Go

任一条件阻塞：

```
unknown payment result can trigger duplicate charge
KYC result cannot be bound to attempt / user / market
raw KYC or provider secret appears in logs / events / read model
Geo failure causes unsafe precise-location assumption
Evidence can be complete before scan / integrity check
critical notification has no fallback or Inbox path
currency / tax / payout rule unresolved
Legal / Privacy / KYC approval missing
rollback cannot preserve Order / Ledger facts
Chapter 25 blocker remains open
```

## 14.3 Conditional Go

只有 non-blocking P1 问题可以条件放行，并记录：

```
issue_id
owner
mitigation
monitor
expiry date
rollback impact
approver
```

资金、隐私、身份、越权、Safety 或 retention 问题不能标为 conditional。

---

# 15. Pause / Rollback / Incident

## 15.1 Pause Levels

```
LEVEL_0 Observe
LEVEL_1 Stop new non-critical provider operations
LEVEL_2 Stop new admission / matching / funding
LEVEL_3 Freeze affected market and route to manual case
LEVEL_4 Emergency safety / payment shutdown
```

已有 Order 的处理由 Domain state、Safety、Payment hold 和 Operator Case 决定，不能因 Provider incident 批量改成 `CANCELLED`。

| 事件 | 默认级别 |
|---|---:|
| Notification degradation | 1 |
| Geo stale / unavailable | 1–2 |
| KYC callback gap | 2 for new KYC-dependent actions |
| Media scan unavailable | 2 for Evidence-dependent completion |
| Payment unknown result | 3 for affected rail |
| Duplicate charge / payout | 4 |
| Raw secret / cross-principal exposure | 4 + security incident |

## 15.2 Rollback Rules

回滚顺序：

```
stop new irreversible operations
preserve current Domain facts
reconcile in-flight Provider operations
route safe reads / existing Orders
switch only approved alternative or manual path
keep user communication accurate
```

禁止直接回滚数据库覆盖 Ledger、删除 callback 记录、把 UNKNOWN 强行改成 FAILED、把已支付 Order 改回未支付，或批量删除 Evidence 清理故障。

## 15.3 Incident Handoff

Provider incident case 必须包含：

```
market
provider connection
operation family
first observed at
affected object count
monetary exposure
privacy / safety exposure
current pause level
last known good config
rollback target
owner team
next update time
```

---

# 16. Provider Test Matrix

## 16.1 Payment

```
authorize success / decline
timeout unknown result
duplicate webhook / invalid signature
amount / currency / merchant mismatch
refund success / failure / duplicate
payout hold / release / duplicate
reconciliation mismatch
credential rotation
cutover with in-flight operations
```

## 16.2 KYC

```
created / submitted / verified
rejected with safe reason
manual review
duplicate / stale callback
provider unavailable
wrong user / attempt binding
document expiry / raw deletion
LegalHold preservation
cutover without false verification
```

## 16.3 Geo / Media / Notification

```
Geo: exact / ambiguous / not found / stale route / timeout / approx fallback / zone boundary
Media: partial upload / duplicate / hash mismatch / scan reject / scan timeout / deletion / hold
Notification: OTP failure / Offer expiry / safety fallback / quiet hours / consent suppression / duplicate
```

---

# 17. Operational Readiness Checklist

## 17.1 Engineering / Operations

```
adapter health endpoint
credential rotation procedure
webhook signature test
reconciliation dashboard
dead-letter alert
provider rate-limit metric
idempotency storage
outbox / inbox replay
schema version registry
Provider outage response
Payment unknown result case
KYC manual review case
Geo unsafe location case
Evidence scan failure case
critical undelivered alert case
escalation owner and SLA
```

## 17.2 Privacy / Finance / Legal

```
secret scan on logs and events
D4 / D5 access audit
data residency check
retention / deletion dry run
LegalHold test
consent document version
market currency approved
fee / tax display approved
refund / payout statement approved
KYC document list approved
Terms / Privacy / Consent copy approved
reconciliation sign-off
```

---

# 18. Acceptance Criteria

## AC-27-01 Provider Registry

每个 P0 Provider 有版本化 `ProviderConnection`、environment、capability、credential ref、health、priority、approval 和 lifecycle status。

## AC-27-02 Adapter Isolation

Payment、KYC、Geo、Media、Notification 通过独立 Adapter；Domain 不直接依赖 Provider SDK 状态。

## AC-27-03 Normalized Result

每次 Provider operation 映射为 normalized status、reference、failure category、retryability、signature result 和 schema version。

## AC-27-04 Secret Boundary

Provider secret、token、完整支付凭证和 raw KYC 不进入 Event、Read Model、Error、普通 Operator 查询或测试 fixture。

## AC-27-05 Callback Authentication

Webhook 在写 Domain 前校验签名、重放窗口、connection scope、object binding、金额 / 币种和 dedupe。

## AC-27-06 Unknown Result

Provider timeout / unknown result 进入 pending / unknown / reconciliation，不自动判定 success 或发起第二次不可逆操作。

## AC-27-07 Payment Funding Order

只有本地校验通过并进入 `FundingHold.SECURED` 后，才允许创建 paid executable Order。

## AC-27-08 Payment Idempotency

Funding、Refund、Payout 的重复 operation / webhook 不重复产生扣款、退款、payout 或 Ledger mutation。

## AC-27-09 Payment Reconciliation

本地 Payment、Provider operation、Refund、Payout、Ledger 能按市场要求对账；差异进入 `PaymentReconciliationCase`。

## AC-27-10 Payout Gate

Payout 受完成、争议、hold、PayoutIdentity、market rail、tax / legal 和 24h delay 约束；未知状态不自动放款。

## AC-27-11 KYC Binding

KYC callback / polling 绑定正确 user、attempt、connection、market 和 document scope；旧 attempt 不能升级新 attempt。

## AC-27-12 KYC Downtime

KYC Provider 不可用时不会产生 false `VERIFIED` 或 false `REJECTED`；新流程进入 pending / manual review。

## AC-27-13 KYC Raw Retention

raw KYC 按 D5、market retention、LegalHold 删除或保留；删除不伪造验证历史不存在。

## AC-27-14 KYC Market Override

市场 KYC 要求有 accepted document、provider、expiry、retention、legal basis 和 approved version。

## AC-27-15 Geo Minimization

Geo request 使用满足目的的最小粒度；Provider 精确坐标不会扩大产品可见范围或 retention。

## AC-27-16 Geo Freshness

Route / ETA / distance 带计算时间和 freshness；过期结果不能作为唯一 eligibility 或 check-in 事实。

## AC-27-17 Geo Fallback

地址歧义、Route timeout、Provider unavailable 有安全 fallback 或人工路径，不展示虚构距离 / ETA。

## AC-27-18 Media Integrity

Media 经过 owner / scope、hash、MIME、scan 和 retention 检查；失败 upload 不能变成已提交 Evidence。

## AC-27-19 Media Deletion

Media 删除保留必要 evidence / integrity / deletion event；LegalHold 或 Incident 范围按规则保留。

## AC-27-20 Notification Dedupe

同一 NotificationEvent 在重试、重放、fallback 中不重复发送超过 policy 允许次数，Inbox 可追踪。

## AC-27-21 Notification Consent

Marketing、security、safety、payment、order 通知分别遵守 consent、verified channel、quiet hours 和优先级规则。

## AC-27-22 Notification Fallback

Critical notification 的 primary channel 失败时有 retry、approved fallback、Inbox 或 Operator escalation。

## AC-27-23 Webhook Dedupe

Provider event 经过 RECEIVED、AUTHENTICATED、DEDUPED、NORMALIZED、APPLIED 或明确 reject / reconcile 状态；重复 callback 不重复 mutation。

## AC-27-24 Polling Bound

Polling 使用 bounded retry、backoff、same operation reference 和 last seen state，不产生无限请求或重复 Domain event。

## AC-27-25 Reconciliation Case

Payment、Payout、KYC、安全 mismatch 有结构化 case、owner、risk、hold、status 和 resolution audit。

## AC-27-26 Failover Safety

Provider failover 按能力、市场、法律和风险选择；未知资金结果不能直接切 Provider 二次扣款。

## AC-27-27 Provider Cutover

切换前通过 contract、sandbox、signature、idempotency、reconcile、traffic plan、rollback、support 和 approval 检查。

## AC-27-28 Drain

旧 Provider 停止新操作后仍可接收 in-flight callback / polling，并完成 reconciliation 后才标记 `RETIRED`。

## AC-27-29 MarketLaunchProfile

首发市场具备 currency、payment、payout、fee、tax、KYC、consent、retention、residency、provider、support 和 launch scope 配置。

## AC-27-30 Market Override Governance

每个 market override 有 reason、owner、legal / finance / risk approval、effective / review date、测试和回滚值。

## AC-27-31 Legal / Tax / KYC Sign-off

Legal、Tax / Finance、KYC / AML、Privacy、Safety、Support、Product、Engineering 的责任人和批准记录齐全。

## AC-27-32 Pilot Guardrail

Pilot 有 cohort、时间、场景、角色、Provider、容量、支付、KYC、通知和 Operator 上限；达到阈值可停止 admission / ramp。

## AC-27-33 Go Gate

所有 P0 Provider tests、Chapter 25 invariants、Chapter 26 contracts、market approvals、monitoring、support 和 rollback 通过后才允许 ACTIVE。

## AC-27-34 No-Go Gate

Duplicate money effect、raw secret exposure、KYC misbinding、unsafe location fallback、missing legal approval、unrecoverable rollback 任一存在即 No-Go。

## AC-27-35 Pause Levels

Provider incident 能按 Level 0–4 停止新操作、admission、funding 或市场，并保持既有 Order / Ledger facts 不被覆盖。

## AC-27-36 Incident Handoff

Provider incident case 记录 market、connection、operation、影响规模、资金 / 隐私 / 安全暴露、pause level、rollback target、owner 和 next update。

---

# 19. P0 / P1 Boundary

## 19.1 P0

```
one approved market
one approved Payment path
funding / refund / payout reconciliation
KYC verification + manual review fallback
Geo geocode / distance / route safe fallback
Evidence upload / scan / deletion
OTP / safety / payment / order notification
webhook authentication / dedupe / replay window
Provider timeout / unknown result handling
Market currency / fee / tax / KYC / retention approval
Pilot guardrail / pause / rollback
support / operator / reconciliation case
```

## 19.2 P1

```
multi-provider active load balancing
fully automatic Payment failover
cross-market payout routing
advanced KYC vendor orchestration
real-time multi-route optimization
advanced media transformation
non-critical marketing channel expansion
automated market self-service configuration
```

P1 Provider capability 不能改变 P0 Domain、Privacy、Money、Safety 或 Operator Invariant。

---

# 20. Locked Conclusions / Next Work

本章锁定：

```
Provider 是可替换能力，不是 Domain 真相
所有 callback 先认证、去重、归一化，再进入 Domain
未知资金结果必须 reconcile，不能盲目重试
KYC、Location、Media、Notification 都受 purpose / retention / consent 约束
市场差异进入版本化 MarketLaunchProfile，不复制 Domain
Pilot 必须有 cohort、容量、Provider、Operator 和 rollback guardrail
Legal / Tax / KYC / Privacy / Safety 未批准时不能 Go
```

下一步进入：

```
Chapter 28 — Pilot Runbook / Launch Operations / Incident Drill
```

Chapter 28 将把本章的 Go/No-Go、Pause Level、Reconciliation、Support 和 rollback 变成按小时执行的 Pilot runbook、值班表、演练脚本和 Launch Day checklist。
