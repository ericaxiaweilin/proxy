# Proxy PRD v1.1
## Chapter 32 — Enterprise API / SSO / SCIM / Integration Contract

**文档类型**：Enterprise API / OAuth / Webhook / SSO / SCIM / Data Export / Integration Contract  
**状态**：ACTIVE — Enterprise Integration v1  
**前置依赖**：Canonical Registry、Chapter 24、Chapter 26、Chapter 30、Chapter 31、MarketLaunchProfile  
**后续依赖**：Chapter 33 Enterprise Migration / Adoption / Renewal Governance、持续 Security / Legal / Provider Review

---

# 0. 本章目标

本章将 Enterprise 能力转成可执行的外部集成契约：

```
Enterprise API
OAuth / API Client
Principal and scope
Contract / Procurement / Billing API
Webhook / Event subscription
SSO / OIDC / SAML boundary
SCIM provisioning / deprovisioning
Role and group mapping
Data export / audit
Rate limit / quota / idempotency
Schema version / compatibility
Integration security / incident response
```

本章不允许外部集成绕过 Proxy Domain。所有外部调用最终必须映射为 Chapter 26 的 owned Command、Query、Event、Case 或 approved Provider Adapter。

核心原则：

```
external identity is not automatically a UserAccount
Enterprise admin is not an impersonation token
PurchaseOrder is not FundingSecured
Webhook delivery is not Domain success
SSO login is not KYC verification
SCIM deactivation is not deletion of business history
API scope is not permission without Principal and object scope
integration retry must be idempotent
```

---

# 1. Integration Constitution

## 1.1 API Is a Boundary

外部 API 只暴露：

```
approved Commands
approved Queries
approved Read Models
approved Events
approved Export packages
approved Case actions
```

不得暴露：

```
direct table write
internal provider secret
raw KYC
raw session token
unredacted risk rule
unscoped cross-Business query
internal database identifier as authorization
```

## 1.2 Principal Context Is Mandatory

每个 Enterprise API request 必须包含或可解析：

```
actor UserAccount or service principal
EnterpriseOrganization
BusinessAccount optional
Store scope optional
purpose
permission scope
contract entitlement where relevant
market / region
session or client authentication
correlation_id
```

缺少 Enterprise、Business 或 Store scope 的写入请求默认拒绝；不允许从 URL 中一个 enterprise_id 自动推断全部下属权限。

## 1.3 Read and Write Separation

Enterprise API 的 Query 可以聚合多个 Business，但写入必须路由到对象 owner：

```
Query → authorized projection
Command → owned Context
Event → subscribed fact
Export → asynchronous redacted package
```

聚合 Read Model 不能直接用于写入授权。

## 1.4 External Contract Does Not Add Domain State

外部系统需要的状态由 Integration Operation 表达，不向 UserAccount、Business、Order、Payment、KYC 或 Contract 随意增加 provider-specific enum。

---

# 2. Integration Principal Model

## 2.1 EnterpriseApiClient

```
EnterpriseApiClient
├── client_id
├── enterprise_id
├── client_type: USER_APP / SERVICE / PARTNER
├── authentication_method: OAUTH2 / MTLS / SIGNED_KEY
├── allowed_markets[]
├── allowed_businesses[]
├── allowed_stores[]
├── scopes[]
├── contract_entitlements[]
├── rate_limit_profile_ref
├── secret_ref or key_ref
├── status: DRAFT / ACTIVE / ROTATING / SUSPENDED / REVOKED / EXPIRED
├── created_by
├── expires_at
└── last_used_at
```

## 2.2 Service Principal

Service Principal 不是人类 UserAccount：

```
不能接受 Offer 作为 Agent
不能完成 KYC
不能拥有个人 PayoutIdentity
不能绕过 step-up
必须绑定 Enterprise、scope、purpose 和 owner
所有动作记录 client_id 与 delegated user where applicable
```

## 2.3 Delegated User Context

如果 API client 代表用户执行：

```
service client authenticates
user delegation is explicit
user scope is current
permission is calculated
high-impact action requires user step-up or approved enterprise control
audit records both service client and human actor
```

不能只记录 service client 而隐藏实际发起的 Enterprise user。

## 2.4 API Scope

建议 P0 scopes：

```
enterprise:read
business:read
business:manage
store:read
store:manage
task:read
task:create
task:approve
order:read
order:cancel
offer:read
billing:read
invoice:read
purchase_order:create
purchase_order:approve
budget:read
contract:read
sla:read
support:create
audit:read
export:request
webhook:manage
```

Scopes 仍需和对象 scope、Membership、Contract entitlement、Risk 和 Market policy 交集计算：

```
API scope
∩ Enterprise membership
∩ Business / Store scope
∩ object ownership
∩ contract entitlement
∩ account / risk state
∩ market policy
= effective access
```

---

# 3. OAuth / API Authentication

## 3.1 Supported Methods

| 方法 | 用途 | 默认级别 |
|---|---|---|
| OAuth 2.0 Authorization Code + PKCE | 用户授权的 Enterprise App | P0 |
| OAuth 2.0 Client Credentials | Service integration | P0，scope-bound |
| mTLS | 高安全 B2B integration | P1 / approved |
| Signed request key | Webhook / controlled partner | P1 / approved |
| Static API key | 禁止作为高权限长期方式 | 不作为 P0 默认 |

## 3.2 Token Rules

```
short-lived access token
refresh rotation where applicable
audience-bound
scope-bound
market / region aware
revocable
no raw token in logs
client secret in Secret Manager
```

Access token 不能延长 UserAccount Session，也不能绕过 OperatorAccessGrant、Consent 或 D4/D5 access。

## 3.3 Client Credentials

Client Credentials token 必须：

```
identify client
identify enterprise
carry scopes
carry market / region
carry purpose
have expiry
be revocable
be rate-limited
be audited
```

Client Credentials 不自动获得个人用户权限；涉及用户私有数据必须有明确 delegated scope。

## 3.4 Secret Rotation

API client secret / signing key rotation 必须支持：

```
overlap window
old key expiration
key version
test verification
revocation
audit
incident path
```

Rotation 失败时，不能把旧 key 永久保留作为临时修复。

## 3.5 Authentication Failures

认证失败：

```
does not reveal secret validity detail
does not reveal object existence unnecessarily
is rate-limited
is auditable
can create security alert for repeated abuse
```

---

# 4. Enterprise API Contract

## 4.1 API Envelope

```
{
  "request_id": "req_...",
  "api_version": "v1",
  "actor": {"type": "USER|SERVICE", "id": "..."},
  "enterprise_id": "ent_...",
  "business_id": "biz_...",
  "store_id": "store_...",
  "market_id": "market_...",
  "purpose": "OPERATIONS|BILLING|SUPPORT|EXPORT|AUDIT",
  "scopes": ["business:read"],
  "idempotency_key": "...",
  "correlation_id": "...",
  "requested_at": "...",
  "payload": {}
}
```

## 4.2 Response Envelope

```
{
  "request_id": "req_...",
  "operation_id": "op_...",
  "status": "ACCEPTED|PENDING|COMPLETED|REJECTED",
  "data": {},
  "read_model_ref": "...",
  "event_refs": [],
  "next_action": null,
  "error": null,
  "as_of": "...",
  "freshness": "CURRENT|STALE|PENDING_REBUILD",
  "correlation_id": "..."
}
```

## 4.3 API Operation

```
EnterpriseIntegrationOperation
├── operation_id
├── client_id
├── actor_ref
├── enterprise_id
├── target_type
├── target_id
├── command_type
├── status: RECEIVED / AUTHORIZED / APPLIED / PENDING / FAILED / CANCELLED
├── idempotency_key
├── request_hash
├── result_ref
├── error_code optional
├── created_at
├── updated_at
└── expires_at
```

## 4.4 Pagination

List API 必须使用：

```
opaque cursor
stable sort
as_of timestamp
scope binding
page size limit
redaction rules
cursor expiry
```

不能把数据库 offset、可猜测 ID 或时间戳作为跨租户授权依据。

## 4.5 Filtering

过滤条件必须：

```
be allowlisted
be scope-bound
be rate-limited
not expose hidden existence
not permit raw query injection
return redacted results
```

## 4.6 Bulk API

Bulk operation 必须：

```
have maximum batch size
produce operation_id
support partial result explicitly
be idempotent per item
return item-level errors
support cancellation where safe
not bypass per-object authorization
```

---

# 5. Enterprise Command Catalog

## 5.1 Membership / Scope

| Command | Owner | 主要校验 | 结果 |
|---|---|---|---|
| InviteEnterpriseMember | Identity / Enterprise | Enterprise admin + scope | EnterpriseMembership invited |
| RemoveEnterpriseMember | Identity / Enterprise | SoD + open work review | membership removed / pending |
| AssignEnterpriseRole | Enterprise | role scope + approval | permission change event |
| LinkBusinessToEnterprise | Enterprise | relationship approval | relationship active / pending |
| UnlinkBusinessFromEnterprise | Enterprise | contract / open work review | relationship ended / pending |
| TransferStore | Business | owner + open work / billing review | store transfer pending |

## 5.2 Contract / Procurement

| Command | Owner | 主要校验 | 结果 |
|---|---|---|---|
| CreateContractDraft | Enterprise | contract manager | draft |
| SubmitContractForApproval | Enterprise | required terms | pending approval |
| ApproveContract | Enterprise / Legal | SoD + legal scope | approved |
| ActivateContract | Enterprise | effective date + approvals | active |
| CreatePurchaseOrder | Procurement | budget + scope | pending approval |
| ApprovePurchaseOrder | Procurement | threshold + SoD | approved |
| ReserveBudget | Finance | budget + currency | reserved |
| ReleaseBudget | Finance | no active consumption | released |

## 5.3 Billing / Support / Export

| Command | Owner | 主要校验 | 结果 |
|---|---|---|---|
| UpdateBillingProfile | Finance | tax / legal / step-up | pending / applied |
| RequestInvoice | Finance | billing scope | invoice operation |
| RequestEnterpriseExport | Enterprise / Privacy | scope + step-up + approval | async export |
| CreateEnterpriseSupportCase | Support | entitlement + scope | Case created |
| EscalateEnterpriseCase | Support | severity + entitlement | escalation event |
| RequestAuditExport | Privacy / Security | scope + purpose | async package |

这些 Command 不直接写其他 Context 的表，必须通过 Chapter 26 的 owned Command 或 approved Integration Operation。

---

# 6. Webhook / Event Subscription

## 6.1 EnterpriseWebhookEndpoint

```
EnterpriseWebhookEndpoint
├── endpoint_id
├── enterprise_id
├── endpoint_url
├── event_filters[]
├── scope_filters[]
├── signing_key_ref
├── key_version
├── status: PENDING / ACTIVE / DEGRADED / DISABLED / REVOKED
├── retry_policy_ref
├── max_payload_class
├── created_by
├── verified_at
└── last_delivery_at
```

## 6.2 Subscription Rules

Enterprise 只能订阅被授权范围的事件：

```
Business / Store scope
data class
contract entitlement
market
event purpose
redaction policy
```

默认禁止把以下事件推给普通 Enterprise webhook：

```
raw KYC
precise live location
raw session / OAuth token
internal fraud signal
unredacted reporter identity
provider secret
```

## 6.3 Event Envelope

```
{
  "event_id": "evt_...",
  "event_type": "OrderCompleted",
  "event_version": 1,
  "enterprise_scope": "ent_...",
  "business_scope": "biz_...",
  "store_scope": "store_...",
  "aggregate_type": "Order",
  "aggregate_id": "order_...",
  "aggregate_version": 12,
  "occurred_at": "...",
  "policy_snapshot": {},
  "redactions": [],
  "correlation_id": "...",
  "payload": {}
}
```

## 6.4 Delivery States

```
CREATED
QUEUED
SENT
ACKNOWLEDGED
FAILED
RETRYING
DEAD_LETTER
SUPPRESSED
REVOKED
```

Webhook ACK 表示 Enterprise endpoint 收到消息，不表示 Domain command 成功。

## 6.5 Retry / Dedupe

Webhook delivery 必须：

```
use event_id dedupe
include delivery_id
sign timestamp and body
have bounded retries
use exponential backoff
respect endpoint rate limit
dead-letter after max attempts
support replay by approved operation
```

Enterprise consumer 应按 event_id、aggregate_id 和 aggregate_version 去重；平台不能假设 exactly-once delivery。

## 6.6 Replay

Replay 必须：

```
be explicitly requested
be scope-checked
be redacted again
use new delivery_id
not recreate Domain mutation
be auditable
```

---

# 7. SSO Contract

## 7.1 SSO Profile

```
EnterpriseSSOProfile
├── sso_profile_id
├── enterprise_id
├── protocol: OIDC / SAML
├── issuer
├── client / metadata ref
├── verified_domains[]
├── claim_mapping_ref
├── role_mapping_ref
├── default_membership_scope
├── MFA_requirement
├── session_policy_ref
├── JIT_provisioning
├── logout_mode
├── status: DRAFT / VERIFYING / ACTIVE / DEGRADED / DISABLED
├── approved_by
└── version
```

## 7.2 Domain Verification

Enterprise domain claim 必须：

```
prove control of domain
bind to one approved Enterprise or controlled relationship
be auditable
support conflict resolution
not silently move an existing UserAccount
```

一个 domain 不能在多个 Enterprise 间无冲突地同时作为自动 provisioning authority。

## 7.3 OIDC / SAML Result Mapping

SSO response 只能提供：

```
external subject
verified email / domain where allowed
display attributes
group claims
authentication time
MFA context
```

SSO response 不能直接证明：

```
KYC level
Agent capability
Payout identity
Business owner authority
Risk clearance
```

## 7.4 Login Binding

第一次 SSO 登录：

```
match only by verified binding or explicit user confirmation
do not match by display name
do not silently merge phone / email accounts
create LoginIdentity with provider subject
create or link EnterpriseMembership only within approved domain
record audit
```

## 7.5 Just-in-time Provisioning

JIT provisioning 可以创建：

```
UserAccount provisional / active according to contact policy
EnterpriseMembership
approved default role
approved Business scope
notification preference
```

JIT provisioning 不能自动创建：

```
AgentProfile ACTIVE
KYC VERIFIED
PayoutIdentity
Business OWNER without approval
high-risk permission
```

## 7.6 SSO Session

SSO session 仍映射到 Proxy Session：

```
local session id
external subject
issuer
auth time
MFA context
session expiry
revocation state
enterprise scope
```

Enterprise SSO logout / disable 触发相关 Enterprise-scoped session revoke，但不能复活或删除其他安全事实。

---

# 8. SCIM Provisioning Contract

## 8.1 SCIM Profile

```
EnterpriseSCIMProfile
├── scim_profile_id
├── enterprise_id
├── endpoint_ref
├── authentication_ref
├── attribute_mapping_ref
├── group_mapping_ref
├── default_role_ref
├── default_scope_ref
├── deprovisioning_policy_ref
├── rate_limit_profile_ref
├── status: DRAFT / ACTIVE / SUSPENDED / REVOKED
├── version
└── last_sync_at
```

## 8.2 SCIM User Mapping

SCIM user 对象映射为：

```
external_user_id
verified identifier
display attributes
active flag
group references
EnterpriseMembership
optional BusinessMembership invitation
```

SCIM 不直接写 UserAccount.status 的全部 lifecycle；active=false 默认触发 Enterprise offboarding workflow。

## 8.3 SCIM Create

SCIM create 必须：

```
validate Enterprise scope
dedupe external_user_id
verify domain / issuer
create or link LoginIdentity by explicit rule
create EnterpriseMembership
apply least-privilege default role
emit provisioning event
return stable external mapping
```

## 8.4 SCIM Update

属性更新必须区分：

```
display attribute
login identifier
group / role
Business scope
security attribute
status
```

高风险变化需要 step-up、approval 或 manual review，不因 SCIM sync 直接完成。

## 8.5 SCIM Deactivate

active=false 的默认流程：

```
mark SCIM mapping inactive
remove or suspend EnterpriseMembership
remove relevant Business / Store memberships
revoke enterprise-scoped sessions and grants
review open Task ownership
review Business Owner dependency
preserve Order / Ledger / Audit
notify or create support case
```

SCIM deactivate 不等于：

```
delete UserAccount immediately
delete personal history
cancel all Orders
delete KYC decision
rewrite Audit
```

## 8.6 SCIM Groups

Group mapping 必须：

```
allowlisted
versioned
scope-bound
least privilege
conflict-resolved
audited
```

Group 不能直接映射为 OWNER、Finance Approver、Security Admin 等高权限角色，除非通过 approved role mapping 和 SoD。

## 8.7 SCIM Idempotency

每个 SCIM operation 需要：

```
external id
request id
version or ETag where supported
dedupe
conflict result
retry-safe response
```

重复 create 不创建两个 Membership；重复 deactivate 不重复生成业务副作用。

---

# 9. Enterprise Data Export / Audit API

## 9.1 ExportRequest

```
EnterpriseExportRequest
├── export_id
├── enterprise_id
├── requested_by
├── scope_type
├── scope_ids[]
├── data_classes[]
├── purpose
├── approval_refs[]
├── status: REQUESTED / REAUTH_REQUIRED / REVIEWING / PROCESSING / READY / EXPIRED / REJECTED
├── redaction_policy_version
├── object_count
├── expires_at
├── download_audit_ref
└── created_at
```

## 9.2 Export Scope

可导出：

```
Business / Store configuration
Task / Order history within scope
Invoice / Statement
Contract / SLA
approved Audit records
Membership / permission history
aggregate operational metrics
```

默认不可导出：

```
raw KYC
biometric
session / OAuth token
provider secret
other Enterprise data
unredacted employee private data
internal fraud logic
precise location beyond purpose
```

## 9.3 Audit Export

Audit Export 只返回允许的事实：

```
actor
action
scope
object reference
permission result
timestamp
policy / contract version
correlation id
redaction summary
```

## 9.4 Export Delivery

```
asynchronous generation
short-lived signed link
one-time or bounded download
download audit
expiry
revocation
support case on failure
```

---

# 10. Contract / Billing / Procurement API

## 10.1 Contract API

允许读取：

```
contract status
scope
market
service tier
price schedule reference
SLA summary
effective / expiry
renewal window
```

修改合同必须走 Contract command、approval、version 和 effective time。

## 10.2 Procurement API

PurchaseOrder API 必须支持：

```
create draft
validate budget
submit approval
approve / reject
expire / cancel
link to Task or Order where allowed
query consumption
```

不能通过 PurchaseOrder API 直接创建 paid Order。

## 10.3 Billing API

Billing API 支持：

```
BillingAccount read / controlled update
Invoice read
Statement read
credit status read
payment term read
service credit reference
reconciliation status
```

高风险 Billing profile、Tax profile、CreditLimit 变更需要 step-up、Finance permission 和 audit。

## 10.4 SLA API

SLA API 返回：

```
target
measurement window
current status
exclusions
incident reference
service credit status
```

不能把 SLA API 返回的 target 当作实际 Order completion guarantee。

---

# 11. Rate Limit / Quota / Fairness

## 11.1 RateLimitProfile

```
RateLimitProfile
├── profile_id
├── enterprise_id
├── client_id optional
├── scope
├── requests_per_second
├── burst
├── daily_quota
├── bulk_limit
├── webhook_delivery_limit
├── retry_after_policy
├── priority
└── effective_at
```

## 11.2 Limit Dimensions

限制至少按：

```
enterprise
client
user
Business
Store
market
endpoint
command type
workload class
```

不能因为 Enterprise 合同等级高，就突破全局安全、Provider、KYC、Notification 或 W0 capacity limit。

## 11.3 Rate Limit Response

超限返回：

```
stable error code
retry_after
current scope
correlation id
safe next action
```

超限不能导致 partial hidden mutation；Command 必须在明确接受后才产生副作用。

## 11.4 Fairness

Enterprise quota 不能饿死其他市场或 Individual / Business 用户的 P0 安全与交易能力。容量由 Chapter 30 的 workload class 和 MarketCell guardrail 统一管理。

---

# 12. Versioning / Compatibility

## 12.1 API Version

每个 external API 包含：

```
major API version
schema version
policy version where relevant
market version
deprecation date
```

## 12.2 Compatible Change

兼容变化：

```
optional response field
new non-breaking endpoint
new optional event metadata
new error detail that clients may ignore
```

## 12.3 Breaking Change

Breaking change：

```
remove field
change field meaning
change enum semantics
change permission meaning
change event delivery guarantee
change financial / tax interpretation
change redaction behavior
```

Breaking change 必须新版本、迁移窗口、consumer notice、contract test 和 rollback / forward-fix。

## 12.4 Deprecation

Deprecation 必须：

```
announce date
replacement
usage metrics
owner
support window
security exception
retirement date
```

安全或合规原因可以缩短窗口，但必须有 Incident / Legal / Security decision。

---

# 13. Integration Error Contract

## 13.1 Error Envelope

```
{
  "error_code": "ENTERPRISE_SCOPE_DENIED",
  "category": "AUTHORIZATION",
  "retryability": "NO|SAFE_RETRY|AFTER_APPROVAL|AFTER_REAUTH|ASYNC",
  "message_key": "enterprise.scope.denied",
  "safe_details": {},
  "required_action": "...",
  "correlation_id": "...",
  "operation_id": "..."
}
```

## 13.2 Enterprise Error Codes

```
ENTERPRISE_SCOPE_REQUIRED
ENTERPRISE_SCOPE_DENIED
BUSINESS_SCOPE_DENIED
STORE_SCOPE_DENIED
CONTRACT_ENTITLEMENT_REQUIRED
CLIENT_REVOKED
CLIENT_EXPIRED
SSO_DOMAIN_UNVERIFIED
SSO_IDENTITY_CONFLICT
SCIM_MAPPING_CONFLICT
SCIM_VERSION_CONFLICT
ROLE_MAPPING_REQUIRES_APPROVAL
PURCHASE_ORDER_APPROVAL_REQUIRED
BUDGET_UNAVAILABLE
BILLING_PROFILE_REAUTH_REQUIRED
EXPORT_APPROVAL_REQUIRED
WEBHOOK_SCOPE_DENIED
WEBHOOK_REPLAY_REJECTED
RATE_LIMITED
API_VERSION_DEPRECATED
INTEGRATION_OPERATION_PENDING
```

## 13.3 Error Safety

错误不能泄露：

```
other Business existence
employee private data
raw KYC rejection detail
provider secret
internal fraud threshold
hidden contract terms
unscoped financial data
```

---

# 14. Integration Security / Incident Response

## 14.1 Security Signals

监控：

```
failed authentication burst
invalid signature
scope escalation attempt
cross-Business query attempt
SCIM group privilege spike
webhook replay
API key reuse
unusual export volume
large PurchaseOrder burst
unusual billing profile change
SSO domain conflict
offboarding lag
```

## 14.2 Integration Incident

```
IntegrationIncident
├── incident_id
├── enterprise_id
├── client / SSO / SCIM / webhook scope
├── detected_at
├── attack / failure type
├── affected objects
├── privacy / money / safety exposure
├── client status
├── revoked credentials
├── pause scope
├── communication
├── owner
└── resolution
```

## 14.3 Emergency Revocation

发生集成泄露时，可按窄到宽撤销：

```
one token
one client
one webhook
one SCIM profile
one SSO profile
one Enterprise
```

撤销不会删除已发生的 Audit、Order、Ledger、Invoice、KYC decision 或 LegalHold。

## 14.4 Enterprise Pause API

Enterprise pause API 只能由授权 Enterprise / Operator command 执行，必须带：

```
reason
scope
effective_at
allowed existing actions
blocked new actions
review_at
approver
```

---

# 15. Contract Test / Sandbox / Certification

## 15.1 Integration Sandbox

Enterprise integration sandbox 必须：

```
use synthetic User / Business / Store
use fake payment references
use fake KYC references
redact or disable raw media
simulate webhook retry
simulate SCIM duplicate / stale update
simulate SSO conflict
expose controlled error codes
never connect production secrets
```

## 15.2 Certification Scenarios

集成上线前至少验证：

```
OAuth authorization / expiry / revoke
scope and Principal isolation
idempotent command retry
pagination / cursor expiry
webhook signature / dedupe / replay
SSO first login / conflict / logout
SCIM create / update / deactivate / retry
PurchaseOrder approval / budget failure
Invoice / Statement redaction
Export approval / expiry
rate limit / backpressure
API version compatibility
incident credential revoke
```

## 15.3 Certification Status

```
DRAFT
TESTING
BLOCKED
CERTIFIED
EXPIRED
REVOKED
```

Certificate 到期、Contract 变化、API breaking change、Security incident 或 Market change 时进入 review。

---

# 16. Acceptance Criteria

## AC-32-01 API Boundary

Enterprise API 只暴露 approved Command、Query、Read Model、Event、Export 和 Case action，不提供 direct table write。

## AC-32-02 Principal Context

每个请求可解析 actor、Enterprise、Business、Store、purpose、scope、contract entitlement、market、region 和 correlation。

## AC-32-03 Service Principal

Service Principal 有 client、Enterprise、scope、purpose、owner、expiry、rate limit 和 audit；不能作为 Agent、完成 KYC 或拥有个人 PayoutIdentity。

## AC-32-04 Delegated User

代表用户的 API action 同时记录 service client、human actor、Enterprise scope 和 effective permission；不能隐藏实际操作者。

## AC-32-05 OAuth Security

OAuth token 短期、audience-bound、scope-bound、可撤销、可审计；secret 不进日志或 Domain event。

## AC-32-06 Client Rotation

API secret / key 支持 overlap、version、test、revocation 和 audit；旧 key 不无限保留。

## AC-32-07 API Envelope

请求 / 响应具备 API version、request / operation id、Principal scope、purpose、idempotency、correlation、status 和 freshness。

## AC-32-08 API Operation

长任务具备 EnterpriseIntegrationOperation，可查询、过期、失败和重试，不用同步 200 伪装完成。

## AC-32-09 Pagination

列表使用 opaque cursor、stable sort、as_of、scope binding、limit 和 cursor expiry，不暴露可猜测 offset 作为授权。

## AC-32-10 Bulk Safety

Bulk API 有 batch limit、operation id、item-level result、per-item authorization、idempotency 和安全取消。

## AC-32-11 Command Mapping

Enterprise Command 映射到 Chapter 26 owned Context，不直接更新其他 Context 的 canonical state。

## AC-32-12 Webhook Scope

Enterprise webhook 按 Enterprise / Business / Store、data class、market、contract entitlement 和 redaction scope 发送。

## AC-32-13 Webhook Secret

Webhook 具备签名、timestamp、key version、endpoint verification 和密钥轮换；raw secret 不进入 payload。

## AC-32-14 Webhook Dedupe

Webhook delivery 有 event id、delivery id、bounded retry、dead-letter、replay control 和 consumer dedupe。

## AC-32-15 Webhook Semantics

Webhook ACK 只表示接收，不等于 Domain command 成功；payload 明确 event version、aggregate version 和 freshness。

## AC-32-16 SSO Domain

SSO domain claim 经过 ownership verification、冲突处理、审批和 audit；不能静默移动现有 UserAccount。

## AC-32-17 SSO Mapping

OIDC / SAML 只能映射 external subject、verified identity、claims、MFA context 和 EnterpriseMembership，不能证明 KYC、Capability、Payout 或 Risk clearance。

## AC-32-18 SSO Link

首次 SSO login 按 explicit binding / confirmation 关联 LoginIdentity，不按 display name 静默合并账户。

## AC-32-19 JIT Provisioning

JIT 可创建受限 UserAccount、EnterpriseMembership 和默认低权限角色，但不能自动 KYC VERIFIED、Agent ACTIVE、PayoutIdentity 或 Owner。

## AC-32-20 SSO Session

SSO session 映射为 Proxy Session，包含 issuer、external subject、MFA、expiry、revocation 和 Enterprise scope；logout / disable 能撤销相关 scope。

## AC-32-21 SCIM Mapping

SCIM profile、external user id、group mapping、EnterpriseMembership 和 Business invitation 有稳定映射与版本。

## AC-32-22 SCIM Create

SCIM create 校验 Enterprise、domain、dedupe、default role、scope、event 和 external mapping，不创建重复 Membership。

## AC-32-23 SCIM Update

属性、group、role、scope、security 和 status 变化分流；高风险变化需要 approval、step-up 或 manual review。

## AC-32-24 SCIM Deactivate

SCIM deactivation 撤销 Enterprise / Business scope、session、grant 并处理 open Task ownership，但不立即删除 UserAccount、Order、Ledger、KYC decision 或 Audit。

## AC-32-25 SCIM Group Safety

SCIM group 只能映射 allowlisted、versioned、scope-bound、least-privilege role；高权限组需要审批和 SoD。

## AC-32-26 SCIM Idempotency

SCIM 重复 create、update、deactivate 可安全重试；冲突有稳定 error，不重复业务副作用。

## AC-32-27 Enterprise Export

Enterprise export 经过 scope、step-up、approval、redaction、异步生成、短期链接、下载审计和 expiry。

## AC-32-28 Export Boundary

Export 不包含 raw KYC、biometric、session / OAuth token、provider secret、未授权 Business、未脱敏员工数据或内部 fraud rule。

## AC-32-29 Contract API

Contract API 返回 scope、market、service tier、price reference、SLA、effective / expiry 和 renewal 信息；变更必须走版本化 command。

## AC-32-30 Procurement / Funding

PurchaseOrder、BudgetReservation 和 Approval API 不等于 FundingSecured；paid Order 仍必须通过 PaymentIntent 和 FundingHold。

## AC-32-31 Billing API

Billing API 能追踪 BillingAccount、Invoice、Statement、Tax、Payment、Fee、Service credit 和 reconciliation，且 scope-bound。

## AC-32-32 Rate Limit

Rate limit 按 Enterprise、client、user、Business、Store、market、endpoint、command 和 workload class 计算，并保护 W0 capacity。

## AC-32-33 Versioning

API、schema、event、policy 和 market version 明确；breaking change 有新版本、迁移窗口、consumer notice、contract test 和 rollback。

## AC-32-34 Error Contract

Enterprise error 使用稳定 code、category、retryability、safe details、next action、operation id 和 correlation；不泄露敏感事实。

## AC-32-35 Integration Certification

Sandbox / certification 覆盖 OAuth、scope、retry、pagination、webhook、SSO、SCIM、Procurement、Billing、Export、rate limit、version 和 revoke。

## AC-32-36 Incident Revocation

集成安全事件可按 token、client、webhook、SCIM、SSO、Enterprise 窄到宽撤销；撤销后保留 Audit、Order、Ledger、Invoice、KYC 和 LegalHold facts。

---

# 17. P0 / P1 Boundary

## 17.1 P0

```
Enterprise API envelope
Principal / scope authorization
OAuth client credentials with least privilege
idempotent Command operation
scoped Query / pagination
signed Webhook / dedupe / retry
verified domain baseline
manual Enterprise membership provisioning
SCIM deactivation safety contract
Contract / Procurement / Billing read and controlled write
Export / Audit redaction
rate limit / quota
version / deprecation
sandbox certification
credential revoke
```

## 17.2 P1

```
full SAML / OIDC self-service
full SCIM bidirectional lifecycle
automated role recertification
mTLS partner mesh
advanced ERP / HRIS integrations
real-time invoice streaming
enterprise data warehouse replication
multi-enterprise federation
```

P1 integration 不能改变 P0 的 UserAccount、Principal、KYC、Funding、Order、Ledger、Safety、Privacy 或 Audit Invariant。

---

# 18. Locked Conclusions / Next Work

本章锁定：

```
Enterprise API 是 Domain 的受控入口，不是平行业务系统
Service Principal 不等于 UserAccount，也不能 impersonate
SSO 只完成登录与 Enterprise membership binding，不完成 KYC / Payout / Risk
SCIM deactivate 触发 offboarding，不等于删除历史事实
Webhook 是可重放、可去重、可撤销的事实分发，不是成功命令
Contract、PurchaseOrder、Invoice、SLA 仍不能绕过 Funding / Order / Ledger
Export、Audit、Webhook 和 API 都遵循 scope、purpose、redaction 和 retention
```

下一步进入：

```
Chapter 33 — Enterprise Migration / Adoption / Renewal Governance
```

Chapter 33 将把 Enterprise onboarding、历史系统迁移、数据映射、用户采用、培训、合同续签、服务 credit、退出和 Customer Success 变成可执行的长期运营契约。

