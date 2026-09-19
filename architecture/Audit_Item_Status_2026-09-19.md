# 审计项状态台账（2026-09-19 重建）

## 为什么要重建

原 `architecture/Backend_Frontend_Architecture_Audit_2026-09-17.md`（43 节、约 69 KB）
**已丢失**：磁盘上没有、git 从未跟踪（`git log --diff-filter=A` 为空）、家目录与各工作区
均无副本。它从始至终是未跟踪文件，而 g4 的 workspace hygiene 只查
`go|ts|tsx|js|mjs|cjs|sql|json|yaml|yml`，不查 `.md`，所以删了也不会有任何门禁报警。

本文件是这份台账的**重建版 + 结论版**：只记「这项是什么、核到哪一步、结论是什么、
证据在哪」。它提交进 git，不再受未跟踪文件丢失的影响。

基线：`55ccbd4`（Rev 237，2026-09-19）。

## 已闭环

| 项 | 内容 | 证据 |
|---|---|---|
| MARKET-DEAD-MORE-001 | market.tsx 4 处无 onPress 的 `•••` 死按钮 + 零引用 `detailMore` 样式移除 | `scripts/check-regression-contracts.sh` 同名钉 |
| PUBLISH-NO-FAKE-DEFAULT-001 | 发布表单 title/time/location/priceMin 改空初始值 + placeholder（不再预填假文案与金额） | 同名钉 |
| OPP-TYPE-OTHER-001 | 商机类型新增 `other` 未分类兜底；关键词全不中不再 return `coffee_photo`；样张复用咖啡不新增 require（media R1） | 同名钉 |
| SCENE-HUMANS-EMPTY-001 | 场景「适合一起的人」空态明说「还没有人」，区分空数据与加载失败 | 同名钉 |
| 27 钱包 | 已是诚实空态：余额/待结算显示 `—`，文案「账本未接入，未知不画数」 | `me.tsx` 钱包与结算页 |
| 38 假关注者脸 | 已摘（真数字保留，装饰脸移除） | AUDIT-BATCH3-005 |
| 40 法律横幅 | 已挂载 + 开机拉一次 + 回前台刷新 | AUDIT-BATCH3-003 |
| 31 收藏真实数据 | 真接线，不是空态：`me.tsx:1093` 调 `engagement.listUserBookmarks(viewerAccountId, 60)` → `localNet.listPostsByIds` 直取（PROFILE-SAVED-001 已修掉「拿默认 25 条动态过滤」导致收藏被吞的旧洞）；失败走 `setPersonalSavedFailed`，与「空收藏」是两个态 | `apps/mobile/src/surfaces/me.tsx:1093`、`engagement-client.ts:244`、`engagement-client.test.ts:588` |

## 明确不做（合规约束，不得回退）

| 项 | 内容 | 依据 |
|---|---|---|
| 阅后即焚 / 查看上限 / 防截屏的**消耗** | 客户端 `markMessageRead` 零调用方**不是漏接线**：付费会话（OriginType TASK / SERVICE / ACTIVITY / NEED / OFFER / ORDER）禁用阅后即焚、查看上限、防截屏，服务端强制。我曾把收件人侧的次数消耗接上（让「看一次就销毁」真的烧），**已全部撤回**，并改成合规钉 `COMP-EPHEMERAL-001`（守住服务端付费闸 + 禁止客户端自行消耗） | `docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md`「功能层面的硬性约束（不得回退）」第 1 条；同文档 Review Checklist 的「法务 review：防截屏 / 阅后即焚 / BURNER 在越南 / 东南亚的法律风险」**未勾选** |

**遗留（未处理，需产品/法务定）**：客户端「安全对话」面板里的「阅后即焚」6 档开关
（`conversation.tsx` 的 `BURN_OPTIONS`）**没有按来源关闭** —— 付费会话里也能开，而服务端
会以 `ErrEphemeralNotAllowed` 拒绝。即 UI 仍在承诺一件服务端不允许、法务未过的事。
未擅自改动，因为它同时牵着「禁止转发」等同面板设置，且是否保留社交会话下的阅后即焚
属于产品/法务判断。

## 半截 / 待定（都能定位到具体缺口）

| 项 | 现状 | 判断 |
|---|---|---|
| 35 通知中心 | **五层建了四层，用户可见度 0%**：①生产者——outbox worker 按事件写 `notification.inbox_items`（订单成立 / offer / 邀请），`NOTIF-INVITE-OFFER-001` 钉住路由给对了人；②读接口——`ListInbox` / `MarkInboxRead` / `ResolveDeepLink`，`NOTIF-INBOX-GATE-001` 钉住写走 operator 门、读保持开放；③移动端 SDK——`notification-client.ts` 有类型化 `InboxItem` 与三个方法；④文案——`me-sub-pages.ts:248` 的「通知中心」带用途说明（「系统事件与真人聊天分开，避免订单、时间、安全和好友请求淹没 Conversation」）。**缺的是⑤：入口 + 页面 + 路由**。`surfaces/` 下没有任何 notification/inbox 文件；`"notifications"` 这个 key 全仓只有它自己那一处，没有任何 `openSubPage("notifications")` / `route: "notifications"`；而 `NotificationClient` 在 `native-app.tsx:162` 实例化、`:269` 传进 `AppShell`，`app-shell.tsx:136` 解构出来后再无引用（无 spread 转发）——**通道接了一跳就断了** | 后端与 SDK 已就绪，缺的纯粹是 UI。**入口形态（Me 子页行 / 顶栏铃铛）与列表形态是产品承诺，我不单方面定**。若走 Me 子页，注意本仓已有测试钉住的不变量 `SUBPAGE-GENERIC-FABRICATED-001`：菜单可达 + 无专属分支 ⇒ 不许带 `sections`，兜底渲染诚实的「正在准备这个工作区」——别为了让它「看起来有内容」而配一张假表 |
| 30 结算记录 | `me-orders.tsx`、`order-execution.tsx`、`voucher.tsx` 均有 settlement 相关代码 | 需逐项辨真伪（真数据 vs 壳），未逐条核 |
| 32–34 商家模块 | `business-home.tsx`、`merchant-storefront.tsx`、`merchant-me-r21.tsx`、`my-store-recommendations.tsx`、`store-recommendation-queue.tsx` 均已存在 | 同上，需逐项辨真伪 |
| 37 OTP 重发冷却 | **服务端有、客户端没显示**：`OTP-THROTTLE-001` 已在（`identity/service.go:506-509` 1/min、10/hour 滑窗，拒绝时 `OTP_THROTTLED` + `safeDetails.retryAfterSeconds: 60`，`service_test.go:645` 钉住）。客户端 `native-app.tsx:756` 的「重新发送」只按 `busy` 置灰，**不读 `retryAfterSeconds`、没有倒计时**——用户点下去只会拿到一句「无法重新发送验证码：…」。契约里 `ErrorEnvelope.safeDetails` 是 `Record<string, unknown>`，值已经到客户端了，**纯客户端可修** | 缺口是「UI 不反映服务端状态」，与刚处理的合规那条同源（UI 承诺一件服务端会拒的事）。修起来自洽、无产品形态问题，是剩余项里最该先做的一条 |
| 39 内部 QA 清单 | **未发现残留**：生产设置相关 surface 与全仓搜 `checklist` / `自检` / `上线前` / `验收清单` / `通知中心` 均无命中；仅两处无关引用（`privacy-settings.test.ts:7` 注释指向 `docs/compliance/`、`placeholder-honest-actions.test.ts:346` 的 `PLACEHOLDER-006 checklist walk gaps` 测试名） | 判定已清掉 |
| A 级 token 缺口 | `DESIGN-CLEANUP-001` 的注释写明只做了「token 纪律**第一批**」，且 **B 档（lotus 定值）/ C 档（Tailwind 返工）/ ProxyEmptyLine 明确「不在本轮」**。`me-styles.ts` 仍有 175 处硬编码 hex（含大量刻意的色调变体） | 剩余是**已声明的延后批次**，不是漏做；纯样式、零语义。优先级低于 37 |

## 本轮顺带修掉的 5 条失效钉（产品行为一行没动）

原审计批次里的修复本身都在，红的是 shell 钉里过时的针。每一条都先分清「钉过时」还是
「真回归」，确认能力还在，再把针换成当前形态，并各自反向注入见红。

| 钉 | 旧针失效的原因 |
|---|---|
| ADD-FRIEND-ENTRY-001 | 好友页重复「添加好友」按钮被 002 摘掉，旧针仍要求它存在，与 002 直接矛盾。已核实 ADD_FRIEND 仍由 `me.tsx` / `messages.tsx` 以 `initialView="ADD_FRIEND"` 挂载 |
| ADD-FRIEND-FROM-MESSAGES-001 | MSG-SCAN-SHORTCUT-001 后 `onOpenAddFriend` / `setShowAddFriend` 整套改名成 `scanShortcut` |
| SCENE-ADDRESS-001 | threebeans_bn 地址真机实测后更正（Lê Văn Thịnh → 109 Lý Chiêu Hoàng），钉写死旧街道名 |
| FEED-SAVED-COUNT-001 | 收藏在 FEED-ACTION-ICONS-001 后从文字态变图标态，测试已升级、钉没跟上 |
| AUDIT-BATCH3-001 | 漏斗副标题在 PROFILE-VISIT-001 接上真实主页访问数后改了措辞，同样是测试升级、钉没跟上 |

**另有一条是钉本身写错**：`STORE-AMENITIES-001` 让 `104_store_amenities.sql` 去 grep 自己的
文件名，而全仓 121 个迁移文件没有一个自报名字 —— 条件恒假，这条钉从写出来起就没绿过
（门禁每次都在更前面退出，从没轮到它）。已改为钉「文件存在 + 幂等新增 + 客户端类型在」。

## 一条方法论

`SCENE-ADDRESS-001` 的 Go 测试一直是 PASS 的，红的是同一条钉里的 shell grep。
**测试绿不代表钉绿**，两边都要看。反过来，「没见红」也不等于「是绿的」——
`STORE-AMENITIES-001` 就是这样藏了很久。

## 一条门禁特性（本次踩到）

`GATE g2` 跑的是**工作区**，不是暂存区。所以别人未提交的中间态会红在你的提交上：
本次 Rev238 首次提交就因 `design-system-r3.test.ts`（UI 文字 ≥11pt 白名单）红掉，
而单独跑该文件立刻 PASS —— 是那一刻工作区里存在过的一个瞬时违规，不是我的改动。
判据：把红的那个测试单独跑一遍，绿了且自己没碰相关文件 ⇒ 重试提交，别去改别人的代码。
