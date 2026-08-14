# Proxy PRD v1.1
## Chapter 31 — Enterprise / B2B Scale / Contract Governance

**文档类型**：Enterprise Principal / B2B Contract / Procurement / Billing / SLA / Governance  
**状态**：ACTIVE — Enterprise Governance v1  
**前置依赖**：Canonical Registry、Chapter 15、Chapter 16、Chapter 24、Chapter 27、Chapter 29、Chapter 30  
**后续依赖**：Chapter 32 Enterprise API / SSO / SCIM / Integration Contract、持续 Legal / Tax / Security Review

---

# 0. 本章目标

本章把 Business Workspace 从多人协作扩展到企业规模，但不把 Proxy 变成未经边界控制的 ERP：

```
Enterprise Organization
Business Principal hierarchy
Multi-business / Multi-store governance
Membership / Role / Permission
Procurement / Approval / Spend control
Enterprise Contract / Price Schedule / Volume commitment
SLA / Service credit boundary
Billing Account / Invoice / Statement
Tax / Payment terms / Credit limit
Enterprise Security / SSO boundary
Audit / Export / Support
Enterprise onboarding / expansion / suspension
```

本章的核心边界：

```
UserAccount = individual login identity
BusinessAccount = operational transaction Principal
EnterpriseOrganization = commercial / governance umbrella
BusinessMembership = user access to a BusinessAccount
EnterpriseMembership = user access to enterprise governance scope
Contract = commercial terms, not a completed Order
PurchaseOrder = approval / commitment evidence, not FundingSecured
Invoice = billing record, not Ledger mutation by itself
SLA = service obligation, not permission to bypass Safety or KYC
```

---

# 1. Enterprise Constitution

## 1.1 No Second Human Account

企业不能为员工创建共享登录：

```
one person → one UserAccount
BusinessMembership → BusinessAccount access
EnterpriseMembership → Enterprise governance access
shared credential = prohibited
```

Business Admin 不能仅凭企业身份接管员工个人 UserAccount、Session、LoginIdentity、KYC 或 PayoutIdentity。

## 1.2 BusinessAccount Remains Transaction Principal

Task、Order、Payment、Billing visibility、Store operations 和 Business history 的归属仍由 BusinessAccount 决定。EnterpriseOrganization 不自动成为所有下属 Business 的交易 owner。

## 1.3 EnterpriseOrganization Is an Umbrella

EnterpriseOrganization 可管理：

```
commercial relationship
contract
service tier
approved BusinessAccounts
central policies
consolidated statements
support escalation
security governance
```

它不能在没有明确 Business scope、Membership、Permission 和 Principal context 的情况下读取或写入下属 Business 数据。

## 1.4 Commercial Terms Do Not Rewrite Domain Truth

Enterprise Contract、Price Schedule、SLA、PurchaseOrder、Invoice 和 CreditLimit 都不能：

```
create a paid Order without Funding
accept an Offer as an Agent
bypass KYC / capability
override Safety restriction
read another Business data
modify immutable Ledger fact
delete LegalHold data
grant raw D4 / D5 access
```

---

# 2. Enterprise Principal Model

## 2.1 EnterpriseOrganization

```
EnterpriseOrganization
├── enterprise_id
├── legal_name
├── display_name
├── registration_reference
├── tax_profile_ref
├── status: PROSPECT / ONBOARDING / ACTIVE / RESTRICTED / SUSPENDED / CLOSING / CLOSED
├── home_market
├── data_residency_rule_ref
├── contract_refs[]
├── approved_business_refs[]
├── enterprise_policy_ref
├── security_profile_ref
├── support_tier
├── created_at
├── updated_at
└── closed_at optional
```

## 2.2 Enterprise Status

```
PROSPECT → ONBOARDING
ONBOARDING → ACTIVE
ACTIVE → RESTRICTED
ACTIVE → SUSPENDED
RESTRICTED → ACTIVE
SUSPENDED → ACTIVE after review
ACTIVE → CLOSING
CLOSING → CLOSED
```

Enterprise status 不直接等同于 BusinessAccount 或 UserAccount status。一个 Enterprise 被暂停时，必须按 scope 判断下属 Business、存量 Order、Payout、Support 和合同义务。

## 2.3 EnterpriseBusinessRelationship

```
EnterpriseBusinessRelationship
├── relationship_id
├── enterprise_id
├── business_id
├── relationship_type: OWNED / CONTROLLED / AFFILIATED / CLIENT / PARTNER
├── scope: COMMERCIAL / OPERATIONS / BILLING / REPORTING
├── effective_at
├── expires_at optional
├── approval_ref
├── status: PENDING / ACTIVE / SUSPENDED / ENDED
└── audit_ref
```

Relationship 不自动授予所有下属 Business 的操作权限；每个 Scope 必须再经过 Permission 计算。

## 2.4 EnterpriseMembership

```
EnterpriseMembership
├── enterprise_membership_id
├── enterprise_id
├── user_id
├── role_bundle_ref
├── scope_type: ENTERPRISE / BUSINESS / STORE
├── scope_ids[]
├── status: INVITED / ACTIVE / SUSPENDED / REMOVED / EXPIRED
├── invited_by
├── joined_at
├── expires_at optional
└── removed_at optional
```

EnterpriseMembership 与 BusinessMembership 分离，不能用 Enterprise Admin 角色直接替代下属 Business Membership。

---

# 3. Enterprise Roles / Permissions

## 3.1 Role Bundles

建议的 Enterprise P0 role bundle：

```
ENTERPRISE_OWNER
ENTERPRISE_ADMIN
PROCUREMENT_ADMIN
FINANCE_ADMIN
SECURITY_ADMIN
BUSINESS_ADMIN
STORE_MANAGER
REQUESTER
VIEWER
SUPPORT_CONTACT
```

Role 仍然只是 Permission Bundle；Effective Permission 必须结合：

```
UserAccount status
EnterpriseMembership
BusinessMembership
scope
principal context
resource ownership
Risk / Restriction
contract entitlement
step-up
```

## 3.2 Permission Families

```
ENTERPRISE_VIEW
ENTERPRISE_MANAGE
BUSINESS_LINK_MANAGE
MEMBER_INVITE
MEMBER_REMOVE
ROLE_ASSIGN
STORE_VIEW
STORE_MANAGE
TASK_CREATE
TASK_APPROVE
TASK_ASSIGN
ORDER_VIEW
ORDER_CANCEL
BILLING_VIEW
BILLING_MANAGE
PURCHASE_ORDER_CREATE
PURCHASE_ORDER_APPROVE
BUDGET_MANAGE
CONTRACT_VIEW
CONTRACT_MANAGE
SLA_VIEW
SECURITY_VIEW
SECURITY_MANAGE
AUDIT_VIEW
EXPORT_REQUEST
SUPPORT_ESCALATE
```

## 3.3 Segregation of Duties

以下默认不能由同一人单独完成：

```
invite and approve high-privilege member
create and approve PurchaseOrder above threshold
create and approve manual financial adjustment
create and approve Contract change
assign and approve own elevated role
request and approve Enterprise data export
create and close a critical Security case
```

## 3.4 Enterprise Admin Boundary

Enterprise Admin 可以管理 Enterprise scope，但只有在具备下属 Business / Store scope 的情况下才可执行对应操作。前端当前 Workspace 不得作为授权依据。

---

# 4. Business / Store Hierarchy

## 4.1 Hierarchy

```
EnterpriseOrganization
├── BusinessAccount A
│   ├── Store A1
│   └── Store A2
├── BusinessAccount B
│   └── Store B1
└── BusinessAccount C
    └── Store C1
```

BusinessAccount 仍是 Task / Order / Billing Principal；Store 是运营与预算 scope；Enterprise 是治理与商业 umbrella。

## 4.2 Multi-store Rules

Enterprise scope 可以：

```
view aggregated approved metrics
apply central policy template
set store-level approval threshold
consolidate statements
route support
```

不能默认读取：

```
another Store precise location
individual employee private data
raw KYC
other Business payout detail
unscoped Order chat
unredacted Incident reporter
```

## 4.3 Cross-store Task

一个 Task 可以关联一个 Business Principal 和多个 Store scope，但必须：

```
one transaction principal
explicit store_refs
store-level permissions
budget allocation
task owner
billing owner
audit trail
```

跨 Store 聚合不能创建旁路 Order 或绕过原子 Slot。

## 4.4 Store Transfer

Store 从 Business A 转移到 Business B 时：

```
new ownership approval
open Task / Order review
billing and budget handoff
member scope review
location / venue reference review
audit
future traffic cutover
```

历史 Order / Ledger 仍归原交易 Principal，不能用 Store transfer 改写历史归属。

---

# 5. Enterprise Contract

## 5.1 EnterpriseContract

```
EnterpriseContract
├── contract_id
├── enterprise_id
├── counterparty_ref
├── market_ids[]
├── business_scope[]
├── service_tier_ref
├── price_schedule_ref
├── volume_commitment_ref optional
├── payment_terms_ref
├── tax_terms_ref
├── data_processing_terms_ref
├── SLAProfile_ref
├── support_tier
├── effective_at
├── expires_at
├── renewal_window
├── status: DRAFT / NEGOTIATING / APPROVED / ACTIVE / SUSPENDED / EXPIRED / TERMINATED
├── approved_by[]
└── signed_reference
```

## 5.2 Contract Lifecycle

```
DRAFT → NEGOTIATING
NEGOTIATING → APPROVED
APPROVED → ACTIVE at effective_at
ACTIVE → SUSPENDED
ACTIVE → EXPIRED
ACTIVE → TERMINATED
SUSPENDED → ACTIVE after approved remediation
```

合同状态不能直接把 UserAccount、BusinessAccount、Order 或 PaymentIntent 改成同名状态。

## 5.3 Contract Scope

合同必须明确：

```
legal entity
market
Business / Store scope
service role / scenario scope
pricing / fee
minimum / maximum volume
payment terms
tax / invoice
data processing
SLA
support
termination
renewal
dispute
security obligations
```

未写入合同的能力不能默认为 Enterprise entitlement。

## 5.4 Contract Change

合同变更必须：

```
new contract version
old / new terms
effective_at
affected Orders
price / tax impact
approval
user / Business communication
rollback or transition rule
```

已创建的 Quote、Offer、Order 是否 revalidate，按 Transaction policy 明确处理，不能由合同后台静默重价。

---

# 6. Service Tier / SLA

## 6.1 SLAProfile

```
EnterpriseSLAProfile
├── sla_profile_id
├── contract_id
├── service_scope
├── response_target
├── matching_target
├── arrival_target
├── evidence_target
├── support_target
├── incident_severity_targets
├── exclusions
├── measurement_definition_ref
├── service_credit_rule_ref optional
├── effective_at
└── version
```

## 6.2 SLA Does Not Change Safety

企业 SLA 不能要求：

```
match an unqualified Agent
bypass KYC
expose precise location early
skip Funding
force unsafe execution
hide an Incident
release payout before hold clears
```

无法安全满足 SLA 时，返回事实、替代方案和 escalation，不制造伪成功。

## 6.3 Measurement

SLA metric 必须引用 MetricRegistry：

```
start event
end event
business hours / timezone
excluded states
Provider outage treatment
user-caused delay
Safety hold treatment
measurement version
```

## 6.4 Service Credit

Service credit 如存在：

```
属于合同 / Billing settlement
不能直接修改 Agent Earnings
不能改变原 Order fact
不能绕过 Refund / Dispute policy
需要 Finance approval
有独立 Ledger / statement reference
```

---

# 7. Procurement / Approval / Spend Control

## 7.1 PurchaseOrder

```
PurchaseOrder
├── purchase_order_id
├── enterprise_id
├── business_id optional
├── store_id optional
├── contract_id optional
├── requester_id
├── approver_chain_ref
├── budget_reservation_ref
├── amount
├── currency
├── tax_estimate optional
├── purpose
├── status: DRAFT / PENDING_APPROVAL / APPROVED / REJECTED / EXPIRED / CONSUMED / CANCELLED
├── effective_at
└── audit_ref
```

## 7.2 PurchaseOrder Is Not Funding

PurchaseOrder APPROVED 只表示企业内部或合同层允许支出。真正的 Payment 流程仍是：

```
PurchaseOrder approved
→ PaymentIntent
→ Funding authorization
→ FundingHold SECURED
→ paid Order
```

## 7.3 Approval Policy

```
BusinessApprovalPolicy
├── policy_id
├── enterprise_id
├── business / store scope
├── amount_thresholds
├── scenario / role restrictions
├── requester roles
├── approver roles
├── dual_control_required
├── emergency_rule
├── effective_at
└── version
```

Approval Policy 只能影响是否允许提交或支付，不可改变 Task、Offer、Order 的 Domain 状态机。

## 7.4 BudgetReservation

```
BudgetReservation
├── reservation_id
├── budget_scope
├── source: ENTERPRISE / BUSINESS / STORE / CONTRACT
├── amount
├── currency
├── reserved_for
├── expires_at
├── status: RESERVED / RELEASED / CONSUMED / EXPIRED
├── approval_ref
└── audit_ref
```

预算 reservation 不是 Ledger income，也不能被两个 PaymentIntent 同时消费。

## 7.5 Emergency Spend

Emergency spend 必须：

```
限定场景
限定金额
限定时间
明确 Incident / Safety reason
事后补审
不可绕过 Payment / Ledger
```

---

# 8. Billing / Invoice / Payment Terms

## 8.1 BillingAccount

```
BillingAccount
├── billing_account_id
├── enterprise_id or business_id
├── legal_entity_ref
├── tax_profile_ref
├── billing_currency
├── payment_terms_ref
├── credit_limit optional
├── invoice_delivery
├── billing_contact_scope
├── status: DRAFT / ACTIVE / ON_HOLD / CLOSED
└── verified_at
```

## 8.2 Invoice

```
Invoice
├── invoice_id
├── billing_account_id
├── contract_id optional
├── period
├── line_items[]
├── subtotal
├── tax
├── total
├── currency
├── source_refs
├── status: DRAFT / ISSUED / PARTIALLY_PAID / PAID / OVERDUE / VOID
├── issued_at
├── due_at
└── document_ref
```

Invoice 必须可追溯到 Order、Payment、Fee、Service credit 或其他允许的 source ref；不能凭空生成应收。

## 8.3 Statement

Enterprise Consolidated Statement 只能聚合已授权 Business / Store scope，且必须保留：

```
source Business
source Store
source Order / Payment
currency
tax treatment
period
redaction
generated_at
```

## 8.4 Payment Terms

Payment terms 可以表达：

```
prepaid
card / wallet
invoice due
approved credit limit
deposit / funding threshold
late payment handling
```

但任何 term 都必须映射到 approved Payment Provider、MarketLaunchProfile、Tax profile 和 Funding policy。

## 8.5 Credit Limit

CreditLimit 不是无限 Funding：

```
approved scope
currency
available amount
reserved amount
used amount
expiry
hold behavior
review owner
```

CreditLimit 变化不能让已存在的 paid Order 获得额外资金；新 Commit 仍需 Payment / Funding decision。

---

# 9. Enterprise Security

## 9.1 EnterpriseSecurityProfile

```
EnterpriseSecurityProfile
├── security_profile_id
├── enterprise_id
├── verified_domains[]
├── login_policy_ref
├── session_policy_ref
├── MFA_requirement
├── SSO_status
├── provisioning_mode
├── device_policy_ref
├── export_policy_ref
├── audit_retention_ref
├── incident_contact_ref
└── version
```

## 9.2 SSO / SCIM Boundary

SSO、SCIM、domain claim 和 automated provisioning 属于 Enterprise Login Integration，不改变：

```
UserAccount canonical identity
KYC identity
AgentProfile
BusinessMembership
PayoutIdentity
```

P0 可先支持 verified domain、MFA policy、manual invite；SSO / SCIM 为 P1，进入 Chapter 32 Contract。

## 9.3 Enterprise Account Recovery

Enterprise Admin 可以请求成员访问 review，但不能直接重置个人身份。成员离职时：

```
remove EnterpriseMembership
remove relevant BusinessMembership
revoke enterprise-scoped sessions / grants
reassign open Task ownership if authorized
review Business ownership
preserve Order / Ledger / Audit
notify affected owner
```

## 9.4 Security Incident

Enterprise security incident 需要分辨：

```
enterprise scope compromise
Business scope compromise
individual UserAccount compromise
provider compromise
data residency breach
operator misuse
```

不同 scope 使用不同的 revoke、pause、communication 和 LegalHold，不批量删除或暂停无关主体。

---

# 10. Enterprise Audit / Export

## 10.1 EnterpriseAuditLog

```
EnterpriseAuditLog
├── audit_id
├── enterprise_id
├── actor
├── action
├── scope
├── object_ref
├── old / new permission or status
├── contract / policy version
├── purpose
├── timestamp
├── result
└── correlation_id
```

必须审计：

```
member invite / remove
role / scope change
Business link
Store transfer
contract change
PurchaseOrder approval
budget change
Billing contact change
security policy change
export request
support escalation
enterprise pause / resume
```

## 10.2 Enterprise Export

Export 可按：

```
Enterprise
Business
Store
Contract
Billing
Audit
```

Export 必须经过 scope、step-up、approval、redaction、download audit。不能因为 Enterprise Owner 具备高角色就获得员工个人 raw KYC、私密聊天或其他 Business 的未授权数据。

## 10.3 Legal Hold

Enterprise LegalHold 可以覆盖合同、Invoice、Order、Audit 或指定 Incident，但必须：

```
scope-bound
data-class-bound
reason-bound
approved
reviewable
access-audited
```

---

# 11. Enterprise Support / SLA Operations

## 11.1 SupportEntitlement

```
SupportEntitlement
├── entitlement_id
├── enterprise_id
├── contract_id
├── support_tier
├── channels
├── business_hours
├── severity_targets
├── named_contacts
├── escalation_path
├── language
├── region
├── effective_at
└── status
```

## 11.2 Case Scope

Enterprise Support 可以聚合与 Enterprise 相关的 Case，但每个 Case 仍保留：

```
source Business
source Store
source User / Operator scope
data classification
permission
incident severity
financial exposure
```

## 11.3 Escalation

升级顺序：

```
Business support contact
Enterprise support owner
Operations / Payments / Risk specialist
Incident Commander
Legal / Security / Executive escalation
```

Enterprise SLA 不能让 Support 直接修改 Domain state；高风险处理仍走 owned command、Case 和 Audit。

---

# 12. Enterprise Onboarding / Expansion

## 12.1 EnterpriseOnboardingProfile

```
EnterpriseOnboardingProfile
├── onboarding_id
├── enterprise_id
├── legal verification
├── market scope
├── Business links
├── Store inventory
├── member provisioning
├── role mapping
├── contract refs
├── billing setup
├── security setup
├── support setup
├── training status
├── pilot scope
├── blockers[]
├── owner
└── status: INTAKE / REVIEW / PILOT / ACTIVE / BLOCKED / CLOSED
```

## 12.2 Onboarding Gate

Enterprise Active 前必须：

```
legal entity verified
Enterprise / Business relationship approved
scope and roles mapped
Store scope confirmed
contract active
payment / billing path tested
tax profile approved
security contacts set
support entitlement active
training / runbook complete
pilot result accepted
```

## 12.3 Expansion

增加 Business、Store、Market、Role、Provider 或 Contract scope 都是 controlled expansion：

```
impact review
permission review
billing / budget review
data residency review
capacity review
support review
new effective version
audit
```

---

# 13. Enterprise Governance Cadence

## 13.1 Daily / Weekly

```
open Enterprise incidents
payment / invoice / credit exposure
approval backlog
member / permission changes
support SLA
Store / Business utilization
budget consumption
security alerts
```

## 13.2 Monthly

```
contract and SLA performance
invoice / reconciliation
credit and overdue review
Business / Store access sample
audit sample
data export / LegalHold
provider / market impact
cost allocation
```

## 13.3 Quarterly

```
contract renewal
role / permission recertification
Business relationship review
tax / legal / privacy review
security drill
DR / failover review
capacity / FinOps plan
enterprise expansion
```

---

# 14. Enterprise Pause / Suspension / Exit

## 14.1 Enterprise Pause Triggers

```
unpaid or disputed financial exposure
contract suspension
security compromise
data residency issue
critical Safety issue
fraud / abuse
repeated permission violation
provider / market outage
operator capacity exhaustion
```

## 14.2 Scope of Pause

暂停范围优先从窄到宽：

```
one user / membership
one Store
one Business
one Contract capability
one MarketCell
Enterprise new admission
Enterprise all new operations
```

既有 Order、Payout、Safety 和 LegalHold 按独立规则处理，不能因 Enterprise pause 自动全部取消。

## 14.3 Enterprise Exit

```
EnterpriseExitPlan
├── exit_id
├── enterprise_id
├── reason
├── last_new_operation_at
├── open Order handling
├── payment / invoice closeout
├── payout / refund handling
├── member / Business handoff
├── contract termination
├── export / retention / LegalHold
├── support handoff
├── final audit
└── completion_at
```

退出不等于删除交易、Invoice、Ledger、Audit、KYC decision 或 LegalHold facts。

---

# 15. Acceptance Criteria

## AC-31-01 Principal Separation

UserAccount、BusinessAccount、EnterpriseOrganization 保持独立；EnterpriseOrganization 不自动成为所有下属 Business 的交易 Principal。

## AC-31-02 No Shared Credential

Enterprise onboarding 不创建共享员工账号；成员通过自己的 UserAccount、EnterpriseMembership 和 BusinessMembership 访问。

## AC-31-03 Enterprise Scope

EnterpriseOrganization 的治理、商业、Billing、Support 和 Reporting scope 可与下属 Business / Store scope 区分。

## AC-31-04 EnterpriseBusinessRelationship

Enterprise 与 Business 的 Owned、Controlled、Affiliated、Client、Partner relationship 有类型、scope、状态、有效期和审计。

## AC-31-05 EnterpriseMembership

EnterpriseMembership 与 BusinessMembership 分离；Enterprise Admin 不能用 Enterprise role 静默获得所有 Business write permission。

## AC-31-06 Permission Calculation

Enterprise 权限由 UserAccount、Membership、Role、Scope、Principal、Ownership、Risk、Contract entitlement 和 step-up 共同计算。

## AC-31-07 Segregation of Duties

高权限成员、PurchaseOrder、Manual Adjustment、Contract Change、Export、Security Case 不允许无审批的自创建自批准。

## AC-31-08 Multi-store Isolation

Enterprise 可以获得批准的聚合视图，但不能默认读取其他 Store precise location、raw KYC、私聊、payout 或未授权 Incident。

## AC-31-09 Cross-store Task

跨 Store Task 只有一个交易 Principal，并明确 Store scope、Budget、Task Owner、Billing Owner 和 Audit。

## AC-31-10 Store Transfer

Store transfer 经过 ownership、open Order、Billing、Budget、Member、Location、Audit review；不改写历史 Order / Ledger 归属。

## AC-31-11 EnterpriseContract

合同包含 legal entity、market、Business / Store scope、pricing、volume、payment、tax、data、SLA、support、renewal、termination 和 security terms。

## AC-31-12 Contract Lifecycle

合同遵循 DRAFT、NEGOTIATING、APPROVED、ACTIVE、SUSPENDED、EXPIRED、TERMINATED 转换；合同状态不等同于 UserAccount、Business 或 Order 状态。

## AC-31-13 Contract Version

合同变更有 old/new terms、effective time、受影响对象、价格/税影响、审批、沟通和 transition / rollback 规则。

## AC-31-14 SLA Boundary

SLA 不能绕过 KYC、Capability、Funding、Safety、Location、Evidence、Payout hold 或 Privacy。

## AC-31-15 SLA Measurement

SLA 使用有版本的 start/end event、business hours、excluded states、Provider/Safety treatment 和 MetricRegistry definition。

## AC-31-16 Service Credit

Service credit 属于合同 / Billing settlement，有 Finance approval、独立 reference，不改写 Agent Earnings、Order 或 immutable Ledger fact。

## AC-31-17 PurchaseOrder

PurchaseOrder 具备 Business / Store / Contract scope、approval chain、budget、amount、currency、purpose、状态和审计。

## AC-31-18 PurchaseOrder Funding

PurchaseOrder APPROVED 不等于 FundingSecured；支付仍需 PaymentIntent、Funding authorization 和 FundingHold SECURED。

## AC-31-19 BudgetReservation

BudgetReservation 具备 scope、amount、currency、expiry、status 和 approval；不能被两个 PaymentIntent 同时消费。

## AC-31-20 Approval Policy

BusinessApprovalPolicy 支持 threshold、role、scenario、dual control、emergency rule 和 version，不改写统一 Task / Order 主链。

## AC-31-21 BillingAccount

BillingAccount 具备 legal entity、tax profile、currency、payment terms、credit、invoice contact 和状态。

## AC-31-22 Invoice Traceability

Invoice line item 可追溯到 Order、Payment、Fee、Service credit 或允许的 source；不能凭空生成应收。

## AC-31-23 Consolidated Statement

Enterprise Statement 按授权 Business / Store 聚合，并保留 source、currency、tax、period、redaction 和生成时间。

## AC-31-24 Credit Limit

CreditLimit 有 scope、currency、available、reserved、used、expiry 和 hold behavior；不自动等同于无限 Funding。

## AC-31-25 Enterprise Security

EnterpriseSecurityProfile 管理 verified domain、MFA、SSO status、provisioning、device、export、audit 和 incident contact。

## AC-31-26 SSO Boundary

SSO / SCIM / domain claim 不改变 UserAccount、KYC、AgentProfile、BusinessMembership 或 PayoutIdentity 的 Canonical truth。

## AC-31-27 Employee Offboarding

员工离职能撤销 Enterprise / Business membership、相关 session / grant，并处理 open Task ownership、Business ownership、Audit 和通知。

## AC-31-28 Enterprise Audit

成员、权限、Business link、Store transfer、合同、采购、预算、Billing、Security、Export 和 Pause 都进入 EnterpriseAuditLog。

## AC-31-29 Enterprise Export

Enterprise export 经过 scope、step-up、approval、redaction 和 download audit；不导出员工 raw KYC、私聊、token 或未授权 Business 数据。

## AC-31-30 Support Entitlement

SupportEntitlement 有 contract、tier、channel、business hours、severity target、contacts、escalation、language 和 region。

## AC-31-31 Support Scope

Enterprise Support Case 保留 Business、Store、User、data class、permission、severity 和 financial exposure，不能用聚合视图抹掉隔离。

## AC-31-32 Enterprise Onboarding

Enterprise Active 前完成 legal、relationship、scope、role、Store、contract、billing、tax、security、support、training 和 pilot。

## AC-31-33 Controlled Expansion

增加 Business、Store、Market、Role、Provider 或 Contract scope 有 impact、permission、billing、residency、capacity、support review 和新版本。

## AC-31-34 Enterprise Pause

财务、合同、安全、数据、Safety、欺诈、Provider 或容量问题可暂停窄范围；暂停不自动取消所有既有 Order。

## AC-31-35 Enterprise Exit

ExitPlan 处理 open Order、Payment、Invoice、Payout、Refund、Member、Business、Contract、Export、Retention、LegalHold、Support 和 final audit。

## AC-31-36 Enterprise Governance

Daily、Weekly、Monthly、Quarterly review 具备固定输入、owner、输出、审批、action item 和审计；规模化企业能力不能依赖口头约定。

---

# 16. P0 / P1 Boundary

## 16.1 P0

```
EnterpriseOrganization umbrella
BusinessAccount transaction Principal
Enterprise / Business / Store scope
Membership and Permission separation
multi-store approved aggregation
PurchaseOrder and approval baseline
BudgetReservation
BillingAccount / Invoice visibility
contract and SLA baseline
support entitlement / escalation
EnterpriseAuditLog
employee offboarding
enterprise pause / exit
```

## 16.2 P1

```
SSO / SCIM automated provisioning
advanced contract self-service
complex credit underwriting
full accounts receivable / payable
full procurement suite
automated tax filing
enterprise data warehouse sync
autonomous permission recertification
multi-enterprise marketplace federation
```

P1 Enterprise integrations 不能改变 P0 的 Principal、Permission、Funding、Order、Ledger、Safety、Privacy 或 Audit Invariant。

---

# 17. Locked Conclusions / Next Work

本章锁定：

```
EnterpriseOrganization 是商业 / 治理 umbrella，不是隐形交易 Account
BusinessAccount 继续作为 Task、Order、Payment 和 Billing 的 transaction Principal
EnterpriseMembership 与 BusinessMembership 分离
合同、采购、预算、SLA、Invoice 不能绕过 Funding / Order / Ledger 主链
Multi-store 聚合必须 scope-bound、redacted、audited
SSO / SCIM 不能替代 UserAccount、KYC 或 PayoutIdentity
Enterprise Pause / Exit 不能改写存量 Order、Ledger、Audit 或 LegalHold facts
```

下一步进入：

```
Chapter 32 — Enterprise API / SSO / SCIM / Integration Contract
```

Chapter 32 将把 Enterprise Principal、Membership、Contract、Procurement、Billing、SLA、Support 和 Audit 转为 API、Event、SSO / SCIM、Webhook、数据导出和外部集成契约。

