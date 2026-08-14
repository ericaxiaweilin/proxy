# Proxy PRD v1.1
## Chapter 28 — Pilot Runbook / Launch Operations / Incident Drill

**文档类型**：Pilot Runbook / Launch Day Operations / Incident Response / Rollback Drill  
**状态**：ACTIVE — Pilot Operations v1  
**前置依赖**：Canonical Registry、Chapter 20–27、MarketLaunchProfile、PSET_LAUNCH_V1  
**后续依赖**：Post-Pilot Scale / Governance、Implementation SLO、持续 Legal / Provider Review

---

# 0. 本章目标

本章把 Chapter 27 的 Go/No-Go、Pause Level、Reconciliation、Support 和 Rollback 变成可执行的运行手册：

```
Launch preparation
Launch Day timeline
Command Center
On-call / escalation
Controlled ramp
Hourly operating loop
Provider incident drill
Payment / KYC / Geo / Media / Notification recovery
Market pause / rollback
User / Business / Operator communication
Post-Pilot review
```

运行原则：

```
先保护不可逆事实，再恢复流量
先停止新风险，再处理存量业务
不以 UI 正常掩盖 Provider / Ledger / Privacy 异常
不通过数据库回滚覆盖历史事实
每个决定都有 owner、时间、依据和下一次复核
```

---

# 1. Runbook Constitution

## 1.1 Pilot 不是隐形生产

Pilot 必须有显式：

```
pilot_cohort_id
market_id
policy_set_id / version
provider connection versions
start / end time
support channel
on-call roster
volume guardrails
pause authority
rollback target
```

真实用户、Business、资金和敏感数据进入 Pilot 后，必须按 Production-grade 的审计、隐私、结算和安全标准处理。

## 1.2 四个不可跨越的事实

运行人员不得为了让看板恢复绿色而改变：

```
Payment / Ledger fact
Order / Slot fact
KYC decision history
Security / Privacy / Audit fact
```

允许的修复方式只有：

```
owned command
reconciliation
compensating command
authorized hold / release
new correction event
manual case with dual control
```

## 1.3 Stop the Line

以下任一情况可以由当班 Incident Commander 立即暂停新流量：

```
duplicate charge / refund / payout
oversold atomic Slot
raw secret or raw KYC exposure
cross-principal data access success
expired Operator grant still grants access
KYC false verification
unknown payment result with repeat-charge risk
critical safety notification cannot be delivered
LegalHold data deletion
```

暂停后再补齐 Legal、Finance、Privacy、Safety 或 Product approval；不能反过来等待审批造成继续暴露。

---

# 2. Operating Model

## 2.1 Command Center Roles

| Role | 责任 | 可以决定 |
|---|---|---|
| Incident Commander | 统一判断、暂停、升级、恢复 | Pause level、owner、下一次复核 |
| Product Lead | 用户体验、Launch scope、业务取舍 | 是否缩小场景 / cohort |
| Engineering Lead | Domain、部署、回滚、数据完整性 | 技术修复、traffic drain |
| Payments Lead | Funding、Refund、Payout、Reconciliation | Payment rail hold / release |
| Risk / Safety Lead | KYC、Incident、Block、Safety | Safety hold、人工 review |
| Privacy / Security Lead | D4/D5、Consent、Secret、越权 | 数据访问冻结、Security incident |
| Operations Lead | Support、Operator Case、值班调度 | 人工接管、case 分派 |
| Provider Owner | 单一 Provider 健康、供应商沟通 | Provider-specific mitigation |
| Scribe | 时间线、决定、证据、action item | 记录，不替代决策 owner |

一个人可以兼任多个角色，但 Incident Commander 与高风险修复执行者最好分离；Finance manual adjustment 的申请人不能兼任批准人。

## 2.2 On-call Roster

```
primary
secondary
specialist: payment
specialist: KYC / risk
specialist: privacy / security
specialist: infrastructure
operations / support
executive escalation
```

每个角色必须有 name、team、timezone、contact channel、acknowledgement SLA、handoff backup 和 decision authority。

## 2.3 Severity

| Severity | 说明 | 默认响应 |
|---|---|---|
| SEV-0 | 安全、资金、全市场不可安全运行 | 立即 Level 4 pause，15m 内 IC |
| SEV-1 | P0 主链路或 Provider 大面积失败 | Level 2–3，15m 内确认影响范围 |
| SEV-2 | 单能力降级，有安全 fallback | Level 1，30m 内 owner 与缓解 |
| SEV-3 | 非 P0 体验或单用户问题 | 正常 Support / backlog |

## 2.4 LaunchIncident

```
LaunchIncident
├── incident_id
├── severity
├── market_id
├── pilot_cohort_id optional
├── started_at
├── detected_at
├── detected_by
├── affected_provider / operation
├── affected_object_count
├── money_exposure optional
├── privacy_exposure optional
├── safety_exposure optional
├── pause_level
├── incident_commander
├── current_hypothesis
├── mitigation
├── rollback_target optional
├── communication_status
├── status: OPEN / MITIGATING / MONITORING / RESOLVED / POSTMORTEM
└── next_update_at
```

---

# 3. Runbook Objects / Shift Handoff

## 3.1 PilotRunbook

```
PilotRunbook
├── runbook_id
├── market_id
├── pilot_cohort_id
├── launch_version
├── policy_snapshot
├── provider_connections[]
├── ramp_stages[]
├── guardrails[]
├── on_call_roster_ref
├── rollback_plan_ref
├── communication_plan_ref
├── approved_by[]
├── effective_at
└── status
```

## 3.2 LaunchDecision

```
LaunchDecision
├── decision_id
├── market_id
├── stage
├── decision: GO / HOLD / PAUSE / ROLLBACK / RESUME
├── evidence_refs[]
├── open_blockers[]
├── approver_refs[]
├── decided_at
├── review_at
└── rationale
```

## 3.3 Shift Handoff

交班必须包含：

```
current pause level
active incidents
open ReconciliationCase
unknown Payment / Payout operation
pending KYC manual review
stale Geo / Media / Notification backlog
active LegalHold / Security case
current ramp stage
guardrail consumption
last known good config
next scheduled check
```

没有完成交班记录时，下一班不能假定没有异常。

---

# 4. Pre-Launch Timeline

## 4.1 T-14 to T-7 Days

必须完成：

```
MarketLaunchProfile = APPROVED
Legal / Privacy / Tax / KYC / Safety approvals
ProviderConnection production references approved
PSET_LAUNCH_V1 version frozen
Chapter 25 P0 acceptance green
Chapter 26 contract tests green
payment / payout reconciliation dry run
KYC manual review path
support language / hours
on-call roster
rollback target
```

输出：

```
Launch Readiness Review
Open blocker list
owner / due date
last known good artifact
```

## 4.2 T-72 to T-24 Hours

```
freeze launch scope
freeze provider connection versions
rotate / verify production secrets
verify webhook signature keys
verify alert routing
verify dead-letter and outbox replay
verify retention job is scoped safely
verify pilot cohort membership
verify Terms / Privacy / Consent versions
verify backup / restore confidence
run support dry run
```

任何生产配置变化必须生成 ConfigChange record，并注明是否需要重新 Go/No-Go。

## 4.3 T-2 Hours

| 检查 | 通过条件 |
|---|---|
| Provider health | 所有 P0 connection 可调用或有 approved fallback |
| Payment | controlled probe 与对账一致 |
| KYC | test attempt、callback、manual case 可追踪 |
| Geo | geocode、route、approx fallback 正常 |
| Media | upload、scan、delete probe 正常 |
| Notification | OTP、Inbox、critical fallback probe 正常 |
| Domain | outbox、projector、idempotency、read model 无阻塞 |
| Security | secret scan、D4/D5 audit、JIT expiry 通过 |
| Operations | IC、on-call、support、scribe 已 ack |

## 4.4 T-30 Minutes / Launch Lock

```
no unapproved deployment
no unreviewed provider config
no manual database mutation
no unapproved cohort change
all dashboards pinned
all escalation channels tested
launch decision recorded
```

如果任何 P0 check 未完成，决策只能是 HOLD，不能边上线边补。

---

# 5. Launch Day Timeline

## 5.1 Stage 0 — Shadow / No User Traffic

时间：T0–T+30m。

动作：

```
enable dashboards and alerts
run synthetic command probes
receive provider callbacks
verify read model freshness
verify no real money side effect in probe
verify audit / correlation trace
```

进入 Stage 1 的条件：

```
all probes green
no unowned alert
no unexpected provider callback
no schema / policy drift
IC GO recorded
```

## 5.2 Stage 1 — Internal / Controlled Operators

时间：T+30m–T+90m。

只允许内部 approved actors 创建有限 Draft、Availability、Quote 和非高风险 test path。禁止真实 payout 或不可逆高额资金动作，除非 Launch approval 明确允许。

观察：

```
command accept / reject
aggregate version conflict
Offer expiry
Slot lock
read model freshness
notification delivery
provider latency / timeout
```

## 5.3 Stage 2 — First Pilot Cohort

时间：T+90m–T+4h。

动作：

```
enable smallest approved cohort
enable limited scenario / role templates
keep manual review for P0 exceptions
run hourly reconciliation
review every guardrail
send controlled user communication
```

不得在 Stage 2 直接打开全部市场容量。

## 5.4 Stage 3 — Controlled Ramp

只有 Stage 2 完成观察窗口且无 P0 blocker 时，才按批准比例扩大：

```
cohort percentage
Task admission cap
active Agent cap
Order cap
payment volume cap
payout cap
notification cap
```

每次 ramp 必须创建新的 LaunchDecision，记录 metrics、open incidents 和 review time。

## 5.5 Stage 4 — Pilot Active

Pilot Active 仍需：

```
daily reconciliation
on-call coverage
guardrail monitoring
incident review
privacy / security access review
user feedback review
provider health review
```

ACTIVE 不等于 unlimited。Pilot volume cap 未解除前，仍按 pilot guardrail 执行。

---

# 6. Hourly Operating Loop

每小时由 Operations Lead 组织一次 15 分钟 review：

```
1. current stage / pause level
2. new Orders / cancellations / no-shows
3. funding / refund / payout status
4. KYC pending / rejected / manual review
5. provider latency / timeout / callback gap
6. Slot conflict / Offer expiry / revalidation
7. notification failure / safety alert
8. D4 / D5 access and privacy alerts
9. guardrail consumption
10. next action / owner / due time
```

## 6.1 Hourly Dashboard Minimum

```
active Users / Agents / Businesses
Tasks published
Offers created / accepted / expired
Orders created / in progress / completed
Funding secured / failed / unknown
Refund / Payout pending / held / paid
KYC processing / manual review
Provider error and callback lag
read model staleness
Safety / dispute / support cases
notification delivery
privacy / security alerts
```

## 6.2 Guardrail Thresholds

阈值由 MarketLaunchProfile 或 Launch approval 固化；没有批准数值时，采用保守默认并标记 GUARDRAIL_UNCONFIRMED，不能静默放大。

达到阈值后：

```
stop new admission or slow ramp
allow safe completion of existing Orders
hold high-risk money operations if needed
notify IC
create LaunchIncident or GuardrailCase
review at scheduled time
```

---

# 7. Provider Incident Drills

## 7.1 Drill Contract

每次演练必须标记：

```
DRILL only / production-impacting
injected fault
expected pause level
expected user state
expected provider state
expected Domain state
expected communication
success criteria
cleanup
```

生产环境演练只允许注入经过批准、可恢复的故障，不能使用真实扣款、真实 Government ID 或破坏性删除。

## 7.2 Payment Unknown Result Drill

### Given

```
PaymentIntent is AUTHORIZING
provider response times out
client retries AcceptOffer
provider may have accepted operation
```

### When

```
inject timeout
redeliver provider callback late
run retry worker
request reconciliation
```

### Then

```
no second authorization with a new idempotency key
Order remains pending / not executable until FundingSecured
provider reference is queried / reconciled
user sees pending payment state
incident / case is traceable
final ledger has one or zero money effect, never two
```

## 7.3 Duplicate Charge / Payout Drill

注入重复 provider event 或模拟 duplicate command：

```
consumer dedupe
no second Ledger entry
Payout remains one operation
Finance case created if provider reports two operations
affected rail can be paused
user communication is factual
```

## 7.4 KYC Callback Gap Drill

```
new verification is PROCESSING
callback delivery is delayed / duplicated
user retries submit
```

预期：

```
attempt idempotency
no false VERIFIED / REJECTED
manual review or bounded polling
safe user CTA
raw document retention unchanged
old attempt cannot update new attempt
```

## 7.5 Geo Stale / Unavailable Drill

```
route provider returns stale ETA
location grant is expired
Agent requests Check-in
```

预期：

```
stale result marked stale
precise location read rejected after grant expiry
Check-in rejected or sent to exception
no invented ETA
no additional location scope
existing Order remains intact
```

## 7.6 Media Scan Failure Drill

```
Evidence upload reaches UPLOADED
scan provider times out or rejects
Agent requests CompleteOrder
```

预期：

```
Evidence is not SAFE / complete
Order cannot silently complete
retry or manual review path exists
raw media stays scoped and retained
user sees missing / pending evidence state
```

## 7.7 Critical Notification Failure Drill

```
Safety or payment notification primary channel fails
user has verified fallback channel and Inbox
```

预期：

```
retry within policy
approved fallback attempted
Inbox item created
critical undelivered alert escalated
marketing consent is not used to justify safety delivery
OTP is never logged
```

## 7.8 Privacy / Secret Exposure Drill

只在 sandbox / controlled environment 注入：

```
attempt to serialize provider secret
attempt D5 read with expired JIT
attempt cross-Business object id
attempt export with raw token
```

预期：

```
request denied
no sensitive value returned or logged
security audit created
alert / case created
operator cannot bypass with UI retry
```

---

# 8. Pause / Rollback Operations

## 8.1 Pause Decision

Pause command 需要：

```
incident_id or guardrail_case_id
market_id
scope: PROVIDER / OPERATION / COHORT / MARKET
pause_level
reason
effective_at
owner
review_at
allowed_existing_actions
blocked_new_actions
```

## 8.2 Scope

| Scope | 示例 | 仍允许 |
|---|---|---|
| Provider | Payment rail | 查账、reconcile、必要退款 review |
| Operation | Payout | 已有 Order execution、Support |
| Cohort | 某 Pilot group | 安全查看、通知、必要退款 |
| Market | 首发市场 | approved safety / support / legal actions |

暂停范围必须尽可能窄；但如果无法证明范围，按更大范围保护用户和资金。

## 8.3 Existing Order Rule

暂停新 admission / matching / funding 不等于自动取消既有 Order。每个既有 Order 逐一判断：

```
safe to continue
needs revalidation
needs Safety hold
needs Payment hold
needs replacement
needs manual contact
```

## 8.4 Rollback

Rollback 前必须确认：

```
what is being rolled back: code / config / provider / cohort
last known good version
in-flight operation list
unknown payment list
open ReconciliationCase
user communication copy
read model compatibility
schema migration safety
owner and approval
```

Rollback 后必须：

```
re-run health probes
reconcile all in-flight operations
review Ledger / Order invariants
review D4 / D5 access
re-enable only by new LaunchDecision
```

禁止直接回滚数据库覆盖 Ledger、删除 callback 记录、把 UNKNOWN 强行改成 FAILED、把已支付 Order 改回未支付，或批量删除 Evidence 清理故障。

---

# 9. Communication Runbook

## 9.1 Internal Update

每次 15 / 30 分钟更新包含：

```
What happened
What is affected
What is not affected
Current pause level
What we are doing
User / money / privacy impact
Next update time
Owner
```

## 9.2 User-facing Status

只说已确认事实：

```
Payment is still being confirmed
Verification is under review
Location service is temporarily unavailable
Evidence is still processing
Some new requests are temporarily paused
```

不得说 provider internal error detail、internal fraud threshold、other user identity、secret、raw KYC 或未确认退款 / payout 成功。

## 9.3 Communication Priority

```
Safety / security
Payment / payout
Order execution
KYC / account
General product
Marketing
```

高优先级消息由 Operations / Safety owner 确认后发送；不能为了减少 Support ticket 隐瞒资金或安全影响。

---

# 10. Support / Operator Operations

## 10.1 Case Routing

| Case | Owner | 默认动作 |
|---|---|---|
| Payment unknown / mismatch | Payments | Hold、reconcile、用户状态说明 |
| KYC pending / rejected | Risk / KYC | safe reason、manual review、resubmit |
| Location unsafe / stale | Safety + Geo | deny precise action、manual decision |
| Evidence scan failure | Execution + Media | retry / review、阻止错误完成 |
| Notification critical failure | Operations | fallback、Inbox、escalation |
| Account takeover | Security | revoke sessions、recovery hold |
| Privacy / D5 access | Privacy / Security | freeze access、preserve audit |
| Cross-Business access | Identity / Business | deny、scope audit、incident review |

## 10.2 Operator Guardrails

Operator 只能：

```
view scoped case
send approved communication
create authorized compensation / adjustment request
place / release approved hold
request reconciliation
execute approved operational command
```

Operator 不能：

```
impersonate user
accept Offer as Agent
modify immutable Ledger fact
read raw secret
extend expired JIT silently
delete LegalHold data
override market approval alone
```

## 10.3 Manual Adjustment

P0 manual financial adjustment：

```
requester creates reasoned request
Finance second approver reviews
system checks no self-approval
PostManualAdjustment emits Ledger event
user-facing statement includes correction reference
```

---

# 11. Daily Pilot Operations

## 11.1 Start-of-day

```
review overnight incidents
review payout / refund / funding reconcile
review KYC backlog
review provider health and callback lag
review retention / deletion jobs
review support SLA
confirm guardrail remaining capacity
confirm on-call acknowledgement
```

## 11.2 End-of-day

```
close or hand off incidents
reconcile all money operations
review unknown / pending operations
review active Safety / LegalHold
review D4 / D5 access audit
export pilot metrics snapshot
record user-impacting communications
confirm next-day provider capacity
```

未完成的资金、Safety、Privacy、KYC case 不能仅在日报中标记待跟进，必须有 owner 和 next action time。

---

# 12. Post-Pilot Review

## 12.1 Exit Conditions

Pilot 结束或进入下一阶段前：

```
all Order states resolved or explicitly handed over
Funding / Refund / Payout reconciled
no unknown money operation without owner
KYC pending cases handled or retained under policy
active incidents resolved or accepted with owner
Privacy / D4 / D5 review completed
Provider usage and contract limits reviewed
pilot data retention / deletion plan queued
support feedback reviewed
metrics snapshot immutable
```

## 12.2 PostPilotReview

```
PostPilotReview
├── review_id
├── market_id
├── pilot_cohort_id
├── launch_version
├── period
├── success_metrics
├── incident_summary
├── provider_summary
├── money_reconciliation_summary
├── privacy / security summary
├── support summary
├── open_risks[]
├── decision: SCALE / EXTEND / PAUSE / RETIRE
├── owners[]
├── due_dates[]
└── approved_at
```

## 12.3 Scale Decision

SCALE 只有当：

```
P0 invariants remain green
no unresolved duplicate money effect
no unresolved privacy / security breach
provider reconcile stable
support and on-call capacity adequate
market approvals still valid
guardrails can scale safely
```

数据不足但安全时只能 EXTEND Pilot；需要修复或审批时 PAUSE；市场、Provider、Legal 或产品策略不再支持时 RETIRE 并按 retention closeout。

---

# 13. Acceptance Criteria

## AC-28-01 Pilot Explicitness

Pilot 具备 cohort、market、policy version、provider version、时间、support、on-call、guardrail 和 rollback reference。

## AC-28-02 Stop-the-line

SEV-0 资金、隐私、身份、越权、Slot 或 Safety 异常可由 Incident Commander 立即暂停，不等待全员审批。

## AC-28-03 Role Coverage

Launch Day 有 IC、Engineering、Payments、Risk/Safety、Privacy/Security、Operations、Provider owner、Scribe 和 backup。

## AC-28-04 Incident Record

每个 Incident 记录 severity、market、affected operation、影响数量、资金 / 隐私 / 安全暴露、pause level、owner、next update。

## AC-28-05 Shift Handoff

交班包含 pause、incident、reconcile、unknown money、KYC、Provider backlog、LegalHold、ramp stage、guardrail 和下一次检查。

## AC-28-06 T-14 Readiness

Launch 前完成 Market、Legal、Privacy、Tax、KYC、Safety、Provider、Chapter 25/26、Support、On-call 和 rollback sign-off。

## AC-28-07 T-24 Freeze

Launch 前 24 小时冻结 scope、Provider connection、policy、secret / webhook verification、cohort、consent copy 和 alert routing。

## AC-28-08 T-2 Probe

T-2 小时完成 Payment、KYC、Geo、Media、Notification、Domain、Security、Operations probes；任何 P0 未通过只能 HOLD。

## AC-28-09 Launch Lock

T-30 分钟后无未审批 deployment、Provider config、cohort change、manual DB mutation；LaunchDecision 已记录。

## AC-28-10 Stage 0

Shadow 阶段只运行无真实不可逆副作用的 probes，并验证 health、callback、read model、audit 和 correlation。

## AC-28-11 Stage 1

Internal 阶段只允许 approved actor 和有限操作；可观察并发、Offer expiry、Slot lock、read-model freshness 和 Provider latency。

## AC-28-12 Stage 2 Cohort

First Pilot Cohort 按最小批准范围开放，P0 exception 保持 manual review，逐小时检查 reconciliation 和 guardrail。

## AC-28-13 Controlled Ramp

每次 ramp 创建 LaunchDecision，记录 cohort、Task、Agent、Order、payment、payout、notification 上限和 review time。

## AC-28-14 Hourly Loop

每小时 review 覆盖订单、资金、KYC、Provider、Match、通知、隐私、安全、Support 和 guardrail。

## AC-28-15 Guardrail

达到容量或风险阈值时能停止 admission / slow ramp，同时允许安全处理已有 Order。

## AC-28-16 Payment Unknown Drill

Payment timeout、late callback、client retry 场景不会二次扣款；Order pending、reconcile、最终 Ledger effect 可证明。

## AC-28-17 Duplicate Money Drill

重复 charge / refund / payout event 只产生一次 Ledger effect；异常时能暂停 rail 并创建 Finance case。

## AC-28-18 KYC Callback Drill

Callback gap、duplicate、stale、retry 不产生 false VERIFIED / REJECTED；attempt lineage 和 manual review 可追踪。

## AC-28-19 Geo Drill

Stale route、expired location grant、Check-in 请求会安全拒绝或转 exception，不展示虚构 ETA 或扩大位置范围。

## AC-28-20 Media Drill

Scan timeout / reject 时 Evidence 不能完成；Order 不会错误结算；retry / manual review 存在。

## AC-28-21 Notification Drill

Critical notification 主渠道失败时有 retry、approved fallback、Inbox 和 Operator escalation；OTP 不写日志。

## AC-28-22 Privacy Drill

D5 过期 grant、cross-Business IDOR、raw token export 等测试均拒绝、无敏感返回、可审计并告警。

## AC-28-23 Pause Scope

Pause 可限定 Provider、Operation、Cohort 或 Market；范围不明确时按更大范围保护资金和用户。

## AC-28-24 Existing Order

暂停新 admission / funding 不会批量取消既有 Order；每个存量 Order 有 continue / revalidate / hold / replacement / manual decision。

## AC-28-25 Rollback Safety

Rollback 前列出 in-flight、unknown payment、reconcile、schema、communication、last known good 和 approval；rollback 后重新跑 probes。

## AC-28-26 Communication

内部更新有事实、影响、当前 pause、动作、owner 和 next update；外部文案不泄露 secrets、fraud rule 或未确认成功。

## AC-28-27 Support Routing

Payment、KYC、Geo、Media、Notification、Account takeover、Privacy、Cross-Business case 都有明确 owner 和默认动作。

## AC-28-28 Operator Boundary

Operator 只能执行 scoped、approved、audited command；不能 impersonate、改写 Ledger、读 raw secret、延长 JIT 或删除 hold 数据。

## AC-28-29 Manual Adjustment

P0 手工财务调整具备 request、second approval、self-approval rejection、Ledger event 和 correction reference。

## AC-28-30 Daily Reconciliation

每日开始和结束运行 Payment、Refund、Payout、KYC backlog、Provider callback、Safety、Privacy、Support review，并保留 snapshot。

## AC-28-31 Pilot Exit

Pilot 退出前所有 Order、资金、KYC、Incident、Privacy、Provider 和 Support 状态均 resolved 或明确 handoff。

## AC-28-32 PostPilotReview

PostPilotReview 包含成功指标、Incident、Provider、Money、Privacy/Security、Support、风险、owner、due date 和 SCALE / EXTEND / PAUSE / RETIRE 决策。

## AC-28-33 Scale Gate

只有 P0 invariants、资金 reconciliation、Privacy/Security、Provider 稳定性、Support capacity 和市场审批全部通过才可 SCALE。

## AC-28-34 Extend Gate

数据不足但无 P0 blocker 时只能 EXTEND Pilot，不能无审计地扩大流量。

## AC-28-35 Retire Safety

RETIRE 保留历史 Order、Ledger、KYC decision、Audit 和 LegalHold facts，按 retention / deletion 规则 closeout。

## AC-28-36 Runbook Version

Runbook、LaunchDecision、Incident、PostPilotReview 都有 version、policy/provider references、approver 和时间，不能用口头变更替代记录。

---

# 14. P0 / P1 Boundary

## 14.1 P0

```
Command Center and on-call
Launch Day Stage 0–4
hourly guardrail review
Payment unknown / duplicate money drill
KYC callback gap drill
Geo stale / expired grant drill
Media scan failure drill
critical notification fallback drill
privacy / secret / cross-principal drill
pause / rollback
existing Order protection
support routing
daily reconciliation
Pilot exit and PostPilotReview
```

## 14.2 P1

```
automated multi-region command center
fully automatic scale decision
predictive incident detection
multi-market simultaneous launch
automated vendor renegotiation
advanced chaos testing in production
```

P1 运行自动化不能替代 P0 的人类决策、资金对账、Privacy 审计或 Safety escalation。

---

# 15. Locked Conclusions / Next Work

本章锁定：

```
Pilot 是显式、可审计、有限流量的生产级运行
Launch 采用 Shadow → Internal → Cohort → Controlled Ramp → Active
任何资金、隐私、身份、越权、Slot、Safety blocker 都可 Stop-the-line
Pause 尽量窄，但安全不确定时按更大范围保护
Rollback 保留 Domain facts，不用数据库快照覆盖 Ledger
每小时运行 loop 连接 Provider、Order、Money、Privacy、Support
Pilot 结束必须有 PostPilotReview 和 SCALE / EXTEND / PAUSE / RETIRE 决策
```

下一步进入：

```
Chapter 29 — Post-Pilot Scale / Governance / Continuous Readiness
```

Chapter 29 将把 Pilot 结果转成规模化准入、持续 Provider / Legal / Policy review、SLO、变更治理和多市场扩展门禁。

