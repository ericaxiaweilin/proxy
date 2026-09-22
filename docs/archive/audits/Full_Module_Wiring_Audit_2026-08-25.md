# Proxy 全模块接线与后端架构审计

日期：2026-08-25
范围：Kake 当前移动壳、Go API、PostgreSQL、Outbox、资金/权益、个人主页与商家工作区。

## 放行结论

当前版本可以继续做 UI 与非资金流程测试，但不能宣称“全模块生产放行”。原因不是页面数量，而是部分域仍使用内存仓库，且部分旧页面仍有本地演示数据。资金和权益域必须以 `DATABASE_URL + migrations + outbox worker` 作为启动条件；没有这些条件时只能标记为本地测试模式，不能返回“已支付 / 已结算 / 已同步”的生产语义。

## 主链路矩阵

状态含义：`CONNECTED` = UI、客户端、命令、服务、持久化/回读均存在；`PARTIAL` = 有真实链路但仍有本地 seed、读模型或事件缺口；`BLOCKED` = 存在会导致重启丢失、伪成功或越权的 P0 问题。

| 模块 | 移动客户端 | Go 命令/服务 | PostgreSQL / Outbox | 当前状态 |
|---|---|---|---|---|
| 登录、访客、Google/电话 | LoginClient / SessionAuthClient | Identity | 已接 PostgreSQL + token/session | CONNECTED |
| 首页对话与模型底座 | ConversationClient | Conversation → model stack task | 会话已持久化；模型未绑定业务模型名 | PARTIAL |
| 市场机会 | MarketplaceClient | Marketplace | 当前仍有 seed / 内存读模型 | PARTIAL |
| 活动 | ActivityClient | Activity | 当前为内存 P0 读模型 | BLOCKED（重启丢状态） |
| 动态、帖子、媒体 | LocalNet / Engagement / MediaClient | LocalNet / Engagement / Media | 帖子、媒体、互动有 PostgreSQL；媒体原图上传链路存在 | PARTIAL |
| 消息、会话 | ConversationClient | Conversation | 已有 PostgreSQL；消息请求列表仍有静态 UI 夹层 | PARTIAL |
| 通知、深链 | NotificationClient | Notification | 当前服务仍在内存仓库 | BLOCKED（重启丢通知） |
| 礼品券 | VoucherClient | Voucher | 当前服务仍是 in-memory P0 adapter | BLOCKED（权益状态不可生产放行） |
| 订单履约 | FulfillmentClient | Fulfillment | PostgreSQL + Outbox | PARTIAL；已移除固定演示凭证提交 |
| 支付、账本、放款 | PaymentClient | Payment | 已新增 PostgreSQL repository + Outbox 事务适配 | PARTIAL；Provider webhook/HMAC 仍需独立接入 |
| 个人主页 / 能力 / 可用时间 | MeSurface 轻量主页；能力/可用时间当前为本地原型状态 | Supply | 已有 PostgreSQL repository | PARTIAL；已移除参数化资料编辑，能力与可用时间仍需持久化接线 |
| 商家 Business Workspace | BusinessClient | Business | 已新增 PostgreSQL repository | PARTIAL；成员/门店有命令，商家页面仍有 R21 静态展示层 |
| Outcome / 经营归因 | OutcomeClient 未进入 Shell 业务流 | Outcome | 当前服务仍在内存仓库 | BLOCKED（不能作为经营真相） |
| Safety / Operator / Privacy | API OperatorGate | Safety | 当前服务仍在内存仓库 | PARTIAL；Operator Gate 已 fail-closed |

## 资金与权益 Gate

- `CreatePaymentIntent` 只创建待确认状态，不代表已支付。
- `ConfirmPaymentIntent`、`RefundPaymentIntent`、`CreatePayoutHold`、`ReleasePayout` 已纳入 Operator 门禁；移动端不能伪造银行回调或直接释放资金。
- 账本必须满足借贷平衡；退款累计金额不能超过已捕获金额。
- Provider event 必须按 `provider_event_id` 去重；PostgreSQL 适配已保存去重事实，但正式环境仍需把银行回调改为独立签名 webhook，不走普通移动命令入口。
- 礼品券不是钱包余额；核销、风控、结算必须是三个独立事实。当前 Voucher 仍为内存 P0，禁止生产放行。

## 数据流与兼容 Gate

标准数据流：

`UI intent → typed client → command envelope → server auth/session scope → domain service → repository transaction → outbox → read model → client refresh`

必须持续检查：

1. UI 成功提示只能在命令 `ACCEPTED` 或明确 `PENDING` 后出现，不能在本地 state 更新后冒充成功。
2. 所有跨域写操作带 command id、idempotency key、correlation id；重试不得重复扣款、发券、核销或发帖。
3. PostgreSQL 模式迁移与 `infrastructure/migrations` 是两条历史迁移路径，部署脚本必须明确执行顺序，不能只执行其中一套。
4. 服务器端不能把模型供应商名称写入业务命令；业务只传递任务类型/上下文，底座负责可用模型分发与 failover。
5. 未配置数据库时的内存仓库只能用于测试，启动日志和健康检查必须明确标记 `LOCAL_VOLATILE_MODE`。

## 安全审计重点

- Server authenticated session 覆盖客户端传入的 actor/principal；这是权限判断的唯一来源。
- Operator 命令默认拒绝，只有 allowlist 或服务端 Operator auth context 才能执行。
- Business 成员写入、门店写入、财务摘要读取已经加入成员角色检查：Owner/Admin 管理成员与财务，Operator 写门店，Viewer 只能读。
- 精确位置、联系方式、照片原图和个人身体字段必须按场景和用户可见范围分级，不得因为主页公开就自动公开。
- 履约证据必须来自真实 MediaAsset，并经过媒体服务 ready 校验；固定 `seed_media_*` 不能作为用户提交证据。

## 当前剩余 P0/P1

### P0：未完成前不做生产放行

- Voucher、Notification、Outcome、Activity 的持久化仓库与 outbox。
- Provider 签名 webhook、支付回调权限隔离、退款/放款的完整状态机。
- 个人主页的能力实例与 AvailabilityWindow 仍在本地 state；生产前必须接入 Supply 写入/回读。参数化个人资料编辑不再恢复。
- 商家 R21 页面从静态 mock 指标改为 Business/Outcome Read Model。

### P1：继续接线

- 消息请求、好友、CRM 标签/备注改为 Social/Relationship 服务，不保留静态 FRIENDS/THREADS 作为主数据。
- Market / Activity 列表的 seed 只作为明确的空环境 fixture；生产读取必须 fail-closed，不得混入演示数据。
- 所有 Surface 的 Pressable 接入自动检查；没有后端能力的入口必须显示不可用原因或进入真实的 Pending 工作流。

## 验证命令

```bash
pnpm --filter @proxy/mobile typecheck
go -C apps/api-go test ./internal/business ./internal/payment ./internal/platform/postgres ./internal/api
pnpm check:design
```

本文件是审计基线，不替代具体 PRD；后续 UI 设计更新只能改变呈现层，不能绕过上述资金、数据流和权限 Gate。
