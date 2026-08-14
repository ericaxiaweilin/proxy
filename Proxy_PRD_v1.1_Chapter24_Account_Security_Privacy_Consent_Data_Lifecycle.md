# Proxy PRD v1.1
## Chapter 24 — Account Security / Privacy / Consent / Data Lifecycle

**文档类型**：账户安全 / 身份生命周期 / 隐私与数据治理 / Consent Contract  
**状态**：ACTIVE — Account & Data Lifecycle v1  
**前置依赖**：Canonical Registry、Chapter 01、Chapter 13、Chapter 17、Chapter 21、Chapter 23  
**后续依赖**：Provider Integration Contract、首发市场 Legal / KYC / AML / Tax Review、Engineering API / Event Contract  

---

# 0. 本章目标

本章收口 Proxy 账户、敏感数据和生命周期中尚未锁定的部分：

```text
UserAccount lifecycle
Signup / Login / OTP / Passwordless
Session / Device / Logout all
Recovery / Takeover
Consent Ledger
Marketing consent
Location / Camera / Media permission
KYC document lifecycle
D0–D5 retention / deletion / legal hold
Account deletion / export
Block / Do-not-match lifecycle
Age eligibility
Business owner security
Operator sensitive-data access
```

本章的核心边界：

```text
UserAccount = 登录与账户安全真相
KYC = 身份 / 交易准备真相
Capability Verification = 能力真相
Trust = 历史行为关系真相
Risk = 当前风险真相
Consent = 用户授权事实
Retention = 数据生命周期规则
```

这些对象不得合并为一个 `user_status`、一个 `trust_score` 或一个 `profile_visibility` 字段。

---

# 1. 安全与隐私 Constitution

## 1.1 Account First

所有业务能力都建立在唯一登录主体之上：

```text
UserAccount
├── Requester capability
├── AgentProfile optional
└── BusinessMembership[]
```

不能创建：

```text
Requester Account
Agent Account
Business Employee Account
```

作为三套彼此独立的登录身份。

## 1.2 Least Privilege

每次敏感访问必须同时检查：

```text
Who
Why
Which object
Which purpose
Which permission
Until when
```

缺少任何一项时：

```text
deny by default
```

## 1.3 Purpose-bound Data

数据不是因为“属于用户”就可以被所有功能读取。

```text
Purpose
∩ Principal Scope
∩ Viewer Permission
∩ Data Classification
∩ Time / TTL
− Risk Restriction
= Access Granted
```

## 1.4 Security Does Not Rewrite Business Facts

账号关闭、Risk Restriction、删除请求和 Privacy Redaction 都不能删除或改写：

```text
已发生的 Ledger fact
已发生的 Order fact
已发生的 Domain Event
不可变 OperatorAuditLog
法律 / 争议保留所需的证据事实
```

它们只能改变：

```text
future access
future matching
future notification
future processing
```

## 1.5 No Silent Identity Merge

手机号、Email、Social Account、Business Membership 和 AgentProfile 不能因为字符串相同就自动合并。

任何账户合并或身份归属变更必须：

```text
explicit user confirmation
step-up authentication
conflict check
AuditLog
recovery path
```

P0 不支持任意账户合并；只支持受控的登录方式绑定。

---

# 2. Canonical UserAccount Lifecycle

## 2.1 Lifecycle Enum

Canonical `UserAccount.status` 锁定为：

```text
PROVISIONAL
ACTIVE
RESTRICTED
SUSPENDED
CLOSING
CLOSED
```

说明：

| Status | 语义 | 登录 | 新交易 | 既有业务访问 |
|---|---|---:|---:|---:|
| `PROVISIONAL` | 已创建但尚未完成最低 Contact Verification | 允许有限登录 | 仅 Draft / 低风险浏览 | 仅本人已有安全设置 |
| `ACTIVE` | 正常账户 | 允许 | 按 KYC / Trust / Risk / Permission | 允许 |
| `RESTRICTED` | 某些范围被限制，未完全停用 | 允许受限访问 | 按 Restriction Scope 禁止 | 允许必要的支持 / 历史访问 |
| `SUSPENDED` | 暂停正常业务动作 | 允许恢复 / 申诉 / 查看通知 | 禁止正常交易 | 允许安全、申诉、结算必要访问 |
| `CLOSING` | 用户请求关闭，正在处理依赖 | 允许 Re-auth / Export / Support | 禁止新业务 | 允许处理未结义务 |
| `CLOSED` | 账户不再提供正常产品能力 | 默认拒绝 | 禁止 | 只允许法律、争议、导出或恢复流程 |

`BANNED` 不作为 UserAccount lifecycle 值；永久或范围性封禁属于 `RiskDecision` / Restriction Object。历史 `BANNED` 显示层可以映射到 `SUSPENDED` 或 `CLOSED`，但不能再创建第三套账户状态真相。

## 2.2 状态转换

```text
PROVISIONAL
  ├── contact verified → ACTIVE
  ├── abuse / risk hold → RESTRICTED or SUSPENDED
  └── close request → CLOSING

ACTIVE
  ├── scoped restriction → RESTRICTED
  ├── serious risk / security incident → SUSPENDED
  └── close request → CLOSING

RESTRICTED
  ├── restriction resolved → ACTIVE
  ├── escalation → SUSPENDED
  └── close request → CLOSING

SUSPENDED
  ├── appeal / recovery approved → ACTIVE or RESTRICTED
  └── close request → CLOSING

CLOSING
  ├── dependencies cleared → CLOSED
  ├── user cancels request before finalization → ACTIVE / RESTRICTED
  └── legal hold / unresolved obligation → CLOSING
```

## 2.3 Account Status 与其他状态分离

以下不属于 `UserAccount.status`：

```text
K0 / K1 / K2
RequesterTrustTier
AgentProfile.status
BusinessMembership.status
RiskStatus
ConsentStatus
DeletionRequest.status
Session.status
```

## 2.4 Account Status 的有效动作

每次 Query / Command 必须返回：

```text
account_status
restriction_scope[]
available_actions[]
reauth_required
support_case_ref optional
```

页面不能通过 `account_status == ACTIVE` 单独判断“所有功能可用”。

---

# 3. Signup / Login / Verification

## 3.1 P0 Authentication Methods

首发 P0 支持：

```text
PHONE_OTP
PASSWORDLESS_EMAIL_LINK optional by market
SESSION_REAUTH_OTP
```

P0 不依赖：

```text
social login
password-only login
shared business credentials
operator impersonation as user
```

社交登录可在 P1 通过 Identity Provider Adapter 接入，但必须满足本章的绑定、冲突、撤销和恢复规则。

## 3.2 Phone OTP

OTP 规则：

```text
one-time use
short expiry
attempt limit
resend cooldown
rate limit by phone / device / IP / account
provider delivery status auditable
```

默认 P0 参数：

| 参数 | 默认值 |
|---|---:|
| `otp_ttl_seconds` | 300（5 分钟） |
| `otp_max_verify_attempts` | 5 |
| `otp_resend_cooldown_seconds` | 30 |
| `otp_max_requests_per_phone_per_hour` | 5 |
| `otp_max_requests_per_device_per_hour` | 10 |
| `otp_max_requests_per_ip_per_hour` | 20 |
| `otp_lockout_seconds_after_limit` | 900（15 分钟） |

具体值可由 Market / Provider Override 收紧，但不能关闭限频和一次性使用。

## 3.3 Login Flow

```text
Enter phone / email
→ credential challenge created
→ OTP / magic link verified
→ device risk check
→ session created
→ principal context selected
```

首次登录：

```text
UserAccount = PROVISIONAL
```

完成 Contact Verification 后：

```text
UserAccount = ACTIVE
KYC = K0
```

## 3.4 Signup 不自动创建 Agent

新用户默认：

```text
UserAccount created
Requester capability available within K0 limits
AgentProfile = null
BusinessMembership = []
```

只有用户明确点击 `Become a Proxy` 才创建 AgentProfile。

## 3.5 Principal Context

登录后 Session 必须绑定当前工作上下文：

```text
mode = REQUESTER / AGENT / BUSINESS / OPERATOR
principal_type = INDIVIDUAL / BUSINESS / INTERNAL
principal_id
```

切换上下文必须：

```text
recheck membership / profile status
recompute effective permissions
refresh visible data
```

不能通过修改客户端 `mode` 绕过后端权限。

## 3.6 Step-up Authentication

以下动作必须要求近期 Re-auth：

```text
change phone
change primary email
logout all devices
add / remove login method
export data
delete account
change Business owner
change Business payout / billing control
view or submit high-sensitivity KYC action
approve high-impact financial action
```

默认 Re-auth freshness：

```text
high-impact account action = 10 minutes
normal security setting = 30 minutes
```

---

# 4. Session / Device / Token Lifecycle

## 4.1 Session Object

```text
Session
├── session_id
├── user_id
├── device_id
├── auth_method
├── created_at
├── last_seen_at
├── expires_at
├── revoked_at
├── risk_state
└── principal_context snapshot
```

## 4.2 Session Status

```text
ACTIVE
EXPIRED
REVOKED
COMPROMISED
PENDING_REAUTH
```

Session status 不改变 UserAccount.status；账号被 SUSPENDED 时，相关 Session 可以被批量 Revoked。

## 4.3 P0 Session Defaults

| 参数 | 默认值 |
|---|---:|
| `access_token_ttl_seconds` | 900（15 分钟） |
| `refresh_session_max_age_seconds` | 2,592,000（30 天） |
| `idle_session_timeout_seconds` | 2,592,000（30 天） |
| `operator_session_max_age_seconds` | 28,800（8 小时） |
| `operator_idle_timeout_seconds` | 1,800（30 分钟） |
| `reauth_freshness_high_impact_seconds` | 600（10 分钟） |
| `new_device_step_up` | true |
| `refresh_token_rotation` | true |
| `reuse_detected_action` | revoke token family + security case |

## 4.4 Device Registration

设备记录只保存安全所需的最小信息：

```text
device_id
user_id
platform
app_version
last_seen_at
trusted_status
first_seen_at
revoked_at
```

默认不把完整设备指纹暴露给普通用户或 Business 成员。用户可看到：

```text
设备类型
最近活动时间
大致地点 / 时区 if available
当前设备标记
```

## 4.5 Logout

### Current Device

```text
revoke current Session
revoke refresh token family for current device
clear local credentials
```

### All Devices

```text
step-up required
revoke all active Sessions
revoke all refresh token families
invalidate active principal context
notify user
```

`Logout all devices` 不删除账户，不取消已确认 Order，不撤回已经发生的 Consent fact。

## 4.6 Compromise Detection

以下信号可触发 Session `COMPROMISED` 或 Account `RESTRICTED`：

```text
refresh token reuse
impossible device switch
大量 OTP 失败
异常登录频率
已撤销设备继续请求
Operator / security provider alert
```

自动保护动作：

```text
revoke suspicious session
require step-up
pause high-impact commands
preserve security event
notify user through trusted channel
```

自动信号不能单独永久封禁账户；永久限制需要 RiskDecision / Review。

---

# 5. Account Recovery / Takeover Protection

## 5.1 Recovery 原则

恢复账户不能只验证用户提供的新手机号或新 Email。必须区分：

```text
normal re-auth
lost device
lost phone
phone number change
suspected takeover
deceased / legal representative request
```

## 5.2 P0 Recovery Paths

P0 支持：

```text
verified existing login method
recent trusted session + step-up
provider-assisted phone recovery where available
Operator Case with identity review
```

P0 不支持自动：

```text
仅凭 Business Admin 申请接管员工个人账户
仅凭旧订单信息恢复完整账户
仅凭新设备指纹绕过 KYC
仅凭社交账号名称合并账户
```

## 5.3 High-risk Recovery Hold

以下情况触发保护期：

```text
phone changed
primary email changed
payout account changed
owner changed
logout all devices followed by new device login
security incident open
```

默认保护期：

```text
high-impact payout / billing changes = 24 hours
new Business owner transfer = 24 hours
new login method after takeover review = 24 hours
```

保护期内可以：

```text
view account
contact support
complete verification
```

默认限制：

```text
new payout destination
large refund / financial adjustment
Business ownership transfer completion
high-risk Agent Offer acceptance
```

安全事件或法律要求可以收紧保护期。

## 5.4 Account Takeover Response

用户报告疑似接管后：

```text
OpenAccountSecurityCase
revoke all sessions except recovery session
pause high-impact actions
pause payout destination changes
preserve security events
notify affected Business principals where necessary
```

不得自动取消用户已有 Order；Order 是否暂停由 Safety / Payment / Marketplace Command 单独决定。

## 5.5 Recovery Communication

敏感变更通知发送到：

```text
current verified channel
previous verified channel when safe and legally allowed
in-app Inbox after re-login
```

通知不能包含：

```text
OTP
完整 Government ID
完整 payout account
security answer
```

---

# 6. Login Method Binding

## 6.1 LoginIdentity

建议独立对象：

```text
LoginIdentity
├── login_identity_id
├── user_id
├── type: PHONE / EMAIL / SOCIAL / PASSKEY
├── masked_value
├── verified_at
├── primary
├── status
├── created_at
└── revoked_at
```

## 6.2 Binding Rules

```text
one UserAccount may have multiple verified login methods
one verified phone / email belongs to at most one active UserAccount
new method requires authenticated session + step-up
removing last recovery method requires replacement method first
social provider subject is not a legal identity by itself
```

## 6.3 Social Login P1 Boundary

未来接入 Social Account Bridge 时：

```text
provider_subject_id
≠ phone / email identity
≠ KYC identity
≠ Agent capability proof
```

Social login 只能作为登录方式，不能自动：

```text
完成 K1
创建 AgentRole
获得 Business Owner 权限
获得 Payout Ready
解除 Risk Restriction
```

---

# 7. Consent Ledger

## 7.1 Consent 是独立事实

Consent 不存成一个用户表里的布尔字段：

```text
marketing_opt_in = true
```

而应记录为：

```text
ConsentRecord
```

## 7.2 ConsentRecord Schema

```text
consent_id
user_id
principal_type optional
principal_id optional
purpose
scope
document_type
document_version
locale
status
granted_at
withdrawn_at optional
expires_at optional
source
actor_type
actor_id
capture_context
proof_reference
created_at
```

## 7.3 Consent Status

```text
GIVEN
WITHDRAWN
EXPIRED
SUPERSEDED
REJECTED
```

`WITHDRAWN` 不删除原始 Consent fact；它阻止未来依赖该 Consent 的处理。

## 7.4 Consent Purpose

P0 至少区分：

```text
TERMS_OF_SERVICE
PRIVACY_NOTICE
KYC_PROCESSING
PAYOUT_PROCESSING
MARKETING_COMMUNICATION
BUSINESS_OPERATIONAL_COMMUNICATION
LOCATION_EXECUTION
CAMERA_CHECKIN
MEDIA_UPLOAD
MEDIA_PUBLICATION
EVIDENCE_PROCESSING
SAFETY_CONTACT
DATA_EXPORT
```

不得用一个“同意全部”替代不同目的的可分离记录。

## 7.5 Required vs Optional Consent

| Purpose | 默认类型 | 拒绝后的行为 |
|---|---|---|
| Terms / Privacy | Required | 不能使用产品 |
| KYC processing | Required for gated action | 不能进入对应 KYC gate |
| Payout processing | Required for payout | Earnings 可保留，Payout blocked |
| Location execution | Contextual | 降级 Check-in / 不可执行 |
| Camera / Media | Contextual | 不能使用对应采集方式，可用其他 Evidence |
| Marketing | Optional | 不影响 Marketplace 主链 |
| Media publication | Optional | Evidence 不得公开发布 |
| Business operational communication | Required for assigned scope where applicable | 改用 Inbox / support path |

## 7.6 Consent Capture UX

每次捕获必须显示：

```text
what
why
who receives / processes
how long
how to withdraw
what happens if declined
```

Consent 文本更新时：

```text
new document version
new ConsentRecord
old record = SUPERSEDED where applicable
```

## 7.7 Consent Withdrawal

撤回后立即停止：

```text
future marketing
future optional publication
future optional location / camera / media use
future data sharing under that purpose
```

撤回不能自动删除：

```text
已发生的交易事实
已提交的 Ledger
法律要求保留的 Consent proof
已有 Order 的必要履约记录
```

若 Consent 是当前 Order 的必要执行条件：

```text
提示功能影响
进入 Safe Exit / Cancellation / Operator path when needed
不能静默继续采集
```

## 7.8 Marketing Consent

Marketing 必须：

```text
opt-in or market-approved lawful basis
channel-specific preference
frequency cap
unsubscribe path
no use for transactional critical messages
```

用户关闭 Marketing 不得关闭：

```text
Offer action
Payment failure
Safety alert
Order execution reminder
Account security notice
```

---

# 8. Device / Location / Camera / Media Permissions

## 8.1 Product Consent 与 OS Permission 分离

必须同时记录：

```text
Product Consent
OS Permission Result
Purpose
TTL / scope
```

获得 OS Permission 不代表 Proxy 自动拥有业务目的授权。

## 8.2 Location Permission

P0 场景：

```text
Task location selection
Travel feasibility
Check-in when configured
Order execution meeting point
Safety action
```

默认：

```text
foreground location only
no always-on background location
no continuous trajectory by default
```

如果用户拒绝 Location：

```text
Requester 可以使用手动地点 / Venue
Agent 可以使用 QR / Requester Confirm Check-in when allowed
系统不能把 location unavailable 伪装成 arrived
```

## 8.3 Camera / Media Permission

摄像头和媒体权限必须按用途请求：

```text
KYC capture
QR check-in
Evidence photo
Evidence video
Profile / Portfolio upload
```

默认禁止后台访问和无上下文采集。

## 8.4 Permission Record

```text
PermissionGrant
├── permission_id
├── user_id
├── permission_type
├── purpose
├── object_ref optional
├── source: OS / PRODUCT / PROVIDER
├── status
├── granted_at
├── expires_at optional
└── revoked_at optional
```

---

# 9. KYC / Identity Document Lifecycle

## 9.1 KYC 对象分离

```text
KYCProfile
IdentityVerificationAttempt
KYCDocument
PayoutIdentity
```

不能将 Government ID 原文直接存进 `UserAccount` 普通字段。

## 9.2 KYCProfile

```text
user_id
kyc_level: K0 / K1 / K2
verification_status
provider_ref
verified_at
expires_at optional
review_required
last_decision_ref
```

## 9.3 IdentityVerificationAttempt Status

```text
CREATED
STARTED
SUBMITTED
PROCESSING
VERIFIED
REJECTED
EXPIRED
CANCELLED
REVIEW_REQUIRED
```

## 9.4 KYCDocument Status

```text
UPLOADING
SUBMITTED
PROCESSING
VERIFIED
REJECTED
EXPIRED
REVOKED
DELETED
```

`DELETED` 表示原始文件已删除或不可访问，不代表验证历史被伪造为不存在。

## 9.5 KYC Document 最小字段

```text
kyc_document_id
user_id
document_type
country_or_issuer
provider_ref
storage_ref encrypted
status
submitted_at
decision_at optional
expires_at optional
retention_class = D5
deletion_eligible_at
legal_hold_ref optional
```

## 9.6 KYC 文件默认保留

首发产品默认：

```text
raw KYC document:
retain while verification is pending
retain through decision
delete 30 days after decision if no legal / fraud / payout hold

verification result:
retain while account / transaction obligations require

payout identity evidence:
retain while payout / tax / financial obligations are open
then apply market legal retention
```

具体市场法律或 Provider 合同要求更长时，以 Legal Hold / Market Retention Override 为准。

## 9.7 KYC Failure

KYC 被拒绝时：

```text
保留结构化拒绝 reason code
不向 Candidate API 暴露原始文件或内部检测细节
允许 correction / resubmission
不自动把 KYC reject 等同于 Risk permanent block
```

## 9.8 KYC Provider Boundary

Proxy 只保存：

```text
provider reference
decision
verification level
timestamps
reason code where permitted
```

不在普通产品服务中保存或返回：

```text
provider access token
raw identity image
full document number
biometric template
```

---

# 10. D0–D5 Data Lifecycle

## 10.1 生命周期阶段

每类数据都有：

```text
COLLECT
USE
SHARE
ARCHIVE
DELETE / ANONYMIZE
LEGAL_HOLD exception
```

## 10.2 默认保留矩阵

以下是产品默认，不替代市场法律意见：

| Classification | 典型数据 | 默认可保留期限 | 删除 / 匿名化行为 |
|---|---|---|---|
| D0 | Industry、Scenario、聚合 Supply、公共 Venue | 24 个月后评估 | 可转为聚合 / 匿名统计 |
| D1 | Candidate snapshot、Approx Distance、Task-relevant Capability | Task / MatchAttempt 结束后 90 天 | 删除个人展示副本，保留必要审计摘要 |
| D2 | Portfolio、Professional Proof、可见 Profile 字段 | 用户删除 / 撤回后 30 天处理 | 删除或匿名化；交易快照除外 |
| D3 | Task、Order、Chat metadata、Payment reference | 财务 / 争议义务结束后按 Market Legal Retention，默认 7 年 | 受限归档；到期删除或匿名化 |
| D4 | Precise Location、Live Location、Emergency Contact、Execution Trajectory | Order 关闭后 90 天 | 默认删除；Incident / Dispute / Legal Hold 可延长 |
| D5 | Government ID、KYC Document、Payout Account、Device Credential | 原始 KYC 按第 9.6 节；安全 Credential 立即撤销后删除 | 原文删除；结构化结果按法律 / 交易义务保留 |

## 10.3 Retention Clock

Retention 必须从明确事件开始计算：

```text
D1 = MatchAttempt / Offer closed
D3 = Order / Payment / Dispute closed
D4 = Order closed or Incident resolved, whichever is later where relevant
D5 raw KYC = verification decision
security credential = revoke time
```

不能用 `created_at` 作为所有数据的统一删除时间。

## 10.4 Retention Policy Object

```text
RetentionPolicy
├── retention_policy_id
├── classification
├── object_type
├── trigger_event
├── default_duration
├── legal_override_ref
├── delete_action
├── anonymize_action
├── hold_behavior
├── approved_by
└── version
```

## 10.5 Legal Hold

`LegalHold` 必须明确：

```text
hold_id
scope_type
scope_id
data_classes[]
reason_code
requested_by
approved_by
created_at
expires_at optional
released_at optional
```

Legal Hold 只冻结指定范围，不得无限冻结整个 UserAccount 数据集。

Legal Hold 期间：

```text
禁止删除 / 覆盖指定数据
限制访问至授权人员
记录每次访问
Hold release 后重新计算 deletion_eligible_at
```

## 10.6 Safety / Fraud Preservation

严重 Incident、欺诈调查或支付争议可以创建 Preservation Hold，但必须：

```text
scope-bound
reason-bound
time-bounded or reviewed
audited
```

自动风险模型不能无限期阻止删除。

---

# 11. Account Closure / Deletion / Export

## 11.1 Closure vs Deletion

```text
Account Closure
= 停止正常产品使用

Data Deletion
= 按数据分类、法律义务和依赖逐项删除 / 匿名化
```

关闭账户不等于立即删除所有交易与法律记录。

## 11.2 DeletionRequest Status

```text
REQUESTED
REAUTH_REQUIRED
REVIEWING_DEPENDENCIES
PENDING_LEGAL_HOLD
PENDING_FINANCIAL_CLOSE
PENDING_BUSINESS_HANDOVER
SCHEDULED
PROCESSING
PARTIALLY_COMPLETED
COMPLETED
REJECTED
CANCELLED
```

## 11.3 Delete Account Flow

```text
User requests deletion
→ step-up authentication
→ dependency check
→ show blockers / retained data categories
→ confirm request
→ account CLOSING
→ close eligible sessions / capabilities
→ complete open financial / safety handover where required
→ delete / anonymize eligible data
→ account CLOSED
```

## 11.4 Deletion Blockers

以下情况不能直接完成删除：

```text
open Order requiring safety / financial handling
pending payout or refund
active dispute
active LegalHold
Business is the only active Owner without handover
account security investigation
provider reconciliation mismatch
```

系统必须说明：

```text
blocker type
what user can do
what data will be retained
next review point
support path
```

## 11.5 Partial Deletion

可以先删除：

```text
optional marketing profile
public-facing Agent visibility
saved draft content
unpublished Portfolio media
optional device metadata
```

必须保留或受限归档：

```text
financial ledger facts
legal / dispute facts
security audit facts
required tax / payout records
active Incident evidence under hold
```

## 11.6 Account Export

Export 必须经过：

```text
step-up authentication
export scope confirmation
asynchronous package creation
expiry-limited download link
download audit
```

Export 包括用户可携带的：

```text
account profile
AgentProfile fields
Business memberships
Task / Order history
Reviews authored / received where allowed
Consent history
available payment / payout statements
```

默认不直接导出：

```text
OAuth token
device credential
provider secret
other person's private data
internal Risk score / detection rules
unredacted incident reporter identity
```

## 11.7 Export Package

```text
ExportRequest
├── export_id
├── user_id
├── requested_scope
├── status
├── created_at
├── expires_at
├── object_count
├── redaction_summary
└── download_audit_ref
```

---

# 12. Block / Do-not-match Lifecycle

## 12.1 三种关系必须分离

```text
TrustedRelationship
= 正向合作关系

MatchExclusionPreference
= Do Not Match Again，私有偏好

SafetyBlockRelation
= 安全阻断，受 Risk / Incident 治理
```

## 12.2 MatchExclusionPreference

```text
exclusion_id
requester_user_id or business_id
agent_id
direction
scope_type
scope_id optional
reason_category optional
status
created_at
expires_at optional
```

状态：

```text
ACTIVE
EXPIRED
REMOVED_BY_ACTOR
SUPERSEDED
```

默认行为：

```text
不进入该 Requester / Business 的新 Candidate Set
不影响 Agent 的全局信誉
不向对方公开私人 reason
不自动取消已有 Order
```

## 12.3 SafetyBlockRelation

```text
safety_block_id
subject_type
subject_id
target_type
target_id
source_incident_id
scope
status
created_by
approved_by optional
created_at
expires_at optional
```

状态：

```text
PENDING_REVIEW
ACTIVE
EXPIRED
REVOKED
SUPERSEDED
```

默认行为：

```text
阻止新的匹配 / Invite / Offer
撤回尚未接受的相关 Offer
限制 Order-bound contact where safety requires
创建或关联 OperatorCase
```

是否暂停已有 Order，必须通过 Safety Command / RiskDecision，不由关系写入直接完成。

## 12.4 Block 优先级

```text
SafetyBlockRelation
→ overrides TrustedRelationship and MatchExclusionPreference
→ applies to matching and exposure
→ does not erase historical facts
```

## 12.5 Business Block Scope

Business 的 Do-not-match 可以作用于：

```text
BusinessAccount
Store scope
specific Task / Scenario
```

不能让一个员工私下创建全 Business 的安全封禁而不留 Audit；Business-wide Safety Block 需要 Safety / Operator 权限。

## 12.6 Unblock

Do-not-match 可以由创建者移除，除非：

```text
SafetyBlockRelation active
legal hold
open safety case
```

Safety Block 的解除必须通过受权 Safety Command，并重新检查当前 Risk。

---

# 13. Age Eligibility

## 13.1 P0 Minimum Age

首发 P0 锁定：

```text
Agent = 18+ required
Requester creating a real-world Task = 18+ required
Business owner / high-impact approver = 18+ required
```

P0 不开放：

```text
minor Agent execution
minor unsupervised task
minor as sole Business owner
age-gated workaround through Business membership
```

## 13.2 Age Verification

年龄资格可以来自：

```text
KYC verified date of birth
market-approved age provider
legal guardian flow only if future product explicitly supports it
```

自我声明只能允许进入：

```text
有限浏览
非交易 onboarding
```

不能单独允许：

```text
paid Order
Agent Offer acceptance
Payout
Business ownership
```

## 13.3 Age Data Minimization

普通页面只接收：

```text
age_eligible = true / false / unknown
```

不返回完整出生日期或 Government ID。年龄证明属于 D5 / restricted identity。

## 13.4 Age Failure

发现不符合年龄资格时：

```text
block relevant high-impact action
protect active users / Orders
open Identity / Safety Case when needed
preserve only required evidence
do not publicly shame or expose DOB
```

---

# 14. Business Owner Security

## 14.1 Ownership Rules

Business 必须有：

```text
at least one active Owner membership
verified Owner identity
recoverable ownership path
```

Business Owner 不等于：

```text
Task creator
Billing viewer
Business Admin automatically
```

## 14.2 Owner Actions

高影响 Owner Action：

```text
transfer ownership
remove last other owner
change payout / billing control
close Business
approve high-value funding
grant Admin / Billing / Safety permissions
```

必须：

```text
step-up authentication
recent session
AuditLog
conflict / handover check
```

## 14.3 Ownership Transfer

```text
current Owner initiates
new Owner accepts
new Owner KYC / age / security gate passes
24h protection period
old Owner remains visible during handover
transfer completes through Domain Command
```

Transfer 期间不能删除唯一 Owner 的个人账户，也不能通过移除成员制造无 Owner Business。

## 14.4 Last Owner Guard

禁止：

```text
remove last Owner without replacement
close sole Owner session during unresolved transfer
let non-Owner member change payout destination
let Business verification alone override UserAccount security
```

## 14.5 Business Member Security

Business Member 被移除：

```text
new Business permissions revoked immediately
active session context invalidated
new D4 / D5 Business data access denied
existing personal UserAccount remains active
Business Task / Order / Payment facts remain with Business
```

## 14.6 Shared Device / Shared Credential

P0 禁止：

```text
shared Business password
shared OTP forwarding as normal workflow
generic “staff account” with no named UserAccount
```

每个成员必须使用自己的 UserAccount + BusinessMembership。

---

# 15. Operator Sensitive-data Access

## 15.1 Access Classes

Operator 访问分为：

```text
NORMAL_CASE_VIEW
ELEVATED_D4_VIEW
ELEVATED_D5_VIEW
BREAK_GLASS
```

## 15.2 Default Access Rules

| Access | 默认要求 | 默认 TTL |
|---|---|---:|
| D3 Case Context | Case permission + object scope | session bound |
| D4 precise location / contact | reason + valid Case / Order purpose + JIT | 30 分钟 |
| D5 KYC / payout identity | restricted team + reason + JIT | 30 分钟 |
| Break-glass D4 / D5 | P0 safety / payment integrity / invariant breach | 15 分钟 |
| Export / download | separate permission + reason + audit | one-time / short-lived |

## 15.3 OperatorAccessGrant

```text
operator_access_grant_id
operator_user_id
team
permission
object_type
object_id
data_class
purpose
reason_code
approved_by optional
issued_at
expires_at
revoked_at optional
```

## 15.4 Sensitive Read Audit

每次 D4 / D5 读取必须记录：

```text
operator
team
purpose
reason
object
data_class
fields / action
grant
timestamp
result
```

## 15.5 Operator Cannot See Secrets

即使有 D5 权限，普通 Operator 也不得获得：

```text
OAuth token
raw session token
refresh token
provider secret
unencrypted bank credential
full biometric data
```

需要 Provider 操作时使用：

```text
scoped adapter command
masked reference
provider-side action
```

## 15.6 View vs Change

查看 D4 / D5 与修改账户 / Payment / Risk 是不同权限：

```text
IDENTITY_VIEW
IDENTITY_DECIDE
PAYMENT_VIEW
PAYMENT_HOLD
SAFETY_VIEW
SAFETY_ACTION
RISK_RESTRICT
```

拥有查看权限不能自动拥有写权限。

## 15.7 Operator Impersonation

P0 不允许无标记的用户 Impersonation。

支持 Support View 时必须：

```text
banner visible
read-only by default
separate Operator Session
reason + case
user notification where safe
all reads audited
```

禁止以用户身份执行：

```text
AcceptOffer
ConfirmCompletion
ApproveFunding
change payout
grant consent
```

---

# 16. Privacy-safe Read Model 与 API Boundary

## 16.1 User-facing Query

```text
GetAccountProfile
GetAccountSecurity
ListSessions
ListDevices
GetKYCStatus
GetConsentHistory
GetPermissionStatus
GetDeletionStatus
CreateExportRequest
GetPrivacySummary
```

返回：

```text
masked values
status
available actions
reason codes
next step
```

不返回：

```text
raw tokens
internal risk rules
provider credentials
other user's private data
unredacted Operator notes
```

## 16.2 Account Commands

```text
CreateAccount
VerifyContact
StartLoginChallenge
VerifyLoginChallenge
CreateSession
RevokeSession
RevokeAllSessions
AddLoginIdentity
RemoveLoginIdentity
RequestAccountRecovery
CompleteAccountRecovery
ChangePrimaryContact
RequestAccountClosure
CancelAccountClosure
RequestDataExport
RequestDataDeletion
RecordConsent
WithdrawConsent
RecordPermissionDecision
```

## 16.3 Business Security Commands

```text
InviteBusinessMember
AcceptBusinessInvitation
ChangeBusinessMemberRole
SuspendBusinessMember
RemoveBusinessMember
InitiateOwnershipTransfer
AcceptOwnershipTransfer
ApproveBusinessHighImpactAction
CloseBusinessAccount
```

## 16.4 Safety / Relationship Commands

```text
CreateMatchExclusionPreference
RemoveMatchExclusionPreference
CreateSafetyBlock
ReviewSafetyBlock
RevokeSafetyBlock
OpenAccountSecurityCase
OpenDataPreservationHold
ReleaseDataPreservationHold
GrantOperatorSensitiveAccess
RevokeOperatorSensitiveAccess
```

## 16.5 Events

采用 Canonical PastTenseBusinessFact：

```text
AccountCreated
ContactVerified
LoginChallengeVerified
SessionCreated
SessionRevoked
AccountRestricted
AccountSuspended
AccountClosingStarted
AccountClosed
LoginIdentityAdded
LoginIdentityRemoved
AccountRecoveryRequested
AccountRecoveryCompleted
ConsentRecorded
ConsentWithdrawn
PermissionGranted
PermissionRevoked
KYCVerificationStarted
KYCVerificationCompleted
KYCVerificationRejected
KYCDocumentDeleted
DataExportCreated
DataDeletionCompleted
MatchExclusionPreferenceCreated
SafetyBlockCreated
SafetyBlockRevoked
BusinessOwnershipTransferStarted
BusinessOwnershipTransferred
OperatorSensitiveAccessGranted
OperatorSensitiveAccessExpired
LegalHoldCreated
LegalHoldReleased
```

---

# 17. Security / Privacy Error Taxonomy

页面和 API 必须区分：

```text
AUTH_REQUIRED
REAUTH_REQUIRED
SESSION_EXPIRED
SESSION_REVOKED
ACCOUNT_RESTRICTED
ACCOUNT_SUSPENDED
ACCOUNT_CLOSING
KYC_REQUIRED
AGE_NOT_ELIGIBLE
CONSENT_REQUIRED
CONSENT_WITHDRAWN
PERMISSION_DENIED
BUSINESS_MEMBERSHIP_REMOVED
SENSITIVE_ACCESS_EXPIRED
LEGAL_HOLD_BLOCK
FINANCIAL_DEPENDENCY_BLOCK
SECURITY_REVIEW_REQUIRED
EXPORT_NOT_READY
DELETION_IN_PROGRESS
```

不得将安全拒绝统一返回为：

```text
UNKNOWN_ERROR
```

但对外错误也不能泄露：

```text
其他用户是否存在
内部风险规则细节
举报人身份
安全检测阈值
```

---

# 18. Account / Data Lifecycle Metrics

## 18.1 Security Metrics

```text
OTP success / failure rate
account takeover reports
session revocation rate
refresh token reuse detections
recovery completion rate
step-up failure rate
new device challenge rate
```

## 18.2 Privacy Metrics

```text
Consent grant / withdrawal rate
D4 access count by purpose
D5 access count by team
expired grant access attempts
data export completion rate
deletion request completion time
legal hold count / age
retention job failures
redaction failure rate
```

## 18.3 Guardrails

```text
no raw KYC document in ordinary API logs
no D5 in Candidate API
no D4 after grant expiry
no revoked session accepted
no deletion of held data
no Business cross-scope access
no Operator silent impersonation
```

---

# 19. P0 / P1 Boundary

## 19.1 P0 必须实现

```text
UserAccount lifecycle
Phone OTP / passwordless login
Session list / revoke / logout all
Step-up authentication
Account recovery Case path
K0 / K1 / K2 separation
Consent Ledger
Marketing opt-out
Location / Camera / Media contextual permission
KYC status and document provider boundary
Deletion request with dependency checks
Data export request
D0–D5 classification
Retention policy and legal hold
MatchExclusionPreference
SafetyBlockRelation
18+ age gate
Business Owner transfer guard
Business member session revocation
Operator JIT D4 / D5 access
Sensitive access AuditLog
```

## 19.2 P1

```text
Social login
Passkey as primary login method
Self-service multi-factor device management
Guardian / minor flow
Automated account merge
Advanced privacy dashboard
Cross-market portability
Fine-grained field-level user export controls
Automated retention impact simulator
```

---

# 20. Account / Privacy Acceptance Criteria

## AC-24-01 Canonical Account Lifecycle

Given账户已创建但尚未验证 Contact，  
When系统读取 UserAccount，  
Then status 必须是 `PROVISIONAL`，不能直接伪装成 K1 或 Agent Active。

## AC-24-02 Account / KYC Separation

Given用户完成 K1，  
When系统读取账户状态，  
Then KYC level、UserAccount.status、AgentProfile.status、RiskStatus 必须分别返回。

## AC-24-03 Agent Creation Consent

Given用户注册成功，  
When用户没有点击 Become a Proxy，  
Then不得自动创建 AgentProfile 或 AgentRole。

## AC-24-04 OTP Expiry

Given OTP 已超过 5 分钟或超过尝试次数，  
When用户提交 OTP，  
Then必须拒绝并要求新 Challenge，不得复用旧 OTP。

## AC-24-05 Session Revocation

Given用户执行 Logout all devices，  
When旧设备使用 Refresh Token，  
Then必须拒绝并将相关 Token Family 标记为 Revoked / Compromised。

## AC-24-06 Step-up Gate

Given用户请求删除账户、导出数据或变更手机号，  
When最近一次 Re-auth 超过 10 分钟，  
Then必须要求 Step-up，不得只凭普通 Session 执行。

## AC-24-07 Takeover Protection

Given账户报告疑似接管，  
When系统创建 Account Security Case，  
Then必须撤销可疑 Session、暂停高影响动作并保留安全事件。

## AC-24-08 No Silent Merge

Given新手机号已绑定另一个 UserAccount，  
When用户尝试添加该手机号，  
Then系统不得自动合并账户，必须进入冲突 / Recovery 流程。

## AC-24-09 Consent Ledger

Given用户同意 Location、Marketing 或 Media 处理，  
When系统记录授权，  
Then必须保存 purpose、version、locale、timestamp、source 和 scope。

## AC-24-10 Consent Withdrawal

Given用户撤回 Marketing Consent，  
When下一次营销任务准备发送，  
Then不得发送；Transactional、Safety、Payment 和 Security 通知仍可发送。

## AC-24-11 Contextual Permission

Given用户只授予 QR Check-in 的 Camera Permission，  
When系统需要 Evidence Photo，  
Then必须重新检查对应目的，不得将一次 Camera 授权扩展到所有媒体用途。

## AC-24-12 KYC Raw Data Boundary

Given KYC Provider 返回验证结果，  
When普通 Candidate API 或 Business API 查询用户，  
Then不得返回 Government ID、原始 KYC 文档或 Provider Token。

## AC-24-13 KYC Document Deletion

Given KYC 决策已完成且无 Legal Hold，  
When原始文档达到删除资格，  
Then必须删除 / 不可访问原文，但保留允许的结构化验证结果和审计事实。

## AC-24-14 Data Classification

Given页面读取 Precise Location、Emergency Contact 或 Payout Account，  
When没有 Valid Order / Purpose / TTL / Audit，  
Then服务端必须拒绝访问。

## AC-24-15 Retention Clock

Given Order 在某日关闭，  
WhenD4 retention job 运行，  
Then应从 Order Closed / Incident Resolved 等正确触发事件计算，不得从 UserAccount created_at 统一计算。

## AC-24-16 Legal Hold Scope

Given某个 Order 建立 LegalHold，  
When删除任务运行，  
Then只保留 Hold scope 内的数据，不得冻结整个账户全部数据。

## AC-24-17 Delete Dependency Check

Given账户仍有 Pending Payout、Active Dispute 或唯一 Business Owner 身份，  
When用户请求删除，  
Then请求必须进入对应 Pending 状态，并告知阻塞原因。

## AC-24-18 Delete Completion

Given所有删除依赖已清除，  
WhenDeletionRequest 完成，  
Then账户进入 `CLOSED`，可删除数据按 D0–D5 策略处理，不可删除事实保持受限归档。

## AC-24-19 Export Redaction

Given用户请求 Data Export，  
When导出包生成，  
Then不得包含 OAuth Token、Refresh Token、Provider Secret、其他用户私密数据或未裁剪内部 Risk 规则。

## AC-24-20 Do-not-match Scope

GivenRequester 创建 MatchExclusionPreference，  
WhenMatching 运行，  
Then对方不得进入该 Requester / Business 的新 Candidate Set，但不应改变对方全局信誉。

## AC-24-21 Safety Block Priority

Given存在 Active SafetyBlockRelation，  
When双方存在 TrustedRelationship，  
ThenSafety Block 必须优先阻止新匹配 / Offer，并关联 Incident / Case。

## AC-24-22 Existing Order Block

GivenSafety Block 在已有 Order 执行期间建立，  
When关系写入完成，  
Then系统不得仅凭关系对象直接改写 Order lifecycle，必须走 Safety Stop / Risk Command。

## AC-24-23 Age Gate

Given用户年龄资格未知或低于 18 岁，  
When用户尝试接受 Agent Offer、创建付费 Task 或成为 Business Owner，  
Then必须阻止高影响动作，不能只依赖自我声明。

## AC-24-24 Age Privacy

GivenRequester 查看 Agent，  
When系统返回年龄资格，  
Then只能返回必要的 eligible / not eligible 结果，不得返回完整出生日期或 Government ID。

## AC-24-25 Business Owner Transfer

Given当前 Owner 发起 Ownership Transfer，  
When新 Owner 尚未接受或未通过身份 / 安全 Gate，  
ThenBusiness 不能完成转移，且不能删除唯一旧 Owner。

## AC-24-26 Business Member Removal

Given成员状态变为 `REMOVED`，  
When该成员使用旧 Business Session，  
Then旧 Session context 必须失效，新 Business D4 / D5 访问必须被拒绝。

## AC-24-27 Business Isolation

Given用户同时属于 Business A 和 Business B，  
When用户在 A context 查询 B 的 Task、Spend 或 Members，  
Then必须拒绝，不能因为同一 UserAccount 就共享 Business 数据。

## AC-24-28 Operator JIT

GivenOperator 请求 D4 / D5，  
When没有 reason、object scope 或有效 JIT grant，  
Then服务端必须拒绝访问并记录安全事件。

## AC-24-29 Operator Secret Boundary

GivenOperator 具备 D5 Case 权限，  
WhenOperator 查看 KYC / Payout，  
Then只能读取必要的 masked reference / decision，不得获取 Session Token、OAuth Token 或 Provider Secret。

## AC-24-30 Operator Impersonation

GivenOperator 打开 Support View，  
WhenOperator 尝试 AcceptOffer、ConfirmCompletion、ApproveFunding 或 GrantConsent，  
Then必须拒绝，且页面必须明确当前是 read-only support context。

## AC-24-31 Retention Failure

GivenRetention Job 删除失败，  
When系统检测到失败，  
Then必须产生可观测的 Data Lifecycle Case，不得静默跳过或无限延长数据保留。

## AC-24-32 Security Event Audit

GivenSession 被撤销、Consent 被撤回、D4 / D5 被读取或账户进入 CLOSING，  
When事件发生，  
Then必须有不可变的安全 / 隐私审计事实，并支持按 User / Object / Operator 查询。

---

# 21. 本章锁定结论

## 21.1 Account Lifecycle

```text
PROVISIONAL
→ ACTIVE
→ RESTRICTED / SUSPENDED
→ CLOSING
→ CLOSED
```

`BANNED` 不再作为 UserAccount lifecycle 值；封禁属于 Risk / Restriction 语义。

## 21.2 P0 Security

```text
Phone OTP / passwordless
Session rotation / revoke all
Step-up for high-impact actions
Recovery Case
Takeover protection
Business owner guard
```

## 21.3 P0 Privacy

```text
Consent Ledger
Purpose-bound permission
D0–D5 classification
Retention clock
Legal Hold
Deletion dependency check
Export redaction
```

## 21.4 P0 Relationship Safety

```text
TrustedRelationship
≠ MatchExclusionPreference
≠ SafetyBlockRelation
```

Safety Block 优先级高于 Trusted，但不直接改写既有 Order 状态。

## 21.5 P0 Operator Boundary

```text
D4 / D5 = JIT + reason + scope + TTL + audit
Operator can view / assist / resolve
Operator cannot act as user
Operator cannot see raw secrets
```

## 21.6 下一章

根据 Gap Audit，下一步进入：

```text
Chapter 25 — E2E Acceptance / Test Matrix / Invariant Gate
```

Chapter 25 将把 Chapter 20–24 的规则整理为可执行的 Given / When / Then 测试，包括：

```text
single-slot happy path
multi-slot partial fill
concurrent accept
requester / agent cancellation
no-show
replacement
funding failure
refund / payout failure
material change
missing evidence
dispute / safety stop
location grant expiry
business isolation
operator adjustment
duplicate webhook / command
stale offer / retry / idempotency
```

