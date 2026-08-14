# Proxy PRD v1.1 — Gap Audit & Next Writing Plan

## 结论

当前 PRD 的 Domain / Marketplace Architecture 已基本完整。下一阶段不应继续横向增加新模块，而应从“架构设计”切换到：

1. Canonical consolidation
2. Page-level product specification
3. Launch catalog/configuration
4. Policy defaults
5. Privacy/security/account lifecycle
6. Executable acceptance tests
7. Provider/integration contracts
8. Launch operations

## Chapter 41 后的状态更新

本文件记录的是早期 Gap Audit；其中原先列出的 P0 写作项已经完成并分别落在 Chapter 21–41：

```text
Canonical Registry
→ P0 Screen / IA / Page Contract
→ Launch Catalog
→ Policy Defaults
→ Account Security / Privacy / Consent / Data Lifecycle
→ E2E Acceptance / Invariant Gate
→ API / Event / Schema Contract
→ Provider / Market Launch Readiness
→ Pilot Runbook / Launch Operations
→ Scale / Enterprise / Compliance / Finance Governance
→ Policy Runtime / Model Risk / AI Governance
→ AI-assisted Operations / Agentic Workflow / Delegated Action Governance
```

因此，Chapter 41 完成后不再把本文件中的旧“待写”列表当作当前 backlog。当前 backlog 切换为：

```text
Implementation
→ Contract Tests / Invariant Tests
→ Provider Certification / Reconciliation Drills
→ Pilot Operations
→ Launch Readiness
```

任何新增 PRD 只有在发现新的 canonical Domain、法律/市场变化或实现阻塞时才创建；不能为了扩展抽象而继续横向增加章节。

## P0-A — 开发前必须补齐

### 1. Canonical Registry / Consolidated Source of Truth
把 Chapter 01–20 从增量文档收成工程唯一真相：
- Canonical object registry
- Canonical status registry
- Domain event registry
- Policy registry
- Permission registry
- Data classification registry
- Chapter source-of-truth index
- Deprecated document list
- Naming conflict list
- Cross-chapter invariant list

特别处理：
- 旧版 Chapter 06A Content Sharing / Video / Live 与后来的 Basic Content Sharing
- 各章节重复出现的 Risk / Funding / Execution / Payment 状态
- Task / Slot / Order / Offer / MatchAttempt 的最终 canonical naming

### 2. P0 Screen Flow / Information Architecture / Surface Matrix
四个 Surface：
- Requester
- Agent
- Business
- Operator

每页定义：
- Page purpose
- Entry
- Fields
- Read model
- Primary / Secondary CTA
- State variants
- Empty / Loading / Error
- Permission
- Deep link
- Next state
- API dependency
- AI_EXTENSION_POINT（仅预留）

同时锁定 mobile/web surface scope。

### 3. P0 Launch Catalog / Scenario Template Pack
必须真正列出：
- Launch industries
- Launch scenarios
- Launch roles
- Atomic capabilities
- Role requirement templates
- Must / Nice defaults
- Verification requirements
- Deliverables
- Evidence requirements
- Pricing unit
- Risk class
- Check-in method
- Allowed location type
- Cancellation policy binding
- Matching policy binding

建议首发围绕：
- Business Event / Grand Opening
- Business On-site Support
角色控制在 3–5 个。

### 4. P0 Policy Defaults / Configuration Registry
目前架构定义了很多 Policy，但具体默认值还没有落地。

必须配置：
- Matching: candidate size, invite max, wave sizes, Offer TTL, matching deadline, radius expansion
- Availability: Available Now TTL, schedule rules, travel buffer
- Payment: auth timing, auto-confirm, dispute window, payout delay, refund timing
- Cancellation/No-show: phase windows, refund ratio, compensation, grace period, evidence
- Safety: KYC by scenario, high-risk threshold, private-address rules, location/contact TTL
- Notification: reminder timing, quiet hours, frequency caps

所有值必须 configurable / versioned / snapshot-bound where needed。

### 5. Account Security / Privacy / Consent / Data Lifecycle
需要独立收口：
- Signup / login / logout
- OTP / passwordless / social auth
- Session lifecycle / device management
- Account recovery / takeover
- Logout all devices
- Account deletion / export
- Consent ledger
- Marketing consent
- Location / camera / media permissions
- KYC document lifecycle
- D0–D5 retention matrix
- Data deletion exceptions / legal hold
- Block / do-not-match lifecycle
- Age eligibility architecture
- Business owner security
- Operator sensitive-data access

### 6. E2E Acceptance / Test Matrix / Invariants
Chapter 20 有 Gate，但还缺可执行测试。

至少覆盖：
- single-slot happy path
- multi-slot partial fill
- concurrent accept
- requester / agent cancellation
- requester / agent no-show
- replacement success/failure
- funding failure / auth expiry
- refund / partial refund / payout failure
- material task change / venue change
- evidence missing / auto-confirm
- dispute / safety stop / harassment
- location grant expiry
- business member removal / cross-business isolation
- operator adjustment
- duplicate webhook / command
- stale offer / retry / idempotency

每个 Case 定义 Given / When / Then / Expected Domain Events / Ledger Effect / Access Effect。

## P0-B — 工程落地前需要

### 7. Provider / Integration Contract Pack
- Payment
- KYC
- Map / route / geocoding
- Push
- Media storage / video
- Email / SMS if enabled

定义 adapter / webhook / idempotency / timeout / retry / degraded mode / outage / reconciliation。

### 8. API / Event / Read-model Master Contract
统一：
- endpoint registry
- command registry
- domain event catalog
- read model catalog
- error taxonomy
- idempotency
- versioning
- pagination
- auth/principal context
- rate limit / abuse handling

## Launch 前必须补

### 9. Cold-start / Marketplace Operations Playbook
- launch geo cell
- agent seed target by role/time/geo
- anchor business target
- recruiting / verification SOP
- availability activation
- business onboarding
- operator coverage
- match rescue / replacement / incident SOP
- liquidity opening criteria
- pilot graduation gate

### 10. Commercial Policy / Unit Economics
- service fee
- earnings floor
- travel allowance
- urgent premium
- PSP cost
- refund/cancellation cost
- business discount
- promotion subsidy
- later Boost pricing
- contribution margin per successful slot

### 11. Market-specific Legal / Compliance Pack
首发市场确定后，结合专业法律/支付/税务意见完成：
- worker classification
- platform terms
- KYC / AML
- payment licensing
- tax / VAT / invoice
- payout reporting
- insurance
- prohibited services
- privacy / consent
- content / image rights
- dispute terms
- minors / age eligibility
- emergency obligations

## P1 / Later，不阻塞 MVP
- Full AI Harness / Copilot
- Social cross-post
- Advanced content recommendation
- Native live
- Full Membership UI
- Earn → Spend wallet
- Advanced Merchant OS
- Reservation / Storefront / CRM
- Scene / CCTV Network
- Learning-to-rank
- AI pricing
- Advanced fraud ML
- Demand forecasting
- Advanced heatmap
- Referral / growth automation

## 推荐写作顺序
1. v1.1 Canonical Registry / Source-of-Truth Index
2. Chapter 21 — P0 Screen Flow / IA / Page-level Product Spec
3. Chapter 22 — P0 Launch Catalog / Scenario & Role Template Pack
4. Chapter 23 — Policy Defaults / Configuration Registry
5. Chapter 24 — Account Security / Privacy / Consent / Data Lifecycle
6. Chapter 25 — E2E Acceptance / Test Matrix / Invariant Gate
7. Engineering Spec — Provider / API / Event Contracts
8. Launch Operations Playbook

## 最重要判断
现在 Proxy 不缺更多概念，缺的是把 abstract architecture 变成 executable product contract：

Canonical Truth
→ Screens
→ Launch Catalog
→ Concrete Policies
→ Test Cases
→ Engineering Contracts
→ Pilot
