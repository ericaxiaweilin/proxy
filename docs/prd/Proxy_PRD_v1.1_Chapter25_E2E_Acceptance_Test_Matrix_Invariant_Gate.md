# Proxy PRD v1.1
## Chapter 25 — E2E Acceptance / Test Matrix / Invariant Gate

**文档类型**：端到端验收 / Domain Invariant / 状态机测试 / 故障注入 / 发布门禁
**状态**：ACTIVE — E2E Acceptance v1
**前置依赖**：Canonical Registry、Chapter 20、Chapter 21、Chapter 22、Chapter 23、Chapter 24
**后续依赖**：Engineering API / Event / Schema Contract、Provider Integration Contract、首发市场 Legal / KYC / Payment Review

---

# 0. 本章目标

Chapter 20–24 已经定义了：

```text
Launch Gate
P0 Screen / Page Contract
Launch Scenario / Role / Template
Concrete Policy Defaults
Account / Privacy / Consent / Data Lifecycle
```

本章把这些规则变成可执行的验收门禁：

```text
Given fixture / state
When command / event / time advance
Then domain state + read model + event + audit + side effect
```

本章不是 QA checklist 的替代品，而是 Canonical Domain 的行为证明。任何接口、页面、Provider adapter 或后台任务只有在不破坏本章 Invariant 的前提下才算可上线。

---

# 1. E2E Test Constitution

## 1.1 每条测试必须验证五个面

每个 P0 E2E case 至少验证：

| 面 | 必须验证 |
|---|---|
| Command Result | HTTP / RPC 结果、error code、idempotency result |
| Domain State | 真实对象状态、余额、锁、权限、依赖关系 |
| Read Model | 页面实际读取到的状态和 CTA |
| Event / Audit | domain event、OperatorAuditLog、敏感访问记录 |
| Side Effect | Payment / Notification / Provider command 是否发出、是否重复 |

只验证页面显示，不能证明 Domain 正确；只验证数据库状态，不能证明用户获得了正确 CTA；只验证 Provider 返回，不能证明本地事实安全。

## 1.2 测试时间必须可控

测试环境必须提供：

```text
freeze_clock(timestamp)
advance_time(duration)
deliver_event(event_id)
redeliver_event(event_id)
reorder_events(event_ids[])
```

所有 TTL、保护期、Check-in Window、Offer Expiry、Location TTL、Retention Clock 都以测试时钟为准，不读取执行机器的真实时间。

## 1.3 测试数据必须可追踪

每个 fixture 必须带：

```text
test_run_id
fixture_id
policy_set_id
policy_set_version
market_id
clock_timestamp
correlation_id
```

测试不得依赖共享账号、共享支付方法、共享手机号或上一个测试留下的状态。

## 1.4 Given / When / Then 不是自然语言建议

每个 P0 case 必须能映射到：

```text
fixture builder
command or event
expected state assertions
expected event assertions
expected read-model assertions
cleanup / retention assertion
```

如果一个 case 无法被自动化执行，必须明确标注为 `MANUAL_CONTROLLED`，并说明自动化阻塞原因。

---

# 2. Canonical Test Fixtures

## 2.1 Actor Fixture Set

首发测试固定使用以下角色，不允许用一个超级用户代替所有角色：

| Fixture | 身份 | 最低状态 | 用途 |
|---|---|---|---|
| `U_REQ_01` | Individual Requester | UserAccount `ACTIVE`、K1 | 创建 Task、Funding、Review |
| `U_REQ_02` | 第二个 Requester | UserAccount `ACTIVE`、K1 | 并发、隔离、邀请边界 |
| `U_AGT_01` | Agent | UserAccount `ACTIVE`、K2、AgentProfile `ACTIVE` | Availability、Offer、Accept、Execution |
| `U_AGT_02` | 第二个 Agent | UserAccount `ACTIVE`、K2 | Wave、并发 Accept、替换 |
| `U_AGT_03` | 不合格 Agent | UserAccount `ACTIVE`、K1 或缺失 Capability | 排除与安全失败 |
| `B_OWNER_01` | Business Owner | UserAccount `ACTIVE`、BusinessMembership `ACTIVE/OWNER` | Business Task、Owner Transfer |
| `B_MEMBER_01` | Business Member | UserAccount `ACTIVE`、BusinessMembership `ACTIVE/MEMBER` | Principal isolation、审批边界 |
| `B_MEMBER_02` | 被移除成员 | UserAccount `ACTIVE`、Membership `REMOVED` | 访问拒绝 |
| `OP_SUPPORT_01` | Support Operator | Operator session | Case、只读敏感访问 |
| `OP_RISK_01` | Risk Operator | Risk permission | Restriction、Safety Case |
| `OP_FIN_01` | Finance Operator | Finance permission | Refund、Payout、Adjustment |
| `U_ATTACKER_01` | 未授权用户 | UserAccount `ACTIVE` | IDOR、跨 Business、跨 Case 访问 |

## 2.2 Launch Domain Fixture

每次主链路测试至少准备：

```text
market_id = MARKET_VN_HCM
policy_set_id = PSET_LAUNCH_V1
scenario_family = S1 或 S2
scenario_id
role_id
capability_id
venue / service area
one Task with one or more atomic TaskSlot
one AvailabilitySession
one Funding-capable PaymentMethod
```

测试必须同时覆盖：

```text
single-slot task
multi-slot task
same-day task
scheduled task
urgent task
fixed price
hourly price with minimum duration
venue / place-only location
```

## 2.3 Policy Snapshot Fixture

默认首发测试不得直接读取数据库中“当前配置”而不记录版本。每条测试都必须断言：

```text
policy_set_id = PSET_LAUNCH_V1
policy_set_version is explicit
effective_at <= frozen clock
market override is either absent or approved
```

默认值的关键验收范围：

| Policy | 首发默认 |
|---|---:|
| Candidate default / max | 6 / 8 |
| Offer wave sizes | 3 / 5 / 8 |
| Offer TTL | urgent 2m / same-day 7m / scheduled 15m |
| Radius expansion | 3km → 5km → 8km → 15km |
| Available Now TTL | 3h，最大 8h |
| Travel buffer | 30m |
| Urgent premium | 15%，上限 25% |
| Auto-confirm | 24h |
| Dispute window | 72h |
| Payout delay | 24h |
| Arrival grace | 10m |
| Check-in window | start -30m to +15m |
| Quiet hours | 22:30–07:00 |
| Operator JIT | 30m；break-glass 15m |

---

# 3. Invariant Gate

## 3.1 Gate 规则

任何一个 P0 Invariant 失败，都不能以“页面看起来正常”放行。失败等级：

| 等级 | 含义 | 发布处理 |
|---|---|---|
| `BLOCKER` | 资金、身份、隐私、越权、重复履约或不可恢复 Domain corruption | 立即阻塞发布 |
| `P0_FAIL` | 核心主链路违反业务状态或安全边界 | 阻塞 P0 上线 |
| `P1_FAIL` | 非首发能力或降级体验异常 | 记录并按 Launch approval 决定 |
| `OBSERVED` | 仅监控、文案或体验问题，不改变事实 | 可带监控上线 |

## 3.2 Identity / Account Invariants

| ID | Invariant |
|---|---|
| `INV-ID-01` | 一个用户只有一个 canonical `UserAccount` 登录主体；Requester、Agent、Business Member 不创建第二套登录账号 |
| `INV-ID-02` | `UserAccount.status` 只能使用 Chapter 24 枚举；`KYC`、`Risk`、`AgentProfile`、`Session` 状态不能写入同一字段 |
| `INV-ID-03` | 未通过 Contact Verification 不能进入 K0 之后的受限动作；未达到 K1/K2 不能越级完成对应交易动作 |
| `INV-ID-04` | 登录方式绑定必须通过已认证会话、step-up、冲突检查和审计；不能静默合并账户 |
| `INV-ID-05` | `RESTRICTED` / `SUSPENDED` / `CLOSING` 的权限由 scope 计算；客户端隐藏 CTA 不是授权证明 |
| `INV-ID-06` | 账号关闭不改写已发生的 Order、Ledger、Domain Event 或不可变 Audit fact |

## 3.3 Marketplace / State Invariants

| ID | Invariant |
|---|---|
| `INV-MKT-01` | 一个 atomic `TaskSlot` 在同一时刻最多对应一个有效 `Order` |
| `INV-MKT-02` | `Offer` 被接受前必须重新检查 Offer TTL、Agent eligibility、Slot availability、Risk、Policy version |
| `INV-MKT-03` | 已过期、已撤销、已被其他 Agent 接受或与当前约束冲突的 Offer 不能创建 Order |
| `INV-MKT-04` | `Funding Secured` 必须先于 paid `Order Created`；资金失败不能留下可执行 paid Order |
| `INV-MKT-05` | 一个 Task 的多 Slot 必须逐 Slot 原子锁定；部分成功不能伪装成全量接受 |
| `INV-MKT-06` | Candidate 与 Offer 的用户可见状态只能来自 Domain truth，不得由旧 Read Model 推断可接受 |
| `INV-MKT-07` | Material Change 必须使受影响的 Quote / Offer / Order 进入规定的 Revalidation 路径 |
| `INV-MKT-08` | Safety Block / Risk Restriction 阻止新的匹配或 Offer，但不自动篡改既有 Order 生命周期 |

## 3.4 Money / Ledger Invariants

| ID | Invariant |
|---|---|
| `INV-MNY-01` | 每笔金额使用明确 currency、minor unit、rounding rule；不能使用浮点比较决定支付结果 |
| `INV-MNY-02` | Payment、Refund、Payout、Fee、Earnings Ledger entries 可追溯到原始 Order / PaymentIntent |
| `INV-MNY-03` | 同一 PaymentIntent、Refund、Payout、Adjustment 的重复 command / webhook 不重复记账 |
| `INV-MNY-04` | 退款与 payout 受 Order、Dispute、Funding、Hold 状态约束，不能绕过冻结或保护期 |
| `INV-MNY-05` | 手工财务调整在 P0 必须 dual control；申请者不能单独批准并执行自己的调整 |
| `INV-MNY-06` | 任何失败重试都不能产生负余额、重复收益或无法解释的 Ledger delta |

## 3.5 Privacy / Security Invariants

| ID | Invariant |
|---|---|
| `INV-SEC-01` | 每次敏感访问同时具备 Who / Why / Which object / Purpose / Permission / TTL |
| `INV-SEC-02` | Operator JIT / break-glass 到期后，D4 / D5 访问立即拒绝；过期 grant 不能由旧页面继续使用 |
| `INV-SEC-03` | Operator 不能获取 raw session token、refresh token、provider secret、完整 biometric 或未加密 bank credential |
| `INV-SEC-04` | Operator 不能 impersonate 用户执行交易、接受 Offer、修改 payout 或发送用户身份的命令 |
| `INV-SEC-05` | Consent 按 purpose、scope、version、principal 记录；withdraw 后停止未来可停止的处理 |
| `INV-SEC-06` | Location / Camera / Media 的产品 Consent 与 OS Permission 分离；没有有效目的与 TTL 不能采集或展示 |
| `INV-SEC-07` | Export 必须 step-up、异步生成、短期下载、脱敏并记录 download audit |
| `INV-SEC-08` | Legal Hold 只冻结声明范围；Hold release 后重新计算 retention clock，不得无限冻结整户数据 |

## 3.6 Reliability / Observability Invariants

| ID | Invariant |
|---|---|
| `INV-REL-01` | 所有 externally retryable command 必须支持 idempotency key 或等价 dedupe key |
| `INV-REL-02` | 同一 domain event 重放不会重复产生业务副作用 |
| `INV-REL-03` | Domain state、event、audit 和 outbox 不能出现不可解释的半提交；失败必须可重试或进入明确补偿状态 |
| `INV-REL-04` | 每个 Blocker / P0 failure 都能通过 correlation id 追到 command、event、actor、policy version 和 provider reference |
| `INV-REL-05` | Read Model 延迟期间只能显示 stale / pending 状态，不能升级为已支付、已下单或已完成 |

---

# 4. P0 E2E Acceptance Matrix

以下测试为最低 P0 集合。表中的 `assert` 既包括 Domain state，也包括 read model、event 和 side effect；实现时必须拆成自动化断言。

## 4.1 Account / Authentication / Recovery

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-ACC-01` | 新手机号、无 UserAccount | 请求 OTP 并用有效 OTP 验证 | 创建 `PROVISIONAL` UserAccount、记录 Contact Verified、不能自动创建 AgentProfile |
| `E2E-ACC-02` | OTP 已过期 | 提交旧 OTP | 返回 `OTP_EXPIRED`；不创建 Session；产生安全审计，不泄露手机号是否已注册以外的敏感信息 |
| `E2E-ACC-03` | OTP 已连续失败 5 次 | 再次提交错误 OTP | 返回 `OTP_ATTEMPT_LIMIT`; challenge 关闭；必须新建 challenge；旧 challenge 不可重用 |
| `E2E-ACC-04` | 同一用户有当前设备与新设备 | 新设备完成登录 | 创建新 Session；按策略触发 step-up / 通知；旧 Session 不被静默复用 |
| `E2E-ACC-05` | 用户有 3 个 ACTIVE Session | 执行 Logout All Devices | 所有 Session 变为 `REVOKED`；refresh token family 失效；后续刷新全部失败 |
| `E2E-ACC-06` | Session 已 `REVOKED` | 使用旧 access / refresh token | 返回 `SESSION_REVOKED`; 不产生任何 Domain mutation |
| `E2E-ACC-07` | 账户 `SUSPENDED` | 试图创建 Task、接受 Offer、修改 payout | 全部按 scope 拒绝；允许恢复 / 申诉 / 必要历史访问；产生一条统一拒绝审计 |
| `E2E-ACC-08` | 已认证会话、未绑定新 Email | 添加已被另一 UserAccount 使用的 Email | 返回 `IDENTITY_CONFLICT`; 不合并、不迁移、不覆盖任何账户 |
| `E2E-ACC-09` | 用户申请修改手机号 | 完成 step-up 后提交新手机号但未完成保护期 | 新登录方式进入 pending / protected 状态；高风险动作受限；24h 内风险事件与通知可查 |
| `E2E-ACC-10` | 用户报告疑似接管 | 提交 Account Recovery | 撤销非 recovery Session，暂停高影响动作，保留安全事件；不自动取消既有 Order |
| `E2E-ACC-11` | Business Admin 不是员工账户本人 | 申请接管 `B_MEMBER_01` 的个人账户 | 返回 `ACCOUNT_TAKEOVER_FORBIDDEN`; 不改变个人 UserAccount、Session 或 LoginIdentity |
| `E2E-ACC-12` | UserAccount `ACTIVE`、无 AgentProfile | 用户点击 Become a Proxy 并明确同意相关 Consent | 创建 AgentProfile `DRAFT` 或规定初始状态；ConsentRecord、审计和事件齐全 |
| `E2E-ACC-13` | 用户未同意 Agent capability / location purpose | 直接创建 Available Now | 返回 `CONSENT_REQUIRED`; 不创建 AvailabilitySession，不采集位置 |
| `E2E-ACC-14` | UserAccount `CLOSING`，存在可取消窗口 | 用户取消关闭请求并重新认证 | 账户回到原允许状态；DeletionRequest `CANCELLED`；不恢复已完成的删除对象 |
| `E2E-ACC-15` | 用户 `ACTIVE` 且无 blocker | 发起删除并完成 step-up / confirm | DeletionRequest 进入 `REVIEWING_DEPENDENCIES` / `SCHEDULED`；展示将保留的数据类别 |
| `E2E-ACC-16` | 用户有 open Order / active dispute / LegalHold | 发起删除 | 不直接 `COMPLETED`；返回明确 blocker、保留范围和下一次 review；不删除被 hold 数据 |

## 4.2 Task / Slot / Admission

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-TASK-01` | Requester K0 | 创建 Draft Task | Task 可保存为 Draft；不触发支付、不公开精准位置、不创建 Offer |
| `E2E-TASK-02` | Requester 未达 K1 | Publish 需要身份验证的 Task | 返回 `KYC_LEVEL_REQUIRED`; Task 保持 Draft；没有 Candidate exposure |
| `E2E-TASK-03` | Task 需要 3 个 atomic slots | 提交 publish | SlotGroup 与 3 个 TaskSlot 原子创建；任一必填字段失败则全部不发布 |
| `E2E-TASK-04` | Task 缺 Capability / Evidence requirement | 请求 Admission | 返回结构化缺口；不以自由文本“看起来匹配”替代 capability requirement |
| `E2E-TASK-05` | Task 使用 `PSET_LAUNCH_V1` | 读取 Quote / policy summary | 返回 policy version、pricing mode、fee / premium 解释；金额使用 minor unit |
| `E2E-TASK-06` | Urgent Task | 请求报价 | 使用 urgent TTL / premium；premium 不超过 25%；没有市场 override 时不读取其他版本 |
| `E2E-TASK-07` | Same-day Task | 计算时间与 travel buffer | 检查 slot start、30m travel buffer、Agent availability；冲突时拒绝或要求改期 |
| `E2E-TASK-08` | Multi-slot Task，只有部分供给可用 | 进入 match | 每个 Slot 有独立状态；不得把部分匹配显示为全量 confirmed |
| `E2E-TASK-09` | Task 使用 PLACE_ONLY location | 发布 Task | Agent 只能获得必要地点粒度；不产生精准位置暴露到不相关 read model |
| `E2E-TASK-10` | Requester 修改 Material Field | 已有 Offer / Quote 存在时保存修改 | 受影响 Offer / Quote 进入 revalidation / invalidated；用户看到重新确认要求 |
| `E2E-TASK-11` | Funding method 不可用 | 请求 commit / payment authorization | 任务不能进入 paid committed；PaymentIntent 失败可重试但不创建可执行 Order |
| `E2E-TASK-12` | Task 已 CLOSED | 请求再次 publish / create Offer | 返回 `TASK_NOT_ACTIONABLE`; 历史事实不被重开 |

## 4.3 Availability / Match / Offer

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-MATCH-01` | Agent K2、AgentProfile `ACTIVE`、有效 Capability | 创建 Available Now | AvailabilitySession 有 3h TTL；位置权限、Purpose、Consent、visibility policy 均通过 |
| `E2E-MATCH-02` | Available Now 已超过 3h | Match engine 扫描 | Session 过期；不再进入新 Match / Offer；旧历史仍可审计 |
| `E2E-MATCH-03` | Agent 已有冲突 Order | 计算候选 | Agent 被排除；排除原因是 structured eligibility reason，不泄露其他用户私密细节 |
| `E2E-MATCH-04` | Candidate pool 超过 8 | 生成 candidate set | 最多 8 个；默认候选数为 6；ranking evidence 与 policy version 可追踪 |
| `E2E-MATCH-05` | pool 在 3km 内不足 | 触发 radius expansion | 按 3→5→8→15km 的顺序扩张；每次扩张事件可审计；不跳过上限 |
| `E2E-MATCH-06` | candidate set 中有 Do-not-match | 生成 Offer wave | 被排除者永不进入新 Offer；Preference 不影响其他不相关 Task |
| `E2E-MATCH-07` | wave size 3 | 发送第一波 Offer | 只发送 3 个有效 Offer；每个有独立 TTL、expires_at、delivery event |
| `E2E-MATCH-08` | Offer 在 2m / 7m / 15m 后未响应 | 轮询或触发 expiry job | Offer 变为 `EXPIRED`; 后续 Accept 被拒绝；可按策略进入下一 wave |
| `E2E-MATCH-09` | Agent capability 在 Offer 发出后过期 | Agent Accept | Final recheck 失败；不建 Order；Offer 进入 `REJECTED_REVALIDATION` 或等价状态 |
| `E2E-MATCH-10` | Requester 撤回 Task | 仍有 active Offers | 所有相关 Offer 撤销；通知幂等；不产生 Order |
| `E2E-MATCH-11` | Agent 与 requester 处于 Safety Block | Match engine 执行 | 不生成新 Match / Offer；原因记录在安全审计，不暴露封禁方的敏感细节 |
| `E2E-MATCH-12` | Ranking read model 落后 | Agent 页面点击 Accept | Command 以 Domain state 为准；过期 / 已锁定时拒绝，不能因旧页面成功下单 |

## 4.4 Concurrent Accept / Order Creation

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-CONC-01` | 一个 Slot、两个有效 Offer | 两个 Agent 同时 Accept | 只有一个成功获得 atomic slot lock；另一个得到 `SLOT_UNAVAILABLE`；最多一个 paid Order |
| `E2E-CONC-02` | 同一 Agent 同时 Accept 两个冲突 Slot | 并发提交 | 至少一个按 availability / travel conflict 失败；不产生不可执行的双重承诺 |
| `E2E-CONC-03` | Offer TTL 在并发请求中间到期 | Accept 与 clock advance 交错 | 由 transaction-time 重新计算；到期请求失败，不受客户端时间影响 |
| `E2E-CONC-04` | Funding authorization 慢、另一个 Accept 到达 | 两个 command 争抢同一 Slot | 锁与 funding 状态原子协调；失败的一方不留下 orphan paid Order |
| `E2E-CONC-05` | Order 创建成功但 response 丢失 | 客户端重试相同 idempotency key | 返回原始成功结果；不重复 PaymentIntent、Order、Notification |
| `E2E-CONC-06` | 同一 Slot 的 Offer cancel 与 Accept 并发 | 两个 command 同时提交 | 只接受符合 transaction ordering 的一个事实；另一个得到明确 conflict，不产生双事实 |
| `E2E-CONC-07` | multi-slot Task 中 Slot A 成功、Slot B 竞争失败 | 提交全量 Accept | 返回 partial result；Slot A 是否保留必须符合 policy，不能错误显示为全量成功 |
| `E2E-CONC-08` | retry worker 重放同一 Accept event | Event delivered twice | Order、ledger、notifications 只产生一次业务副作用 |

## 4.5 Execution / Check-in / Location / Evidence

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-EXEC-01` | Order 已确认、距离 start 2h | Agent 请求 Check-in | 按 start -30m window 拒绝过早 check-in；不写入 arrival fact |
| `E2E-EXEC-02` | 当前时间在 start -30m 至 start +15m | Agent Check-in | 通过身份、Order、location purpose、permission、TTL 检查；写入 Check-in fact 和 audit |
| `E2E-EXEC-03` | Agent 未授权精确位置 | 请求上传 live location | 返回 `LOCATION_PERMISSION_REQUIRED`; 不保存 precise location |
| `E2E-EXEC-04` | Location grant 已过期 | 继续执行 location-bound action | 拒绝并要求重新授权；旧坐标不被当作当前坐标 |
| `E2E-EXEC-05` | location distance 超出约束 | Check-in | 按 policy 进入 exception / manual review；不能静默通过 |
| `E2E-EXEC-06` | Agent 在执行中撤回 camera permission | 上传 Evidence | 上传失败或降级为允许的非相机证据；不伪造成功的 Evidence |
| `E2E-EXEC-07` | Evidence type 为 required | 完成 Order 但缺 Evidence | Order 不能进入 `COMPLETED`，或进入 `EVIDENCE_PENDING`；Requester 看到明确缺口 |
| `E2E-EXEC-08` | Evidence 上传请求超时后重试 | 使用相同 content / idempotency key | 不产生重复 Evidence；原始 upload 状态可查询并可恢复 |
| `E2E-EXEC-09` | Agent 提交超出 Order purpose 的位置 | API 直接传入扩展 scope | 返回 `LOCATION_PURPOSE_MISMATCH`; 不扩大 LocationVisibilityGrant |
| `E2E-EXEC-10` | Order 已关闭 90 天 | retention job 执行 | D4 精确位置 / trajectory 删除或匿名化；Incident / Dispute / LegalHold 范围内的例外保留 |

## 4.6 Cancellation / No-show / Replacement / Dispute

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-SAFE-01` | Requester 取消未开始 Order | 提交取消 | 计算 cancellation policy、refund / fee；Order、Payment、Notification、Audit 一致 |
| `E2E-SAFE-02` | Agent 取消已确认 Order | 提交取消 | 进入 replacement / re-match 路径；不自动伪造完成；用户看到影响与下一步 |
| `E2E-SAFE-03` | Agent 未在 arrival grace 10m 内到场 | clock advance 10m 后触发 no-show | 按 no-show policy 生成事实、通知和可能的 replacement；不重复处罚 |
| `E2E-SAFE-04` | Requester 未在约定窗口出现 | 触发 requester no-show | 写入对应 party fact；不得仅凭一方客户端状态直接定责 |
| `E2E-SAFE-05` | Replacement Agent 被选中 | 新 Offer 被接受 | 新 Agent 必须重新通过 capability、risk、availability、funding / pricing recheck |
| `E2E-SAFE-06` | Incident 处于 active safety hold | 任一方请求继续执行 | 命令被阻止或转人工 Safety Case；不因普通 retry 绕过 hold |
| `E2E-SAFE-07` | 一方发起 Dispute | 提交 dispute reason / evidence | Dispute window 72h 由 clock 计算；对应 payout / hold 进入规定状态；原始 Order fact 不改写 |
| `E2E-SAFE-08` | Dispute 已关闭 | 再次提交同一 dispute | 返回 `DISPUTE_WINDOW_CLOSED` 或 `ALREADY_RESOLVED`; 不重复冻结或重复退款 |
| `E2E-SAFE-09` | Safety Block 在已有 Order 期间创建 | block 生效 | 阻止新的 Match / Offer / contact grant；既有 Order 只按 Safety / Marketplace command 决定是否暂停 |
| `E2E-SAFE-10` | Block 被撤销 | 新 Task 再次匹配 | 只有撤销后的新决策可产生 Match；旧被撤销 Offer 不自动复活 |

## 4.7 Payment / Refund / Payout / Settlement

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-PAY-01` | Task 已有 Quote、资金未 secured | 请求创建 paid Order | 先创建 / 确认 Funding；资金失败则无 paid Order |
| `E2E-PAY-02` | Payment provider 返回 success webhook | 本地 PaymentIntent 已 success | 幂等更新 PaymentIntent；产生一次 FundingSecured；不重复 Ledger |
| `E2E-PAY-03` | success webhook 重复 3 次 | 重放相同 provider event id | 只有一次状态转移、一次通知、一次 ledger effect |
| `E2E-PAY-04` | Payment webhook 早于本地 command response | 先投递 webhook 后完成 command | 通过 provider reference / idempotency reconcile；最终状态可解释，不产生逆序覆盖 |
| `E2E-PAY-05` | Funding authorization declined | Order commit | Order 不进入 paid executable；Requester 获得可恢复支付 CTA |
| `E2E-PAY-06` | Order 完成且无 dispute | payout delay 24h 后 | Payout 可进入 processing / paid；before delay 不得自动释放 |
| `E2E-PAY-07` | active dispute / hold | payout worker 执行 | Payout 保持 hold；worker 重试不重复创建 payout |
| `E2E-PAY-08` | Refund 已成功 | 客户端重复请求 refund | 返回原始 refund；不产生第二笔退款或负 ledger |
| `E2E-PAY-09` | Refund 金额大于可退余额 | 请求 refund | 返回 `REFUND_AMOUNT_EXCEEDED`; 不部分写入不完整 ledger，除非 policy 明确支持 partial refund |
| `E2E-PAY-10` | Finance Operator 申请 manual adjustment | 未有第二审批人 | 只创建 pending request；不能执行 ledger mutation |
| `E2E-PAY-11` | 第二审批人批准自己的 request | attempt approve | 返回 `DUAL_CONTROL_VIOLATION`; request 保持未执行并审计 |
| `E2E-PAY-12` | payout provider 超时 | payout command retry | 本地进入 `PROCESSING / UNKNOWN` 等可恢复状态；不再次扣款或重复 payout |
| `E2E-PAY-13` | settlement reconciliation mismatch | 日终 reconcile | 创建 Operator Case / hold；不静默修正 ledger；审计包含 provider reference 与差额 |

## 4.8 Business / Privacy / Operator Boundary

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-PRIV-01` | `B_MEMBER_01` 属于 Business A | 请求读取 Business B Task | 返回 `PRINCIPAL_SCOPE_DENIED`; 不泄露存在性或敏感字段 |
| `E2E-PRIV-02` | Membership 已 `REMOVED` | 旧页面提交 Business command | 后端按当前 membership 拒绝；旧 read model 不能保留写权限 |
| `E2E-PRIV-03` | UserAccount 同时有 Individual 与 Business principal | 切换 principal | 读取、创建、审计均带 principal context；不能把个人 Task 混入 Business history |
| `E2E-PRIV-04` | User withdraws marketing consent | 下一次 campaign selection | 用户被排除；历史发送记录不删除或伪造；withdraw event 可审计 |
| `E2E-PRIV-05` | User withdraws location purpose | 新一轮 location request | 新采集被拒；已有 Order 所需的最小历史事实按 retention / legal 规则处理 |
| `E2E-PRIV-06` | KYC verification decision 已完成 30 天 | raw KYC retention worker 执行、无 hold | raw document 删除；KYC decision / audit 保留；删除 event 可查询 |
| `E2E-PRIV-07` | raw KYC 有 LegalHold | retention worker 执行 | raw document 不删除；访问仍受 D5 JIT 限制；Hold release 后重新计算 eligibility |
| `E2E-PRIV-08` | 用户请求 Export | 完成 step-up 并下载 | ExportRequest 异步完成；包脱敏、短期链接、一次性 / 过期下载；download audit 存在 |
| `E2E-PRIV-09` | Operator 有 Support Case 但无 D5 grant | 请求查看 KYC raw file | 返回 `SENSITIVE_ACCESS_REQUIRED`; 不返回 raw data；访问失败也记录必要审计 |
| `E2E-PRIV-10` | Operator 获得 D4 JIT 30m | 30m 后重新读取 precise location | 返回 `SENSITIVE_ACCESS_EXPIRED`; grant 不续期；需要新 reason / grant |
| `E2E-PRIV-11` | Operator 获得 D5 grant | 请求 raw session token / provider secret | 永久拒绝，即使有 D5；只允许 masked reference 或 scoped adapter command |
| `E2E-PRIV-12` | Operator 试图以用户身份接受 Offer | 调用 user command with operator token | 返回 `OPERATOR_IMPERSONATION_FORBIDDEN`; 不产生 OfferAccept / Order |
| `E2E-PRIV-13` | Business Owner 转移给新 Owner | 完成 step-up、确认、24h protection | Owner transfer 可审计；保护期内高影响权限按 policy 限制；旧 Owner 权限明确收敛 |
| `E2E-PRIV-14` | Business 只有一个 Owner | Owner 请求退出 / remove self | 返回 `LAST_OWNER_GUARD`; 必须先完成 handover；Business 不进入无 Owner 状态 |

## 4.9 Notification / Read Model / Audit

| ID | Given | When | Then |
|---|---|---|---|
| `E2E-OBS-01` | Order 创建 command 成功 | 读取 Requester / Agent / Operator 页面 | 三方 read model 显示各自允许的字段和 CTA；同一 Order 状态不产生冲突 |
| `E2E-OBS-02` | Domain event 已提交、read model 尚未更新 | 用户立即刷新 | 显示 pending / stale-safe 状态；不能显示未确认、未支付或已完成 |
| `E2E-OBS-03` | Offer expired event 重复投递 | Notification worker 执行 | 只发送一次 expiry notification；Inbox item 有 dedupe key |
| `E2E-OBS-04` | Sensitive read 被拒绝 | Operator 尝试读取 D4 | 返回最小错误；安全审计包含 actor、object、reason outcome，不包含不必要敏感值 |
| `E2E-OBS-05` | 任意 P0 command 失败 | 查询 correlation id | 可追到 actor、principal、command、policy version、decision、event / provider reference |
| `E2E-OBS-06` | Domain state 已改变、event publish 暂时失败 | Outbox worker 重试 | 事件最终可重放；业务副作用不重复；无法完成时进入明确 operator case |

---

# 5. Negative / Permission / State Transition Matrix

## 5.1 统一拒绝原则

拒绝必须满足：

```text
deny the command
do not mutate protected domain state
do not emit success event
return stable error code
write security / business audit where required
```

客户端不能通过修改 `account_status`、`role`、`principal_id`、`price`、`policy_version`、`location_scope` 或 `operator_user_id` 绕过服务端检查。

## 5.2 关键非法转换

| Object | 当前状态 | 非法动作 | 预期 |
|---|---|---|---|
| UserAccount | `CLOSED` | 创建新 Task | `ACCOUNT_CLOSED`，无 mutation |
| UserAccount | `SUSPENDED` | Accept Offer | `ACCOUNT_RESTRICTED`，无 Order |
| AgentProfile | `PAUSED` | Available Now | `AGENT_NOT_AVAILABLE` |
| AvailabilitySession | expired | 进入 Match | `AVAILABILITY_EXPIRED` |
| Offer | expired | Accept | `OFFER_EXPIRED` |
| TaskSlot | locked | Accept second Offer | `SLOT_UNAVAILABLE` |
| PaymentIntent | failed | Create paid Order | `FUNDING_NOT_SECURED` |
| Order | completed | 修改 agreed compensation | `ORDER_IMMUTABLE` 或 material-change flow |
| Order | disputed | Release payout | `PAYOUT_ON_HOLD` |
| Dispute | resolved | Reopen without allowed appeal | `DISPUTE_RESOLVED` |
| ConsentRecord | withdrawn | Start optional marketing | `CONSENT_NOT_GRANTED` |
| PermissionGrant | expired | Read precise location | `PERMISSION_EXPIRED` |
| LegalHold | released | Delete without recalculating clock | `RETENTION_RECALC_REQUIRED` 或系统自动重算 |
| BusinessMembership | removed | Read Business data | `PRINCIPAL_SCOPE_DENIED` |
| OperatorAccessGrant | expired | Read D4 / D5 | `SENSITIVE_ACCESS_EXPIRED` |

## 5.3 Error Contract

P0 error 至少包含：

```text
error_code
message_key
retryable: true / false / after_reauth / after_user_action
correlation_id
required_next_action optional
```

不应包含：

```text
raw KYC rejection internals
other user's private data
provider secret
internal fraud rule threshold
full location of another actor
```

---

# 6. Idempotency / Retry / Out-of-order Matrix

## 6.1 Command Idempotency

以下命令必须支持 idempotency：

```text
CreateTask
PublishTask
CreateOffer
AcceptOffer
CancelTask
CancelOrder
CreatePaymentIntent
ConfirmFunding
RequestRefund
CreatePayout
SubmitEvidence
CreateDispute
RequestExport
RequestDeletion
RecordConsent
CreateSafetyBlock
TransferBusinessOwnership
CreateManualAdjustmentRequest
```

同一个 `idempotency_key` 的要求：

| 情况 | 结果 |
|---|---|
| same key + same canonical payload | 返回第一次结果或当前可恢复状态 |
| same key + different payload | `IDEMPOTENCY_PAYLOAD_MISMATCH` |
| key reused after retention window | 按 contract 返回过期错误或创建新 operation，不能静默复用旧事实 |
| first request timeout | retry 只能查询 / 恢复原 operation，不能盲目创建第二个 |

## 6.2 Event Dedupe

事件 envelope 必须至少包含：

```text
event_id
event_type
aggregate_type
aggregate_id
aggregate_version
occurred_at
correlation_id
causation_id
producer
schema_version
```

Consumer 需要按 `event_id` 与必要的 aggregate version 去重。重复 event 不得重复：

```text
charge
refund
payout
Order creation
notification send
retention delete
security restriction
```

## 6.3 Out-of-order Delivery

至少测试：

```text
FundingSecured before PaymentIntentCreated read model update
OfferExpired after AcceptOffer command arrived
OrderCompleted before EvidenceProcessed callback
RefundSucceeded before RefundRequested read model update
LegalHoldCreated after deletion job was queued
SafetyBlockCreated after candidate snapshot was built
```

处理原则：

```text
validate aggregate version
apply only legal transition
reconcile provider reference
keep immutable facts
create retry / manual case when ordering cannot be resolved
```

---

# 7. Fault Injection / Recovery Matrix

## 7.1 Provider Faults

| Fault | 必测场景 | 不变量 |
|---|---|---|
| Payment timeout | funding / refund / payout | no duplicate money effect |
| Payment decline | first authorization | no paid executable Order |
| Duplicate webhook | same provider event 2–3 times | one state transition |
| Webhook signature invalid | forged event | reject, audit, no mutation |
| KYC provider unavailable | start / submit / callback | retryable KYC state, no false VERIFIED |
| KYC callback stale | callback for old attempt | ignore or reconcile by attempt id |
| Map provider timeout | distance / geocode | no unsafe precise-location assumption |
| Media upload timeout | Evidence | resumable / failed state, no fake Evidence |
| Notification provider failure | OTP / Offer / safety alert | business fact remains; delivery retry / fallback is observable |

## 7.2 Application Faults

```text
crash after DB commit before outbox publish
crash after provider command before local response
read model projector restart
worker duplicate execution
clock jump forward
clock jump backward
partial network partition
operator browser holds stale grant
client retries after 502
```

每个 fault 都要证明：

```text
no duplicate irreversible effect
no silent state regression
no privilege extension
repair path exists
metrics and audit identify the gap
```

## 7.3 Recovery Acceptance

恢复不是“把状态改回去”，而是：

```text
reconcile current provider truth
replay safe events
apply compensating command where needed
preserve original facts
record operator / automation decision
```

---

# 8. State Machine Coverage

## 8.1 Required State Coverage

每个 canonical object 至少覆盖：

```text
one happy transition
one invalid transition
one timeout / expiry transition
one retry transition
one concurrent transition where applicable
one permission-denied transition
one audit / event assertion
```

## 8.2 P0 State Families

| Family | 必测状态链 |
|---|---|
| UserAccount | `PROVISIONAL → ACTIVE → RESTRICTED → ACTIVE`, `ACTIVE → SUSPENDED → CLOSING → CLOSED` |
| Session | `ACTIVE → EXPIRED`, `ACTIVE → REVOKED`, `ACTIVE → COMPROMISED` |
| AgentProfile | `DRAFT → ACTIVE → PAUSED → ACTIVE`, restricted / suspended branch |
| Availability | `CREATED → ACTIVE → EXPIRED / REVOKED` |
| Task | `DRAFT → PUBLISHED → MATCHING → PARTIALLY_FILLED / FILLED → CLOSED` |
| Offer | `CREATED → SENT → ACCEPTED / DECLINED / EXPIRED / REVOKED` |
| Order | `PENDING_FUNDING → CONFIRMED → IN_PROGRESS → COMPLETED`, cancel / dispute / no-show branches |
| Payment | `CREATED → REQUIRES_ACTION → AUTHORIZED / FAILED → CAPTURED / REFUNDED` |
| Payout | `ELIGIBLE → HELD → PROCESSING → PAID / FAILED` |
| Evidence | `REQUESTED → UPLOADING → SUBMITTED → VERIFIED / REJECTED` |
| Dispute | `OPEN → INVESTIGATING → RESOLVED / ESCALATED` |
| Deletion | `REQUESTED → REVIEWING_DEPENDENCIES → SCHEDULED → PROCESSING → COMPLETED / PARTIALLY_COMPLETED` |
| LegalHold | `CREATED → ACTIVE → RELEASED` |
| SafetyBlock | `PENDING_REVIEW → ACTIVE → REVOKED / EXPIRED` |

## 8.3 Model-based Test Rule

如果状态机使用 model-based test，生成的路径仍必须经过 Domain command，不能直接修改数据库状态。测试模型可以产生：

```text
valid command
invalid command
clock advance
event redelivery
permission change
provider callback
```

每条生成路径必须在失败时输出最短可复现 sequence。

---

# 9. Security / Privacy Test Matrix

## 9.1 Access-control Cases

至少覆盖：

```text
same user / wrong principal
same business / removed member
different business / valid member
agent sees own offer but not another agent's private data
requester sees candidate display fields but not raw KYC
operator sees case-scoped summary but not secrets
expired JIT grant
revoked consent
closed account
stale session
```

每个 case 同时执行：

```text
direct API request
old UI request
replayed request
modified object_id request
```

## 9.2 Data Minimization Cases

| Data | 测试断言 |
|---|---|
| raw KYC | 只在 D5 JIT + approved purpose 下可访问；普通 Query 永不返回 |
| precise location | 只返回 Order / Purpose / TTL 允许的粒度 |
| payout identity | masked reference；普通 Operator 不可见原文 |
| contact | TemporaryContactGrant 到期后不可见 |
| incident reporter | 导出、Requester、Agent read model 按规则脱敏 |
| risk decision | 只返回用户可执行的 reason category，不返回检测规则 |
| device metadata | 最小字段；不把完整 fingerprint 暴露给 Business member |

## 9.3 Consent / Retention Cases

必须证明：

```text
required consent missing → action denied
optional consent withdrawn → future optional processing stops
document version changes → new consent where required
retention clock starts from correct domain event
legal hold scopes only named object / class
hold release re-evaluates deletion eligibility
deletion job is idempotent
export redaction is deterministic and auditable
```

---

# 10. Performance / Resilience Acceptance

## 10.1 P0 Performance Scenarios

性能测试至少覆盖：

```text
login / OTP burst
candidate resolution with 8 max candidates
multi-slot Task admission
concurrent Accept on same Slot
payment webhook burst and duplicate delivery
notification wave fan-out
Operator case search with scoped filters
retention scan with LegalHold records
```

具体 latency / throughput 数值由 Engineering SLO 与市场容量评审锁定；在数值未锁定前，不能用“平均响应快”作为通过标准。至少必须证明：

```text
no timeout creates a second irreversible command
queue backlog is observable
retry does not amplify side effects
read model lag cannot grant permission or confirm money
```

## 10.2 Resilience Targets

P0 必须支持：

```text
safe retry
outbox replay
provider reconciliation
worker restart
dead-letter inspection
manual case creation
audit continuity
```

---

# 11. Test Artifact Contract

每次 P0 测试运行必须产出：

```text
run_id
git / build reference
policy_set_id + version
market + locale
fixture ids
clock seed
test case ids
command log
event log
state snapshots before / after
read-model assertions
provider mocks / references
audit references
failure classification
cleanup result
```

## 11.1 Failure Artifact

失败不能只截一张页面截图，至少要保存：

```text
first failing assertion
minimal command sequence
aggregate state before failure
aggregate state after failure
last accepted event
outbox / retry state
actor / principal / permission context
policy snapshot
correlation id
```

## 11.2 Test Data Cleanup

测试结束必须：

```text
revoke all test sessions
delete or isolate test payment references
expire test location grants
remove test Business memberships
mark test notifications non-production
run retention cleanup for disposable data
preserve only approved failure artifacts
```

不得把真实手机号、真实 Government ID、真实银行凭证或生产 token 带入 E2E fixture。

---

# 12. Release Gate

## 12.1 P0 Must-pass

以下全量通过才可进入 Pilot / Launch approval：

```text
all INV-ID / INV-MKT / INV-MNY / INV-SEC invariants
E2E-ACC-01..16
E2E-TASK-01..12
E2E-MATCH-01..12
E2E-CONC-01..08
E2E-EXEC-01..10
E2E-SAFE-01..10
E2E-PAY-01..13
E2E-PRIV-01..14
E2E-OBS-01..06
all duplicate / retry / out-of-order cases
all LegalHold / D4 / D5 boundary cases
```

## 12.2 阻塞发布条件

任一条件存在即阻塞：

```text
duplicate charge / refund / payout
oversold atomic Slot
Order created before secured funding
operator can impersonate user
raw secret exposed
cross-Business data access
expired Offer accepted
withdrawn consent still triggers optional processing
LegalHold data deleted
deletion rewrites financial / safety facts
security event cannot be audited
read-model stale state grants a write action
```

## 12.3 Conditional Launch

只有非 P0 且有明确 mitigation、owner、expiry date、monitoring 的问题，才可以作为 conditional launch item：

```text
P1 social login
advanced recurring task
membership earn / spend
AI-native recommendation
non-essential media enhancement
market-specific provider optimization
```

---

# 13. Acceptance Criteria

## AC-25-01 E2E Format

每个 P0 case 都具备 Given / When / Then，并能绑定 fixture、command、state、event、read model、side effect 断言。

## AC-25-02 Controlled Clock

所有 TTL、保护期、grace、window、retention 测试都能通过 freeze / advance clock 稳定复现。

## AC-25-03 Policy Snapshot

每个首发 P0 case 记录 `PSET_LAUNCH_V1` 及生效版本；不允许隐式读取未审批准入配置。

## AC-25-04 Actor Separation

Requester、Agent、Business、Operator 使用独立 fixture；测试不会用超级用户掩盖权限问题。

## AC-25-05 Account Lifecycle

UserAccount lifecycle 只能使用 Chapter 24 enum；账户、KYC、Risk、Agent、Session 状态在断言中分离。

## AC-25-06 Authentication Boundary

OTP 过期、尝试次数、Session revoke、new device step-up、recovery hold 均有自动化 case。

## AC-25-07 No Silent Merge

冲突的手机号、Email、Social subject 或 Business membership 不会自动合并账户；冲突有稳定错误和审计。

## AC-25-08 Consent Gate

缺少 required Consent 或撤回 optional Consent 时，相关命令的允许 / 拒绝行为可被自动验证。

## AC-25-09 KYC Boundary

KYC raw document 不会从普通 User / Candidate / Operator API 返回；D5 访问仅在 JIT、purpose、scope、TTL 齐全时允许。

## AC-25-10 Retention Clock

Retention worker 从正确 domain event 计算到期时间，不把 `created_at` 当作所有对象的统一起点。

## AC-25-11 Legal Hold

LegalHold 只冻结指定范围；Hold release 后数据进入重新计算路径；worker 不删除 active hold 数据。

## AC-25-12 Deletion Dependency

有 open Order、financial pending、dispute、security investigation、Business handover 或 LegalHold 时，删除不会直接完成。

## AC-25-13 Export Redaction

Export 通过 step-up、异步生成、短期下载、脱敏和 download audit；不会包含 token、provider secret、他人私密信息。

## AC-25-14 Principal Isolation

个人 Principal、Business Principal、Membership removal、跨 Business 访问在 API 与旧页面请求中都被服务端强制隔离。

## AC-25-15 Slot Atomicity

并发 Accept、Offer cancel、slot lock 竞争下，一个 atomic Slot 最多产生一个有效 Order。

## AC-25-16 Offer Freshness

过期、撤销、已被他人接受或 revalidation 失败的 Offer 不能创建 Order。

## AC-25-17 Funding Ordering

资金未 secured 时不会创建 paid executable Order；Funding failure 有可恢复状态和明确 CTA。

## AC-25-18 Multi-slot Partiality

多 Slot 任务能正确显示 partial fill；不能把部分成功伪装为全量成功。

## AC-25-19 Candidate / Radius Policy

候选上限、默认候选数、wave size、radius expansion 按 PolicySet 执行并可审计。

## AC-25-20 Material Change

影响价格、时间、地点、能力或证据要求的变更，会触发正确的 quote / offer / order revalidation。

## AC-25-21 Check-in Window

Check-in 在 start -30m 至 +15m 之外被拒绝或转 exception；不得伪造 arrival fact。

## AC-25-22 Location Purpose

精确位置读取同时受 Order、Purpose、TTL、Audit、Consent、Permission 和 Risk Restriction 约束。

## AC-25-23 Evidence Completeness

required Evidence 缺失时，Order 不会错误进入完成和结算路径。

## AC-25-24 No-show / Replacement

Arrival grace、no-show、replacement 每次只生成一次事实；Replacement Agent 重新通过资格和资金检查。

## AC-25-25 Dispute Hold

Dispute window、payout hold、resolution、重复提交行为符合 Policy，并保留不可变原始事实。

## AC-25-26 Money Idempotency

Payment、Refund、Payout、Manual Adjustment 的重复 command / webhook 不产生重复或负 Ledger effect。

## AC-25-27 Dual Control

P0 financial manual adjustment 的申请人与批准人不能相同；未经批准不能产生 Ledger mutation。

## AC-25-28 Provider Reconciliation

Provider timeout、duplicate、out-of-order、invalid signature 和 reconciliation mismatch 都有安全处理和可追踪 case。

## AC-25-29 Safety Block

Safety Block 阻止新 Match / Offer / contact grant，但不自动改写既有 Order；撤销后旧 Offer 不复活。

## AC-25-30 Operator JIT

D4 / D5 Operator grant 具备 reason、purpose、object scope、TTL、audit；过期后访问立即失败。

## AC-25-31 No Operator Impersonation

Operator 只能查看、协助或执行被授权的后台命令，不能以用户身份接受 Offer、交易或修改 payout。

## AC-25-32 Read-model Safety

Read Model 延迟、乱序或过期时只能显示 stale / pending-safe 状态，不能授权写操作或确认支付事实。

## AC-25-33 Event Dedupe

相同 domain event 重放不会重复发送通知、扣款、退款、payout、retention delete 或 security restriction。

## AC-25-34 Outbox Recovery

数据库提交与 event publish 之间发生 crash 时，outbox replay 能恢复事件，不产生第二次不可逆副作用。

## AC-25-35 Failure Artifact

每个失败包含最短复现 sequence、before / after state、event、outbox、actor、policy、correlation id。

## AC-25-36 Release Gate

所有 P0 case、P0 invariant、security / privacy boundary 和 duplicate / retry case 通过后，才允许进入 Pilot / Launch approval。

---

# 14. P0 / P1 Boundary

## 14.1 P0

```text
phone OTP / session / logout all / recovery hold
UserAccount lifecycle
Requester / Agent / Business principal isolation
Task / Slot / Offer / Order mainline
atomic concurrent Accept
funding before paid Order
fixed + hourly pricing basics
check-in / evidence minimum
cancellation / no-show / replacement baseline
refund / payout hold / dispute baseline
Consent / KYC raw boundary / D0–D5 retention
delete / export / LegalHold
Do-not-match / Safety Block
age 18+ gate
Business Owner transfer / last-owner guard
Operator JIT / no secrets / no impersonation
idempotency / outbox / provider reconciliation
```

## 14.2 P1

```text
social login
passkey
advanced device intelligence
automated account merge
recurring task graph
complex membership earn / spend
AI-native ranking explanation
advanced media transformation
cross-market retention automation
```

P1 功能可以建立在 P0 contract 上，但不能改变 P0 Invariant。

---

# 15. Locked Conclusions / Next Work

本章锁定：

```text
P0 不是“页面能点通”就算通过
Domain state、read model、event、audit、side effect 必须一起验收
资金、Slot、身份、权限、隐私、Retention、Operator boundary 是发布阻塞项
所有可重试 command / event / provider callback 必须幂等
所有时间策略必须可用 controlled clock 测试
```

下一步进入：

```text
Engineering API / Event / Schema Contract
```

该阶段将把：

```text
Object
State
Command
Event
Read Model
Error Code
Idempotency
Policy Snapshot
```

转换为服务边界、schema version、consumer contract、Provider adapter contract 和 migration rule。

