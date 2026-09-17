# 真人小美闭环深度缺陷（Scene 邀请→Order）—— 2026-09-17

范围：已经接通的唯一闭环本身的洞，不是“还没做”。每条都对仓实测过，
结论分三档：已修 / 属实待修 / 审计口径需订正。

## 已修（本轮，NOTIF-INVITE-OFFER-001）

- **#3 offer 通知收件人写反（部分订正审计）**：`SlotOfferCreated` 以前按
  PrincipalID 投递 —— 发起方是 requester，5 分钟内必须行动的是 agent，
  等于把信送给了发信人自己。现按 `payload.agentId` 投，缺失回退 PrincipalID。
  文件：`apps/api-go/cmd/worker/main.go`（`inboxForEvent` 纯函数，可单测）。
- **#4 邀请零触达（属实）**：`InvitationCreated` / `InvitationResponded`
  根本不在 worker switch 里。现按 `inviteeId` / `hostId` 投；
  `hostId` 是随本次补进事件 payload 的（原来就没有）。
- **#5 ASK 空壳（属实）**：邀请卡片的“询问”按钮删掉 —— 点它只改状态串，
  没地方输入问题，跟拒绝没有实质区别。服务端仍接受 ASK（不断旧链），
  客户端不再发送。真要“先问问”走开聊。
- 移动端 inbox 读取界面还没做：`notification-client.ts` 的 listInbox 有实现、
  零界面调用。触达链目前到 inbox 表为止，读者 UI 是下一棒。

## 属实待修（没动，需要产品/设计先拍板）

- **#1 平台不碰钱（P0，商业模式级）**：`DIRECT_SETTLEMENT` 写死
  （`cmd/api/main.go:1351,1363`），`PLATFORM_PAY` 进去就是
  `POLICY_GATE_NOT_CONFIGURED`，`CreatePaymentIntent` 零调用。
  动它等于动真钱：要 VietQR 商户凭证、费率/分账规则、escrow 时机 ——
  这些不等产品定，代码不敢写。`PayerConfirmed/PayeeConfirmed` 继续是声明信号。
- **#2 打卡无地理校验**：`checkInOrder` 只查 MarketID 非空 + 当事人身份。
  真修要订单快照里带 venue 坐标、服务端算距离（不能信客户端传的），
  且存量订单没有坐标 —— fail-closed 会炸老订单，放行又有洞。方案待定。
- **#6 评价孤岛（审计前提已订正）**：fixtures 里没有写死的评分值（只有可选
  类型字段），UI 取不到显示“暂无公开评价摘要”，还有
  `RECOMMEND-REPUTATION-FABRICATED-001` 门禁防编造 —— 不是“拆假数据”，
  是“建真管线”（完成→聚合→推荐卡），聚合公式要产品定。
- **#7 场景只能改源码**：CMS 是独立项目，不在本轮。
- **#8 转化埋三层**：入口抬升要设计（inbox UI 做好后一起看：通知触达＋
  一等公民入口是同一漏斗的两端）。

## 审计口径订正（已核实，不用修）

- #3 原文“零通知订阅”不准确：worker 里 `SlotOfferCreated` 早就有 inbox
  映射（`businessInboxDelivery`），错的是收件人，不是没有订阅。
- #6 原文“评分写死在 fixtures”过时：值早就不在 fixtures 里了。
