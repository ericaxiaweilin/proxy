# Proxy PRD v1.1
## Chapter 30 — Scale Architecture / Capacity / FinOps / Multi-Region Readiness

**文档类型**：区域架构 / 数据分区 / 灾备与切换 / 容量模型 / FinOps / Multi-region Readiness  
**状态**：ACTIVE — Scale Architecture v1  
**前置依赖**：Canonical Registry、Chapter 26、Chapter 27、Chapter 28、Chapter 29、MarketLaunchProfile、SLOProfile  
**后续依赖**：Chapter 31 Enterprise / B2B Scale / Contract Governance、Implementation Architecture、持续 Provider / Market Review

---

# 0. 本章目标

本章把 Chapter 29 的规模治理落到可运行的架构边界：

```
Region / Market Cell topology
Data residency and partitioning
Aggregate write ownership
Consistency classes
Read / write routing
Multi-region failover
Backup / restore / disaster recovery
Capacity planning and backpressure
Queue / worker / provider quota
FinOps allocation and budget
Multi-region launch gate
Resilience drills
```

本章不把“多 Region”当成自动复制全部数据，也不把“高可用”当成所有动作都可跨区同时写入。安全规则优先：

```
one canonical writer for each money / order / identity aggregate
no split-brain Ledger
no duplicate PaymentIntent operation
no cross-region raw D5 replication by default
read models may rebuild from approved facts
failover requires fencing, epoch and reconciliation
capacity limits protect safety and money
cost controls cannot remove P0 controls
```

---

# 1. Scale Architecture Constitution

## 1.1 Scale by Boundaries

扩容优先扩大：

```
owned Context
aggregate partition
queue class
read model projector
provider connection
market cell
operator capacity
```

不得用一个共享数据库、一个全局队列或一个超级 Service 解决所有规模问题。

## 1.2 Availability Does Not Mean Concurrent Truth

允许：

```
multi-region read
multi-region stateless API
regional matching
regional notification
rebuildable analytics
replicated encrypted backups
```

不允许未经明确一致性协议同时写入：

```
same PaymentIntent
same FundingHold
same Payout
same Order
same TaskSlot
same UserAccount security state
same KYC Attempt
same LegalHold
same Ledger aggregate
```

## 1.3 Home Ownership

每个跨区对象必须有：

```
home_region
home_market
write_epoch
owner_context
failover_policy
```

对象发生跨区迁移时，先完成 fencing 和 ownership transfer，再接受新写入。不能通过“两个 Region 都写，最后取较新时间”解决冲突。

## 1.4 Degraded Is a First-class State

Region、Market Cell、Provider、Queue 和 Capability 都必须能进入 degraded：

```
继续安全读取
暂停不可逆写入
保留已有 Order 的安全处理
创建 ReconciliationCase
显示 pending / unavailable
按 Runbook 升级
```

系统宁可明确降级，也不能返回伪造成功。

---

# 2. Regional Topology

## 2.1 Region

```
Region
├── region_id
├── provider_zone
├── cloud / runtime boundary
├── data_residency_zone
├── supported_market_ids[]
├── status: PROVISIONING / ACTIVE / DEGRADED / DRAINING / PAUSED / RETIRED
├── capacity_profile_ref
├── DRProfile_ref
├── operational_owner
├── effective_at
└── retired_at optional
```

## 2.2 MarketCell

```
MarketCell
├── market_cell_id
├── market_id
├── primary_region
├── secondary_region optional
├── supported_scenarios[]
├── supported_roles[]
├── provider_connections[]
├── policy_set_id / version
├── data_residency_rule_ref
├── traffic_state: OFF / SHADOW / PILOT / LIMITED / ACTIVE / PAUSED
├── capacity_profile_ref
├── support_roster_ref
└── effective_at
```

MarketCell 是产品与运行边界；一个市场可以有多个 Cell，但每个 Cell 必须明确：

```
which users can enter
which Provider connection is used
which region owns writes
which support queue receives cases
which policy snapshot applies
which data can cross the boundary
```

## 2.3 DataResidencyZone

```
DataResidencyZone
├── residency_zone_id
├── permitted_regions[]
├── prohibited_regions[]
├── allowed_data_classes[]
├── transfer_basis_ref
├── encryption_requirement
├── retention_rule_ref
├── approved_by[]
└── effective_at
```

## 2.4 TrafficRoute

```
TrafficRoute
├── route_id
├── market_cell_id
├── audience_scope
├── primary_region
├── fallback_region optional
├── routing_mode: STICKY / HEALTH_BASED / MANUAL
├── write_epoch
├── health_conditions[]
├── effective_at
└── approval_ref
```

Traffic routing 不得只根据网络距离决定写入 Region；必须同时检查 MarketCell、home ownership、data residency、Provider capability 和 write epoch。

---

# 3. Region Lifecycle / Ownership

## 3.1 Region Status

```
PROVISIONING
ACTIVE
DEGRADED
DRAINING
PAUSED
RETIRED
```

## 3.2 Region Transitions

```
PROVISIONING → ACTIVE after readiness checks
ACTIVE → DEGRADED on health / capacity / provider issue
ACTIVE → DRAINING before planned migration
DEGRADED → PAUSED when safe writes cannot be guaranteed
DRAINING → RETIRED after in-flight closeout
PAUSED → ACTIVE only after new decision and fencing validation
```

## 3.3 RegionOwnershipBinding

```
RegionOwnershipBinding
├── binding_id
├── aggregate_type
├── aggregate_id or partition
├── home_region
├── write_region
├── write_epoch
├── lease_or_fence_ref
├── transfer_state
├── transferred_at optional
└── audit_ref
```

Ownership transfer必须：

```
stop old writer
fence old epoch
flush or classify in-flight commands
verify replicated facts
activate new epoch
run reconciliation
record decision
```

---

# 4. Data Partitioning / Residency

## 4.1 Data Classes by Replication Safety

| 数据类别 | 默认归属 | 跨区复制 |
|---|---|---|
| D0 public aggregate | market / global read store | 可复制聚合结果 |
| D1 task context / candidate snapshot | MarketCell | 按 purpose 复制必要摘要 |
| D2 profile / portfolio | home region / residency | 按 approved transfer |
| D3 transaction / ledger reference | home market region | 加密复制必要灾备事实 |
| D4 precise location / execution trajectory | execution region / residency | 默认不跨区复制 raw |
| D5 KYC / payout identity | residency-approved region | 默认不跨区复制 raw |
| Security / Operator audit | approved audit zone | 加密、受控、不可篡改 |

## 4.2 Global vs Regional Objects

### Global or Federated Reference

```
Industry
Scenario
Role
Capability definition
Policy schema
Provider contract schema
Metric definition
```

这些对象可以全球发布，但每个 MarketCell 仍需绑定版本。

### Regional / Market-owned Fact

```
UserAccount security state
Business membership
Task
TaskSlot
Offer
Order
PaymentIntent
FundingHold
Payout
KYC attempt
Consent
LegalHold
Precise location
Operator case
```

## 4.3 Raw Data Boundary

默认禁止把以下内容复制到不在 residency approval 内的 Region：

```
raw Government ID
biometric / liveness artifact
full payout credential
raw session token
precise home / live location
unredacted incident reporter data
provider secret
```

跨区需要的是 masked reference、decision、hash、audit reference 或 approved aggregate，不是 raw secret。

## 4.4 Partition Key

Canonical partition key 至少包含：

```
market_id
market_cell_id
home_region
principal_id where relevant
aggregate_id
data_class
```

不能只按 user_id 分区而忽略 Business、Order、Market 和 residency。

---

# 5. Consistency / Routing Contract

## 5.1 Consistency Classes

| Class | 示例 | 默认要求 |
|---|---|---|
| C0 Strong single-writer | Ledger、PaymentIntent、TaskSlot、Order | 单写入归属 + version / fencing |
| C1 Regional transactional | Task、Offer、Availability、KYC Attempt | Region 内事务一致，跨区事件化 |
| C2 Session / security | Session revoke、Consent、Operator grant | 低延迟传播；敏感动作重新向 owner 校验 |
| C3 Rebuildable read | Home、Map heat、Candidate summary | 最终一致，带 freshness |
| C4 Analytics | scorecard、experiment aggregate | 延迟可接受，版本化查询 |

## 5.2 Command Routing

Command ingress 必须：

```
resolve market / cell
resolve aggregate home region
validate write epoch
validate account / principal
validate residency
route to owner
return pending / unavailable if owner cannot safely accept
```

客户端不能通过修改 region hint、object id 或 principal id 选择另一写入 Region。

## 5.3 Read Routing

Read Model 可从最近健康 Region 返回，但必须带：

```
as_of
freshness
source_region
aggregate_version
allowed_actions
redactions
```

如果 Read Model 不是当前 owner 的最新事实：

```
显示 stale / pending
写操作回 owner
敏感查询回 owner 或拒绝
不得升级为已支付、已下单、已完成
```

## 5.4 Session / Security Propagation

跨区传播 Session revoke、Account suspension、Safety Block、Consent withdrawal 和 Operator grant expiry 时：

```
事件可延迟，但高风险 command 必须向 authority recheck
过期或 revoke 不能因旧缓存继续授权
传播失败产生 security lag alert
跨区 failover 不得复活 revoked session
```

---

# 6. Multi-region Operating Modes

## 6.1 Modes

```
SINGLE_REGION
REGIONAL_PRIMARY
ACTIVE_READ_MULTI_REGION
SELECTED_WRITE_FAILOVER
DEGRADED_MANUAL
RETIRING
```

## 6.2 Default P0 Mode

首发规模化默认：

```
stateless API can run in multiple zones
each MarketCell has one primary write Region
read models may be served from secondary Region
money / Order / KYC writes stay with primary
failover is manual or controlled promotion
Provider irreversible operations do not auto-failover on unknown result
```

## 6.3 Active-active Boundary

Active-active 只适用于：

```
stateless read
rebuildable projection
non-authoritative search index
notification preparation with dedupe
analytics ingestion
```

若要 active-active write，必须额外证明：

```
single aggregate conflict protocol
global idempotency
write fencing
clock / version correctness
provider operation uniqueness
reconciliation
chaos test
```

---

# 7. Disaster Recovery / Failover

## 7.1 DRProfile

```
DRProfile
├── dr_profile_id
├── scope
├── primary_region
├── secondary_region
├── failover_mode: MANUAL / APPROVED_AUTOMATIC
├── RTO_target
├── RPO_target
├── protected_data_classes[]
├── excluded_data_classes[]
├── fencing_method
├── restore_source
├── reconciliation_plan
├── last_tested_at
├── next_test_at
├── approvers[]
└── status
```

## 7.2 Initial Planning Targets

作为规模化设计起点，除非 Market / Engineering approval 采用更严格值：

| Scope | RPO / RTO planning target |
|---|---|
| committed Ledger / Payment fact | RPO 0 for committed owner-region fact；failover write requires reconciliation |
| Order / TaskSlot | RPO 0 for committed owner-region fact；RTO 60m planning target |
| Account security / Safety restriction | RPO 0 for committed authority fact；high-risk command recheck required |
| Read Model | RPO 15m、RTO 30m planning target，允许 rebuild |
| Analytics | RPO 24h、RTO 24h planning target |
| Media derivative | RPO 24h；raw asset follows provider / retention contract |

RPO 0 表示已确认提交的 owner fact 不能被静默丢失，不表示所有跨区复制都实时完成。

## 7.3 Failover Sequence

```
declare incident and scope
stop or fence old writer
classify in-flight commands
freeze irreversible Provider operations where needed
verify last committed aggregate versions
promote secondary with new write epoch
route safe reads
reconcile Payment / Order / KYC / Safety
run health probes
record LaunchDecision / Incident decision
re-enable limited operations
```

## 7.4 No Split-brain

以下任何一项失败时，不得自动恢复写入：

```
old writer cannot be fenced
write epoch is ambiguous
last aggregate version unknown
Payment unknown operations unresolved
replication lag exceeds approved threshold
data residency target unavailable
Provider connection scope unclear
security revoke state stale
```

只能进入 DEGRADED_MANUAL 或 PAUSED。

## 7.5 Failback

Failback 不是简单切回旧 Region：

```
reconcile promoted Region
drain new writes
fence current epoch
verify old Region state
promote old Region with new epoch
replay safe events
re-run probes
new decision
```

---

# 8. Backup / Restore / Rebuild

## 8.1 Backup Classes

```
transactional database backup
immutable Ledger backup
event / outbox archive
configuration / policy snapshot
provider reference archive
encrypted D4 / D5 restricted backup where legally allowed
read model rebuild source
analytics aggregate snapshot
```

## 8.2 Restore Order

```
identity / access control
Policy / schema / configuration
Ledger / Payment / Order authority
Safety / LegalHold / Audit
Task / Match / Execution facts
outbox / event archive
read models
analytics
```

不能先恢复 Read Model 再假定 Domain authority 已恢复。

## 8.3 Restore Verification

恢复后必须检查：

```
aggregate versions
Ledger balance
Payment provider references
Order / Slot uniqueness
Session revoke
Consent / LegalHold
Operator audit
retention clock
policy snapshot
read model freshness
```

## 8.4 Rebuildable Model

Read Model 重建期间：

```
freshness = PENDING_REBUILD
allowed_actions limited
no stale write authorization
progress observable
failed projection enters retry / case
```

---

# 9. Capacity Architecture

## 9.1 Capacity Dimensions

容量不只看 CPU / memory，还要看：

```
active Users / Agents
Tasks / Slots
Offers per wave
concurrent Accept
Payment operations
KYC attempts
Media bytes / scan rate
Notification messages
location queries
event throughput
projection lag
Operator cases
Support conversations
Provider quota
```

## 9.2 Workload Classes

| Class | 示例 | 保护策略 |
|---|---|---|
| W0 Safety / Money | funding、payout、incident、revoke | reserved capacity、priority、no silent drop |
| W1 Marketplace | publish、match、offer、accept | bounded queue、idempotent retry |
| W2 Execution | check-in、evidence、completion | policy-aware retry、user pending |
| W3 Account / KYC | OTP、recovery、verification | rate limit、security priority |
| W4 Read / Notification | Inbox、projection、delivery | degrade / replay |
| W5 Analytics / Batch | metrics、retention scan、backfill | throttled、preemptible |

W5 不能挤占 W0 capacity。

## 9.3 Headroom

每个 MarketCell 和 Region 必须配置：

```
steady-state capacity
peak capacity
burst limit
reserved W0 capacity
scale-out trigger
scale-in floor
provider quota
operator capacity
```

没有批准的 headroom 数值时，默认 hold expansion，不能靠临时人工判断放大。

## 9.4 Backpressure

过载时按顺序：

```
stop W5 / non-critical batch
reduce notification fan-out
slow new matching / admission
preserve W0 money / safety / account revoke
show pending / unavailable
pause affected capability if safe operation cannot be guaranteed
```

不得通过丢弃 Payment、Safety、Consent、Audit 或 Ledger event 缓解过载。

---

# 10. Queue / Worker / Provider Capacity

## 10.1 Queue Contract

每个队列必须有：

```
queue_id
workload_class
partition key
priority
max attempts
backoff
dead-letter policy
visibility timeout
lag SLO
owner
```

## 10.2 Worker Scaling

Worker 扩容必须保持：

```
idempotency
aggregate ordering where required
provider rate limits
per-market isolation
dead-letter observability
bounded concurrency
```

## 10.3 Provider Quota

Provider quota 进入 CapacityProfile：

```
requests per second
daily operation limit
concurrent operation limit
webhook throughput
storage limit
KYC attempt quota
notification sender quota
```

达到 quota 时：

```
stop new operations according to priority
keep existing operation status query
route only to approved alternative
notify Operator / Provider owner
update forecast
```

不能无批准地创建第二 Provider account 绕过 quota、市场和审计。

---

# 11. FinOps Architecture

## 11.1 CostAllocationProfile

```
CostAllocationProfile
├── profile_id
├── market_id
├── region_id
├── provider_type
├── workload_class
├── cost_dimensions[]
├── allocation_method
├── currency
├── effective_at
├── owner
└── version
```

## 11.2 Cost Dimensions

成本至少按以下维度可分配：

```
market
region
scenario
role
provider
operation
workload class
business principal
platform overhead
support / operator
```

无法归属的成本进入明确的 Shared Overhead，不得全部隐藏在平台总额。

## 11.3 Unit Economics

每个成功 Slot 至少估算：

```
payment provider cost
KYC cost
Geo / route cost
Media / scan cost
Notification cost
support cost
operator cost
refund / dispute leakage
infrastructure cost
subsidy
tax / compliance overhead
```

成本估算不能修改用户实际 CompensationTerms 或 Ledger；它只用于经营、容量和 Policy review。

## 11.4 Budget Objects

```
FinOpsBudget
├── budget_id
├── scope
├── period
├── budget_amount
├── forecast_amount
├── actual_amount
├── variance
├── alert_threshold
├── owner
├── approver
└── status
```

## 11.5 Cost Anomaly

异常类型：

```
provider cost spike
unexpected retry amplification
KYC resubmission spike
Geo query loop
notification fan-out
media storage growth
operator case cost
cross-region transfer spike
```

Cost anomaly 先判断是否由安全、重试、Provider 或数据泄露造成，不能只通过关闭监控或降低质量解决。

---

# 12. Multi-region Launch Gate

## 12.1 Gate Checklist

新 Region / MarketCell 进入 LIMITED 或 ACTIVE 前必须：

```
Region and residency approval
MarketLaunchProfile binding
single-writer ownership map
TrafficRoute
DRProfile and failover test
backup / restore test
Payment / KYC / Provider mapping
capacity and quota
queue / worker headroom
FinOps budget
support / on-call
Chapter 25 E2E in target Region
privacy / secret / audit test
rollback / drain plan
```

## 12.2 Region Readiness Decision

```
RegionExpansionReview
├── review_id
├── target_region
├── market_cell
├── data_residency_ref
├── ownership_map_ref
├── DRProfile_ref
├── capacity_ref
├── FinOps_ref
├── provider_ref
├── test_snapshot_ref
├── open_risks[]
├── decision: GO / HOLD / PILOT / NO_GO
├── approvers[]
└── effective_at
```

## 12.3 No-Go

以下任一存在即 No-Go：

```
split-brain writer possible
Ledger / Payment RPO unknown
old Region cannot be fenced
raw D4 / D5 crosses unapproved residency
Provider failover can double-charge
capacity has no W0 reserve
support / on-call absent
restore not tested
FinOps budget absent
market or data transfer approval absent
read model stale state can authorize writes
```

---

# 13. Resilience Drills

## 13.1 Region Loss

注入 primary Region unavailable：

```
fence old writes
route reads to secondary
keep irreversible operations paused
promote only after epoch validation
reconcile in-flight money / orders
run probes
limited resume
```

## 13.2 Replication Lag

当 replication lag 超过 approved threshold：

```
mark secondary stale
disable write promotion
keep read-only safe views
alert owner
reconcile after catch-up
```

## 13.3 Queue Loss

```
stop new low-priority work
restore queue from durable source
dedupe replay
preserve W0 events
measure lag
open incident if loss cannot be proven
```

## 13.4 Provider Quota Exhaustion

```
classify affected operations
protect Payment / Safety priority
use approved alternative or manual path
do not create unapproved account
update user pending state
review cost / capacity
```

## 13.5 Cost Spike

```
detect anomaly
identify operation / market / provider
stop amplification source
preserve security and audit
reconcile billing
approve mitigation
```

## 13.6 Clock / Epoch Fault

```
detect clock skew or write epoch conflict
reject unsafe commands
freeze ownership transfer
use server authority clock
reconcile versions
new LaunchDecision before resume
```

---

# 14. Observability / Capacity Signals

## 14.1 Region Dashboard

```
traffic by MarketCell
command success / rejection
aggregate version conflict
write epoch
replication lag
queue lag
provider latency / quota
read model freshness
W0 reserved capacity
operator load
cost / budget
incident / reconciliation
```

## 14.2 Alerts

必须告警：

```
split-brain or epoch mismatch
Ledger replication gap
Payment unknown backlog
critical queue lag
W0 capacity exhaustion
provider quota near limit
raw data transfer violation
read model stale beyond SLO
cost anomaly
DR test overdue
backup failure
```

## 14.3 Correlation

任何跨区请求可追踪：

```
market / cell
source region
home region
write epoch
command
aggregate version
event / outbox
provider operation
read model
incident / decision
```

---

# 15. Migration / Repartition / Region Drain

## 15.1 RegionMigrationPlan

```
RegionMigrationPlan
├── plan_id
├── source_region
├── target_region
├── scope
├── data_classes
├── aggregate types
├── dual-read period
├── write freeze
├── ownership transfer
├── validation
├── rollback
├── operator / user communication
├── approvals[]
└── completion_at
```

## 15.2 Migration Order

```
configuration / policy snapshot
read models
non-authoritative references
Task / Match partitions
Order / Execution only after reconciliation
Payment / Ledger only with controlled ownership transfer
KYC / D4 / D5 only with residency approval
```

## 15.3 No Dual-write Truth

Dual-write 只可用于：

```
rebuildable read models
non-authoritative analytics
approved migration shadow
```

不能对 Ledger、PaymentIntent、Order、TaskSlot、KYC decision 做无 fencing 的 dual-write。

## 15.4 Drain

Region drain 时：

```
stop new routing
finish / classify in-flight commands
close or transfer queues
reconcile Provider operations
transfer ownership by epoch
verify data residency
disable old credentials
keep audit and retention
mark RETIRED
```

---

# 16. Acceptance Criteria

## AC-30-01 Regional Objects

Region、MarketCell、DataResidencyZone、TrafficRoute、RegionOwnershipBinding 和 Region lifecycle 均有明确对象与状态。

## AC-30-02 Market Cell

每个 MarketCell 明确用户范围、Provider、写入 Region、Policy、Support、Residency 和 traffic state。

## AC-30-03 Home Ownership

每个 Identity、TaskSlot、Order、PaymentIntent、Payout、KYC Attempt 和 LegalHold aggregate 有 home region、write epoch 和 owner。

## AC-30-04 Single Writer

同一 Money、Order、Slot、Identity security 或 KYC aggregate 不存在无 fencing 的多 Region concurrent writer。

## AC-30-05 Data Partitioning

D0–D5、Security、Audit 的默认归属、复制与 residency 规则明确；raw D4 / D5 不跨未批准 Region。

## AC-30-06 Read Redaction

跨区 Read Model 带 freshness、source region、aggregate version、allowed actions 和 redaction；stale read 不能授权写操作。

## AC-30-07 Command Routing

Command 根据 market、cell、home region、write epoch、principal 和 residency 路由；客户端不能选择另一 writer 绕过规则。

## AC-30-08 Security Propagation

Session revoke、Account suspension、Safety Block、Consent withdrawal 和 JIT expiry 不会因跨区缓存延迟而继续授权高风险 command。

## AC-30-09 Consistency Classes

C0–C4 consistency class 应用于 Money / Order、Regional transaction、Security、Read Model 和 Analytics，并能被测试验证。

## AC-30-10 Multi-region Mode

首发默认使用 Regional Primary + Active Read；Active-active write 必须额外通过 conflict、fencing、provider uniqueness 和 chaos tests。

## AC-30-11 DRProfile

每个规模化 scope 有 primary、secondary、RTO/RPO、failover mode、protected data、fencing、restore source 和 reconciliation plan。

## AC-30-12 RPO/RTO

Committed Ledger、Order、Security authority fact 的规划目标和保护方式明确；Read Model、Analytics、Media derivative 可按不同恢复级别处理。

## AC-30-13 Failover Sequence

Failover 按 incident、fence、in-flight classification、epoch promotion、reconcile、health probe、limited resume 顺序执行。

## AC-30-14 No Split-brain

旧 writer 无法 fence、epoch 不明确、Payment unknown、replication lag 超限或 residency 不可用时，不自动恢复写入。

## AC-30-15 Failback

Failback 通过 drain、fence、新 epoch、reconcile 和新 decision 完成，不是简单切换 DNS 或恢复旧快照。

## AC-30-16 Restore Order

Restore 先恢复 Identity / Policy / Authority / Safety / Audit，再恢复 Domain facts、Events、Read Models 和 Analytics。

## AC-30-17 Restore Verification

Restore 后验证 aggregate version、Ledger、Payment reference、Slot uniqueness、Session revoke、Consent、LegalHold、Audit、Retention 和 Read Model freshness。

## AC-30-18 Workload Classes

W0–W5 workload class 有 priority、capacity、retry、dead-letter 和 backpressure 规则；W5 不得挤占 W0。

## AC-30-19 Capacity Dimensions

容量评估覆盖 Users、Tasks、Slots、Offers、Accept、Payment、KYC、Media、Notification、Location、Events、Projection、Operator、Support 和 Provider quota。

## AC-30-20 Headroom

每个 Region / MarketCell 有 steady、peak、burst、W0 reserve、scale trigger、scale floor、Provider quota 和 Operator capacity。

## AC-30-21 Backpressure

过载时优先停止低优先级 batch、降低非关键 fan-out、减速 admission，保护 Money、Safety、Account revoke、Consent 和 Audit。

## AC-30-22 Queue Contract

每个队列有 workload、partition、priority、attempt、backoff、DLQ、visibility、lag SLO 和 owner。

## AC-30-23 Provider Quota

Provider requests、daily、concurrent、webhook、storage、KYC 和 notification quota 纳入 CapacityProfile；达到 quota 有安全降级。

## AC-30-24 Cost Allocation

成本可按 market、region、scenario、role、Provider、operation、workload、principal 和 overhead 分配；Shared Overhead 明确记录。

## AC-30-25 Unit Economics

每个成功 Slot 可估算 Provider、KYC、Geo、Media、Notification、Support、Operator、refund、infra、subsidy 和 compliance cost。

## AC-30-26 FinOps Budget

FinOpsBudget 有 scope、period、budget、forecast、actual、variance、alert、owner、approver 和 status。

## AC-30-27 Cost Anomaly

Provider cost、retry、KYC、Geo、Notification、Media、Operator 或 cross-region transfer spike 可检测，并先判断安全 / 泄露 / 配置原因。

## AC-30-28 Multi-region Gate

新 Region / MarketCell 进入 Limited 或 Active 前通过 Residency、Ownership、DR、Provider、Capacity、FinOps、Support、E2E、Privacy、Rollback 和 Restore checks。

## AC-30-29 No-Go

Split-brain、未知 Ledger RPO、无法 fence、未批准 D4/D5 transfer、double-charge failover、无 W0 reserve、无 Support、未测试 restore 或无 FinOps budget 即 No-Go。

## AC-30-30 Region Loss Drill

Region loss 演练能 fence old writer、route safe reads、hold irreversible operations、promote new epoch、reconcile 并 limited resume。

## AC-30-31 Replication / Queue Drill

Replication lag、Queue loss、Provider quota exhaustion、Cost spike 和 Clock/Epoch fault 有受控演练与恢复路径。

## AC-30-32 Observability

Region dashboard 和 alerts 覆盖 traffic、epoch、replication、queue、Provider、Read Model、W0、Operator、Cost、Incident 和 Reconciliation。

## AC-30-33 Correlation

跨区 operation 可追踪 market、cell、source/home Region、epoch、command、aggregate、event、Provider、projection、Incident 和 decision。

## AC-30-34 Migration

RegionMigrationPlan 有 scope、data class、freeze、ownership transfer、validation、rollback、communication 和 approval。

## AC-30-35 No Unsafe Dual-write

Ledger、PaymentIntent、Order、TaskSlot、KYC decision 不允许无 fencing dual-write；只有 rebuildable projection / analytics 可按批准 shadow。

## AC-30-36 Region Drain

Region drain 停止新 routing、处理 in-flight、转移 queue / ownership、对账 Provider、验证 residency、撤销旧 credential 后才可 RETIRED。

---

# 17. P0 / P1 Boundary

## 17.1 P0

```
Regional Primary + Active Read
single-writer Money / Order / Identity / KYC
market cell and residency
command / read routing
fencing and write epoch
backup / restore
manual or controlled failover
W0 capacity reserve
provider quota
queue backpressure
FinOps allocation / budget
multi-region launch gate
region loss / replication / queue drill
region drain
```

## 17.2 P1

```
active-active write for selected aggregates
automatic global failover
multi-region payment write
cross-region KYC raw processing
global unified Ledger writer
predictive capacity autoscaling
autonomous FinOps remediation
multi-region simultaneous market launch
```

P1 不能改变 P0 的 single-writer、residency、fencing、reconciliation、Privacy 或 Money Invariant。

---

# 18. Locked Conclusions / Next Work

本章锁定：

```
Region 是运行与数据边界，不是新的业务身份
MarketCell 是市场、Provider、Policy、Support 和数据规则的组合
每个关键 Aggregate 保持 single writer、home region 和 write epoch
Read Model 可以多区服务和重建，Ledger / Order / Security facts 不能 split-brain
Failover 先 fence、再 promote、再 reconcile、最后 limited resume
容量保护 W0 Money / Safety / Identity，低优先级工作先背压
FinOps 观察和分配成本，但不能削弱 P0 controls
Multi-region 与新市场一样需要独立 Gate、Pilot、Restore 和 Rollback evidence
```

下一步进入：

```
Chapter 31 — Enterprise / B2B Scale / Contract Governance
```

Chapter 31 将把 Business Workspace、Multi-store、团队权限、企业合同、SLA、账单、采购、审计和 Enterprise Support 形成规模化 B2B 契约。

