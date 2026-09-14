# Design baseline changelog

Every intentional change to a baseline-sensitive implementation must update
this file and `CURRENT_BASELINE.json` or `IMPLEMENTATION_CONTRACTS.json` in the
same commit. Do not record routine business logic changes here.

## Revision 185 — 2026-09-13

- REPLY-TARGET-001：个人主页 REPLIES tab 现在能回答「我回复了谁的帖子」。
  - **原来的三个毛病叠在一起**。①服务端一直在发 `parentPostId`（这条回复挂在哪条
    帖子下面），但客户端从来没读它 —— 于是这一栏唯一有用的信息被丢掉，只剩一句
    光秃秃的「你回复了」；而 `ProfileTabs.tsx` 里那行注释还断言「server Reply 暂没
    parentPostId 字段」，让这个降级看起来是永久性的（实测每条 reply 都带这个字段）。
    ②「你回复了」是**写死的** —— 看**别人**的主页时，别人的回复也在说「你回复了」。
    ③React key 用了 `reply.postId`。同一条帖子可以被同一个人回复多次（真实数据里
    就是这样：两行 `postId` 相同、`replyId` 不同），两行于是撞成同一个 key。
  - **父帖用 PROFILE-SAVED-001 的 `ListPostsByIds` 回查**，不再新增服务端命令：
    可见性口径与动态流完全一致 —— 已删、或已收紧成「仅关注者可见」的帖子取不回来，
    这一行就退化成中性文案（「你回复了这条帖子」），不猜、不编、也绝不把 account id
    当名字显示。名字一律走 `feed-author` 的 `resolveAuthorDisplayName`，与 feed 和
    评论共用同一个身份判定，保证同一个人在任何一栏里都是同一个称呼。
  - **回复不再伪装成 `FeedPost`**：新增 `ReplyEntry`（`replyId` / `parentPostId` /
    `body` / `createdAt`），key 改用 `replyId`。顺带删掉了「把回复作者硬写成
    `viewerAccountId` / `target.userId`」的伪造 —— 那正是当初「回复 @{authorId} 的帖子」
    永远显示自己的根因。`viewerMode` 现在参与文案（SELF「你回复了 X 的帖子」/
    OTHER「回复了 X 的帖子」），引用块展示原帖摘要（`numberOfLines={2}`）。
  - 新增 `apps/mobile/src/reply-target.ts` 纯函数模块（20 条 vitest），并在
    `scripts/check-regression-contracts.sh` 登记 REPLY-TARGET-001（9 条正向 pin +
    3 条反向 pin，13 个注入用例全部验证过会红）。

## Revision 184 — 2026-09-13

- MENTION-001：个人主页 TAGGED tab 从「一页动态的子串扫描」改成服务端全量提及查询。
  - **原来的三个毛病叠在一起**。TAGGED 是客户端拿**一页**动态（默认 25 条）做
    `body.includes("@handle")` 筛的：①比你这一页更早的提及直接消失，用户被提到
    50 次也只看到 2 次；②子串匹配，`@thanh2` 被算成提到了 `@thanh`，看到与自己
    无关的帖子；③`contextType === "MENTION"` 那一支是**死代码** —— 服务端任何地方
    都没写过 MENTION 这种 contextRef（分类器只产出 DEMAND / VENUE / ACTIVITY /
    PEOPLE_RELATIONSHIP / INDUSTRY_INFO / GENERAL / OPPORTUNITY），那个条件永远为假，
    却被当成「另一条能用的路径」。
  - **服务端新增 `ListPostsMentioning`**（payload `{handle, limit}`）。SQL 与内存仓
    两条路径共用同一个 `MentionRegex` / `containsMentionHandle` 定义：整 handle
    边界匹配（`@Comple` 不匹配 `@Complex`，因为后面跟的是 handle 字符），大小写不敏感。
    可见性/静音口径与动态流**逐条对齐**（PUBLISHED + PUBLIC 或作者本人可见 +
    排除已静音作者），并额外排除自己的帖子。handle 缺失或空白时 **fail-closed 返回空**，
    绝不退化成「返回全部帖子」。
  - **客户端**：TAGGED 改走 `localNet.listPostsMentioning(profileDraft.handle)`，
    顺带**不再需要 `listFeedPosts()`**（少一次整页拉取）。同时修掉一个耦合 bug：
    TAGGED 原来被塞在收藏那条 promise 链里，收藏一失败 TAGGED 就静默空掉，看起来
    像「没人提到过我」；现在两条独立加载。effect 依赖也补上了 `profileDraft.handle`
    —— 之前依赖的是 `profileDraft.name` 却在逻辑里用 handle，改 handle 不会刷新。

## Revision 183 — 2026-09-13

- PROFILE-SAVED-001：收藏按 ID 直取，并修掉一个会让收藏 tab 全量失效的信封 bug。
  - **收藏不再从动态流里捞**。之前 `me.tsx` 拿一页动态（默认 25 条）按 bookmark
    id 过滤 —— 收藏一条不在这一页里的帖子就等于丢了，用户会以为收藏被吞。新增
    服务端 `ListPostsByIds`（复用已有 `GetPost`，无迁移、无新表），可见性口径与
    动态流一致且 fail-closed：FOLLOWERS 只有作者本人可见，取不到的 ID 跳过而不是
    整条失败，上限 100 条、去重、trim。
  - **媒体口径合并**。`hydratePostMedia` 从 `listFeed` 里抽出来，两条读路径共用
    同一份媒体契约，同一条帖子在动态流和收藏夹渲染结果一致（真机服务实测 15 条
    带媒体帖子逐字节相同）。
  - **信封必须真的能 dispatch**。客户端最初发 `target.id = ""`，而
    `internal/api/command_dispatch.go` 的 `validateEnvelope` 在 dispatch **之前**
    就要求 `target.id` 非空 —— 收藏 tab 每次加载都会抛错。批量读没有单一聚合，
    改用显式哨兵 `by_ids`（与 `CreatePost` 的 `new` 同属「命名操作、不假装是真实
    聚合」的惯例）。
  - **拒绝信息不再是无字天书**。`validateEnvelope` 过去返回空的 `safeDetails`，
    又因为拒绝发生在 dispatch 之前，日志里「命令不存在」和「信封不合法」长得
    一模一样。新增 `missingEnvelopeField` 指名第一个缺失/过短的字段（沿用
    requestedAt 分支已有的 `field` 约定），并顺手删掉 `invalidEnvelope` 那个
    从未被使用的 `*http.Request` 参数。

## Revision 182 — 2026-09-13

- PROFILE-TABS-001：个人主页 5 tab 的可见性与真数据。
  - **收藏不上他人主页**。之前 `ProfileTabs` 无条件渲染 IG/Threads 那 5 个 tab，
    SAVED 也在里面 —— 别人的主页上摆「收藏」等于把他的私人书签当公开内容展示。
    现在走 `visibleProfileTabs(viewerMode)`：只有 `SELF` 才给 SAVED，**viewer
    身份未知一律不给**（fail-closed），少一个 tab 也强过泄露别人的私库。
  - **他人主页的「回复」tab 不再恒空**。`other-profile.tsx` 之前把 `replyPosts`
    硬编码成 `[]`，5 个 tab 里有 3 个永远是空态；现在走
    `ListUserReplies(target.userId)` 拉真数据（回复是公开内容）。SAVED / TAGGED
    保持空态 —— 收藏是私库，标记目前只有客户端侧说法、没有服务端依据，宁可留空
    也不编数据。
  - tab 顺序抽成 `PROFILE_TAB_ORDER`；当前 tab 被隐藏时回落 POSTS，不留空白页。

## Revision 186 — 2026-09-14

- 我的 Tab IA 重构：设置与隐私 / 我的隐私 合并为单一「设置与隐私」模块
  （隐私与数据区：PDPA 下载/删除 + 定位授权并入）；企业/店铺从账户组移出
  独立成组，新增「推荐商铺进体系」入口（STORE-REC-001）。
- 有视觉改动：我的页分组结构、设置与隐私子页、新推荐商铺表单。

## Revision 181 — 2026-09-13

- FEED-REPLY-001 / FEED-REPLY-002：动态评论的作者身份与折叠规则。
  - **评论作者不再显示账号 ID**。`ListPostReplies` 现在按 profile 解析
    `actorDisplayName`：读时解析、按作者去重，不落库、不接受客户端提供
    （`ReplyToPost` 里塞什么都不作数）。`cmd/api/main.go` 给 engagement 接上
    `SetAuthorNameResolver`，与 localnet / socialspace / marketplace 走同一条
    权威链路。解析不到时客户端退化成中性标签「用户」，绝不回显 `actorId`；
    profile 里历史脏值「你」同样不作数，避免别人的评论显示成"你"。
  - **评论不再全折叠**。帖子进列表即预取评论，首屏固定显示前 5 条，超出才
    收进「查看其余 N 条回复」，展开后可收起（Threads 式）。规则抽成纯函数
    放在 `apps/mobile/src/reply-preview.ts`。

## Revision 180 — 2026-09-13

- 活动冷启动种子的 AI persona 写真路径从旧 SVG（ai-personas/ai_00X.svg）
  统一为新 PNG（ai-personas/photos/ai_00X.png），与首页/消息/AI-ASSIST-001
  目录的写真资产三处同步。activity 卡片的可见头像仍走
  aiPersonaAvatar/aiPersonaName（emoji + 名称），此字段为资产元数据
  一致性修正，不改渲染。

## Revision 179 — 2026-09-13

- COMP-REPORT-002（续完）：举报入口补齐最后四类 —— **活动 / 商家 / 机会 /
  邀约**。至此法律文件 §38 承诺的八类目标，用户在界面上都点得到。
  - 活动详情页底部常驻两个入口：举报这条活动（ACTIVITY，target=activityId）；
    主办方是商家时再列一个「举报主办商家」（MERCHANT，target=ownerId）。
    只列商家入口当且仅当 `origin === "MERCHANT"` 且 ownerId 非空 —— 报上去
    一条查不到的 id 比没有入口更糟。
  - 订单详情页（机会详情）底部常驻入口：公开机会报 OPPORTUNITY、定向邀约报
    INVITE（同一个服务端实体，区别只在 targetAccountId 是否为空），
    target 一律用服务端 opportunity.id。
    **刻意不用**界面上那个 `PX-O-…` 编号：它是 `formatTraceId` 客户端随机
    生成的展示号，服务端根本不认，报上去等于白报。
  - 「这一类对象该报成哪一类」抽成 `moderation-client.ts` 里的两个纯函数
    （`activityReportTargets` / `opportunityReportTarget`）而不是写在 JSX 里，
    因为入口还会继续增加，判定逻辑必须能被单独测试。
  - 门禁 pin 一并从「JSX 里的 targetType 字符串」改为「判定函数名」——
    上一笔把内联弹层抽成 ReportSheet 时，钉字符串的那条 pin 直接误报：
    能力还在，只是实现挪了位置。
  **有视觉改动**：活动详情底部多一排举报按钮（1–2 个）；订单详情底部多一个
  「举报这条机会 / 邀约」按钮。

## Revision 178 — 2026-09-13

- COMP-REPORT-002（续）：举报入口补齐**账号**与**交易**。
  上一笔只做了「消息」，8 类里用户能点到 2 类。这两类和消息同属高风险面，
  而且各自对应不同的事实形态：冒充身份是看**整个账号**看出来的（不是某条
  帖子），诈骗与招嫖揽客落在**订单**上（不是某条消息）。
  - 他人主页（other-profile）顶栏加「举报」→ 报 ACCOUNT（target=userId）。
  - 我的订单 → 订单详情加「举报这笔交易」→ 报 TRANSACTION（target=orderId）。
  - 原因选择抽成共用组件 `components/report-sheet.tsx`，三个入口共用同一份
    REPORT_REASONS —— 各抄一份的话，迟早有一份忘了跟着更新理由清单。
  - 会话页改为复用该组件（原来那份内联实现删掉），理由排序与错误提示
    因此与另两个入口一致。
  **有视觉改动**：他人主页顶栏多「举报」；订单详情多「举报这笔交易」按钮；
  会话的举报弹层改用共用组件（结构一致，配色随共用样式）。
  仍未接入口：活动 / 机会 / 商家 / 邀约（4 类）。

## Revision 177 — 2026-09-13

- COMP-REPORT-002（越南合规整改）：举报入口要真的能被用户点到。
  上一笔（176）把服务端接上了，八类目标全部受理，但移动端入口只有
  feed 帖子菜单里的「举报」—— 用户能碰到的仍然只有 1/8，而招嫖揽客、
  人身威胁、涉未成年人这些恰恰发生在**消息**里。接口接得上而用户点不到，
  等于没改；那正是我在 COMP-E2EE-002 里刚批评过的同一个毛病
  （改了后端就宣称解决了）。
  新增 `src/moderation-client.ts`（`reportTarget`）并在会话页长按菜单加
  「举报」→ 原因选择。理由清单里 SOLICITATION（招嫖 / 线下付费招揽）与
  MINOR_SAFETY（涉未成年人）**排在前面** —— 用户慌的时候要能一眼找到，
  不该让他翻九行。
  **有视觉改动**：会话长按菜单多一项「举报」，新增原因选择底部弹层。

## Revision 176 — 2026-09-13

- COMP-REPORT-001（越南合规整改）：把「用户举报」真正接下来。
  服务条款 §38 与隐私政策都承诺用户可以举报内容 / 消息 / 账号 / 活动 /
  机会 / 商家 / 邀约 / 交易，但代码里只有 `engagement.ReportPost` 一个
  入口 —— 承诺 8 类，接得上 1 类，而最重的刑事风险（刑法 327 条介绍卖淫）
  恰恰发生在 MESSAGE / ACCOUNT / TRANSACTION 上：没有入口，平台既收不到
  线索，也拿不出「收到过、处理过」的证据。电商法 122/2025 与
  NĐ 147/2024 也都要求平台提供举报受理渠道。
  新增 `internal/moderation`（命令 `ReportTarget`）+ 迁移
  `086_moderation_reports.sql`（`moderation.reports`，append-only）。
  理由枚举补上了 MINOR_SAFETY 与 SOLICITATION —— 原接口只有
  SPAM / HARASSMENT / UNSAFE / OTHER，涉未成年人与线下招嫖只能塞进
  UNSAFE，运营看不出该优先处理哪一条。
  本包只做受理与留痕，不做裁决、不做自动处置（要人判断）。
  一律 fail-closed：目标类型不认识、目标 ID 为空、理由不认识、举报人身份
  拿不到，全部拒绝；写库失败必须报出来，不能当成「已受理」。
  **无视觉改动**（接口层，移动端尚未接入举报入口）。
- 同步：`openapi.commands.generated.yaml` 重新生成（210 → 211 条），
  并把新域 `moderation` 登记进 `openapicmds.DomainDir`（不登记的话
  生成器扫不到新命令，spec 会静默缺失）。

## Revision 175 — 2026-09-13

- COMP-E2EE-002（合规整改）：用户看得到的地方不许出现做不到的加密承诺。
  001 只钉住了后端字段，但真正对用户作出承诺的是 UI 文案与法律文件：
  设置页「安全」卡片原本直接显示「🔒 端到端加密 / 军用级 AES-256 /
  已开启 · 始终保护」；ToS §16 把它列进 Secure Chat 功能清单；隐私政策
  原文写着「如果 Proxy 明确标记某会话为端到端加密 Secure Chat…」。
  平台没有 E2EE，这些都是虚假陈述（RFC 里甚至直白写着「这是让人觉得
  安全」）。改为如实表述：卡片改成「🔒 加密与访问控制」+ 传输/静态加密
  说明 + 「不提供 E2EE（端到端）加密」；法律文件改为明确声明目前不提供，
  并说明为履行法律义务、处理举报与安全审计可能访问通信内容。
  **有视觉改动**：设置页第一张安全卡片标题与正文文案变化。
  门禁新增 COMP-E2EE-002：法律文件不许把它当功能列、必须写明不提供；
  `apps/mobile/src` 里该能力名一律不得出现；HTML 原型不许再画该徽标。
- 同步修订：`docs/legal/vietnam/*`（3 份）与 `apps/api-go/internal/api/
  legal_docs/*`（go:embed 实际对外服务的那份，是另一份拷贝，同样要改）。

## Revision 174 — 2026-09-13

- COMP-E2EE-001（合规整改）：不再宣称做不到的加密。
  `MessageProtection.EndToEndEncrypted` 此前恒为 true，理由写的是
  「transport TLS + at-rest KMS」—— 那不是端到端加密，两种情况服务端都能
  读到明文。对用户挂一把兑现不了的锁是虚假安全声明，且与 COMP-CHAT-001
  冲突（付费会话必须保留可审计记录）。默认值、发送路径、序列化边界三处
  都钉死为 false；`security.mode` 的判定不变（以前实际生效的一直是
  ScreenshotProtected）。**无视觉改动** —— 移动端从未读取该字段。

## Revision 173 — 2026-09-13

- COMP-AI-MINOR-001（越南合规整改）：AI 伴侣 / 数字分身不对未成年人开放。
  越南 AI 法 134/2025/QH15（2026-03-01 生效）要求对未成年人采取保护措施，
  陪伴型 AI（数字分身、平台 AI 角色）是点名场景。`CreatePersona` 现在在建
  之前先查年龄（前置的年龄信号来自 COMP-AGE-001）：没接查询 / 没有年龄证据 /
  确认未成年，三种都拒绝。**无视觉改动**；成年人不受影响。
  ⚠️ 副作用：注册在 COMP-AGE-001 之前的历史账号没有年龄断言，需要补一条
  才能建分身 —— 这是 fail-closed 的代价，我们主动选的。

## Revision 172 — 2026-09-13

- COMP-AGE-001（越南合规整改）：把注册时那条已经通过 18+ 判定的出生日期
  留下来。`CreateAnonymousSession` 一直在服务端判 18+，判完就把
  `dateOfBirth` 丢了（`identity.user_accounts` 没有任何年龄字段）——
  于是「这个用户满 18」只在注册那一瞬间成立，无法复查、无法举证，
  AI 法 134/2025 要求的未成年人保护也因为没有年龄信号而无从做起。
  新增 `identity.user_age_assertions`（migrations/085，append-only，
  按 asserted_at 取最新；只存出生日期，不存证件影像）。
  走与同意记录相同的可选接口断言，缺表不会拖垮注册主流程。
  **无视觉改动、无 API 契约改动。**

## Revision 171 — 2026-09-13

- COMP-SELLER-001（越南合规整改）：供给侧实名成为准入条件。
  越南电商法 122/2025 + NĐ 248/2026（2026-07-01 生效）禁止匿名销售，
  而此前 supply 侧只有「能力验证」（会不会中文），完全没有「是谁」的证据。
  新增 `supply.seller_real_name_verifications`（migrations/084），
  `Eligibility` 增加 `realNameVerified`，未实名或未接查询的卖家不再进候选集
  （fail-closed）。**无视觉改动**；`Candidate` 快照多一个布尔字段。
- ⚠️ 已知副作用：库里目前没有任何实名记录，因此**开发环境的撮合候选集会是空的**，
  直到为对应 agent 写入 status='VERIFIED' 的记录（method=OPERATOR_ATTESTATION
  时需有具名的 verified_by）。这是刻意的，不是 bug。

## Revision 170 — 2026-09-13

- COMP-ID-002（越南合规整改）：`apps/api-go/cmd/api/main.go` 里把
  「账号是否交易过」的查询接到真实资金表（`payment.payment_intents` /
  `payout_holds` / `ledger_entries` / 已结算 `fulfillment.orders`）。
  此前 `SetTransactionHistoryLookup` 没有接线，COMP-ID-001 的守卫恒为
  fail-closed —— 安全但等于没查，形同虚设。**无视觉改动、无 API 契约改动**；
  新增 `migrations/083` 只加索引。
- TEST-ABSDATE-001 / 002：修掉两处「测试夹具写死绝对日期」的时间炸弹。
  **无产品视觉改动、无行为改动**，只动测试夹具。
  - `apps/api-go/internal/business/service_test.go`：`bucketDate` 写死
    `2026-09-06`，而 `GetMerchantOperatingHome` 走的是 7 天滚动窗口，
    日期滚出去后 `OrderCount` 恒为 0，代码没动而 g2 全红。改为按当天现算。
  - `apps/mobile/src` 17 个测试文件：`SecureSessionStore.write()` 拒收
    `refreshExpiresAt` 不在未来的 session，夹具里写死的日期到点即过期。
    统一改为 `Date.now() + 30d`；`secure-session.test.ts` 里那条需要
    「已过期」的用例改为按该用例假时钟显式造过期，不再靠日期自然变老。
- 门禁新增两条钉子，防止同类写法再进仓库：api-go 测试禁止写死
  `bucketDate`，mobile 测试夹具禁止写死 `refreshExpiresAt`。

## Revision 169 — 2026-09-12

- FEED-SCOPE-001：时间范围判定从 `feed.tsx` 的两份内联拷贝抽成共用的
  `src/feed-scope-filter.ts`（`isPostWithinScope`）。两份拷贝此前已经漂移 ——
  横幅那个「已隐藏 N 篇」把 hidden/muted 的帖子也算进去，会多报。
  现在横幅的计数 = 「不筛选时可见数 − 当前可见数」，与过滤用同一个谓词。
  **无视觉改动**；未标注日期的帖子改为保留而非丢弃（此前会被静默过滤掉）。

## Revision 168 — 2026-09-12

- AI-ASSIST-001 相关：**5 张 AI 小美写真此前在常规开发启动方式下全部 404**
  （`personaPhoto` 用仓库根相对路径，而 `scripts/dev-api.sh` 从 `apps/api-go`
  启动）。首页 AI 助手行因此渲染 5 个空框。改为从工作目录向上定位仓库资源目录，
  环境变量 `PROXY_AI_PERSONA_ASSETS_DIR` 仍优先。**这是把本该显示的图片显示出来，
  不是视觉改动。**
- 启动种子 `seedPostgresMedia()` 不再无条件把资产写成 `READY`：文件不在
  media_store 里就写 `FAILED` 并打日志。此前手工修好的状态会在下次 API 启动时
  被重新覆盖成「有字节」的谎言，导致图片重新变成黑块。**无视觉改动。**

## Revision 167 — 2026-09-12

- SCROLL-CHROME-001：六个信息流页面（messages / feed / market / me /
  requester-home / business-home）原先各抄一份「上滑隐藏 chrome」的逻辑，
  现统一到 `apps/mobile/src/shell/scroll-chrome.ts`。**页面视觉样式不变**；
  变的是交互行为：隐藏 chrome 之后 150ms 内忽略 scroll 事件，避免
  「内容高度骤减 → offset 被 clamp → 负 delta 被当成用户上滑 → 又显示」
  的无限振荡（表现为消息列表滑到底部自动弹回中部、顶部 logo 黑屏/显示闪）。
  market 原有的 nearBottom 否决（到底部保留工具栏）通过 canHide 保留。
- FEED-SCOPE-001：动态时间范围不再默认「近 7 天」（改为长期），
  正在按时间筛选时显示可关闭的横幅。**这是信息架构改动，不是视觉改动**：
  原先 62% 的帖文被静默隐藏且无任何提示。
- MEDIA-FILE-001：图片加载失败不再渲染成黑块，改为带文案的占位
  （`media-unavailable-v1`）。**这是新的可见状态**，此前该状态被黑块掩盖。

## Revision 166 — 2026-09-12

- 修市场订单 / 活动双页 Pager 的发布向导双实例：订单向导只驻留订单页，活动向导只驻留活动页；移除状态切换时强制重建 ScrollView，已加载活动刷新保持原卡片，避免上下切换闪屏。
- 头像本机副本按 `userAccountId` 分区命名、首帧只读当前账户目录；账户 id 到达后重新挂载资料页，禁止同机账号先闪出另一人的头像。
- 页面视觉样式不变；补充 UI 回归守卫，固定单实例发布和账户头像边界。

## Revision 165 — 2026-09-12

- AI-ASSIST-001：首页 AI 助手推荐目录（AI-ASSIST-001）—— 5 小美公开目录
  （/v1/ai/assistants，匿名可读）+ AI 标签 + 关注/发消息。目录改名/换色必须
  服务端/种子/SVG 三处同步；AI 能力不扩大到接单/报名/收付款（服务端门禁）。
  照片走服务端原文件直出（/v1/ai/personas/photo/{id}），客户端不复制第二份。
  首页「真人推荐」之后渲染 AIAssistantsRow，与真人推荐分开不混排。
- AI-CONV-001：小美主页发消息固定 PROFILE origin，进消息模块 inbox。
- AI-POSTS-001：5 小美开屏帖（AI_NATIVE + 写真，AI_PERSONA provenance），
  帖子 Upsert 幂等，动态卡 AI 生成徽。

## Revision 164 — 2026-09-12

- 修「个人主页头像保存不上」：`me.tsx` 的 chooseProfileAvatar 最外层 `catch` 此前是
  静默 `catch { setProfileAvatarUri(selected.uri) }` —— 相册原 URI 只在本进程有效，
  本地落盘（documentDirectory 副本 + SecureStore 记录）一旦失败，头像看着变了、
  离开页面或重启即回字母头，且**不报错**，用户和测试都看不见。现在显式报出真实
  原因（`[proxy.AVATAR-SAVE-001] local avatar persist FAIL` + 错误提示），不再假装
  保存成功。
- 门禁补强 AVATAR-SAVE-001：`scripts/check-regression-contracts.sh` 新增守门 ——
  me.tsx 必须保留该显式报错路径、profile-store 必须有头像往返断言（写入→读回、
  绝对沙盒 URI 归一成文件名、clear 后不留陈旧头像）。此前只有 AVATAR-001 守
  profile-store 的文件名规范化（单元级），守不住整条保存链路。
- 修「换完头像被默认重置」（AVATAR-002）：服务端 hydration 把
  `remote.avatarPath`（形如 `assets/<mediaAssetId>`，是媒体 id 不是本机文件名）
  直接 `avatarFileName()` 后写进本地记录，覆盖掉 documentDirectory 里
  `avatar-<ts>.jpg` 的指针 → 重启/离线回字母头。现改为经
  `mergeRemoteProfile()` 合并：本地副本文件名优先，仅在本地无头像时才用服务端
  派生名。AVATAR-001 修的是本地规范化，这条是等价问题从**服务端回灌路径**复发，
  新增 AVATAR-SAVE-002 守门（profile-store.ts / me.tsx / 测试三处 grep + 实跑）。
- 发布需求向导（非基线敏感）：城市协助 · Professional 服务卡在选 Moment 那一步
  默认展开，且支持再点一次取消选择（取消时一并清掉城市协助模板，避免悬空态）。
- 头像再次「被重置」的真因（AVATAR-DELIVER-001）：服务端对上传媒体一律
  `OWNER_ONLY`，而 `/v1/media/thumb|play/{id}` 要求 `APPROVED && PUBLIC` 才服务
  （fail-closed），只有发帖/上架店铺会在事务里提权到 PUBLIC —— 更新个人资料这条
  链路没做，于是头像 URL 恒 404，界面回字母头。客户端先落兜底：hydration 改为
  **本地副本优先**（离线可用、不受可见性约束），远端仅作后备；服务端同步补齐：
  `UpdateProfile` 落库前调 `AuthorizeForPost(ctx,[mediaAssetId],actor,"PUBLIC")`，
  提权失败即拒绝整条命令（不写「存了但显示不出来」的半成品），`cmd/api/main.go`
  装配 `SetProfileMediaAuthorizer(mediaService)`。
- 头像「切页回来先闪旧头再刷成新头」（AVATAR-FLASH-001）：hydration 异步返回前首帧
  `profileAvatarUri` 为 undefined，于是先渲染字母头/占位再被异步结果覆盖。改为
  useState 初值直接同步读本机最新副本（expo-file-system list()/File 是同步 API），
  首帧即为新头像，不再有这一跳。
- 头像副本只增不删（AVATAR-GC-001）：每次选图新建 `avatar-<ts>.jpg`，真机实测堆到
  23 份。现在换头像后只保留本次那一份，其余 `avatar-*` 删除；单文件删除失败不影响
  换头像主链。


## Revision 163 — 2026-09-11

- 商家 Creator 推荐轨的服务端 seed 升级：boot seed 从 3 个 photos='[]' 的 agent 扩到 6 个带真实头像 URL 的 Creator（Linh/Mai/An/Thao/Yen/Minh，覆盖 hn/hcm）+ 档期窗口随 boot 滚动（now+1h..now+72h），使 `MerchantCreatorRecommendations`（supply.querySuppliers({marketId,limit:6})）不再空轨。
- 守护：`MERCHANT-CREATOR-LIVE-002` 两个 Go 用例（≥5 个 hn 头像可用 Creator；可用窗口覆盖客户端查询区间且随 boot 前滚）。
- 注：分支 fix/merchant-creator-live 的移动端部分（门店地址推导 marketId + 旧 merchant-me-r21 结构）未合——HEAD 已把该面换成 merchant-me-r21-replacement → MerchantCreatorRecommendations（marketId 参数默认 "hn"）。门店→marketId 的来源仍待接（HEAD 无 marketId 传参点）。



## Revision 157 — R58 publish-flow catalog engine (2026-09-10)

- 发布流数据源升级为服务端目录引擎：`ListOpportunityTemplates` 一次匿名读全量下发分类轨道（热门/见面/娱乐/出行/主题，同 16 卡五视图）+ Moment 规格（人数/时间/时长/地点）+ 比例政策（固定 1:1 vs 小组容量合并）+ 动态定价（时长/时段/人数 delta、perPair × 搭档数）+ 活动创建预设（6 个多人完整玩法）。
- 客户端词表零硬编码：发布需求 Step1 改两栏分类目录（生成命中自动跳到所属分类），Step2 新增 Moment 规格节（chips 全部来自引擎数据 + 偏好加价 + 动态报价分解 + 比例徽章/多搭档提示）；发布活动改两步（预设选卡 → 一屏规格），发布 wire 载荷不变。
- R58 成功页 TraceID：需求 PX-N / 定向邀约 PX-O / 活动 PX-A + 编号卡；发布成功留在表单内展示，「查看市场/再发一个」显式交还控制权（列表仍即时刷新）。
- 守护：Go 交叉引用完整性（分类→卡、规格/政策/定价全覆盖、perPair 须固定 1:1）+ JSON 往返 + 预设完整性；wire 层守护测试钉死 dispatch map 逐字段下发（engine struct 测试抓不到 service 组装层丢 activityPresets 的实发 bug）；contracts schema 向后兼容（旧卡列表载荷仍过）；回归契约 152→162。

## Revision 155 — 2026-09-10

- 顶栏 logo 让出状态栏时间（与场景地图同式）；此前整页 Header 无安全区，属历史遗留。

## Revision 156 — 2026-09-10

- 顶栏改取满安全区：真机仍有轻微压字，按设备反馈补足。

## Revision 157 — 2026-09-10

- 顶栏高度随安全区一起长：固定 52 高里加 padding 会把 logo 挤出下边盖住地址行；地址行边距不动。

## Revision 158 — 2026-09-11

- 发布菜单新增 R58 发布需求向导（Moment 模板 → 规格确认 → 成功进市场）；订单/活动旧表单不动，菜单改纵排三项。

## Revision 159 — 2026-09-11

- 机会新增备注字段（可选，500 字内落库，详情页展示）；向导同步收集备注。

## Revision 160 — 2026-09-11

- 创建活动改走 R58 向导（模板 → 设置 → 预览 → 成功，编号展示）；旧单表单删除；服务端支持户外场地/报名方式/主题/展示编号。

## Revision 161 — 2026-09-11

- 市场机会改称订单；发布菜单改为创建订单（R58 向导：tabs/搜索筛选/选人/规格/成功）与创建活动；旧订单表单删除。

## Revision 162 — 2026-09-11

- 活动向导无场景时给显式重新加载入口；此前拉取失败即永久空列表。

## Revision 164 — 2026-09-11

- HOME / MESSAGES 主信息流补齐滑动显隐 chrome（CHROME-PARITY-001）：消息收件箱与首页接入与动态同款上滑藏、下滑/回顶显（阈值 -18/+28，回顶 48px 强制显），切 Tab 与卸载回显。修复 09-08 chrome-parity 分支只落地 FEED/MARKET 的遗留缺口——首页滚动 handler 曾是死代码、消息 prop 声明从未触发。

## Revision 154 — 2026-09-10

- 统一媒体资产管线：media/asset-sources 唯一解析入口（服务端媒体/绝对 URL/服务端路径/打包注册表/本地文件），作者头像映射收归 media/author-avatar；AI 人像注册表迁入管线，旧模块转调。
- 动态帖头首个接入：本人/AI 账号/AI 人像/首字统一判定；门禁 check-media-pipeline.mjs 拦新增散装实现。布局无变化。

## Revision 153 — 2026-09-10

- 市场滑到底部不再自动回弹：距列表底部不足 140pt 时抑制隐藏（隐藏会瞬间减 104pt 内容高度，底部 offset 被钳制回弹），底栏在底部保持可见。

## Revision 152 — 2026-09-10

- 市场列表滚动显隐与动态一致：下滑隐藏顶栏+底栏，上滑恢复；切 tab 与卸载时复位可见。
- 阈值与动态同源（下滑 28pt 隐藏、上滑 18pt 恢复，顶部 48pt 内强制可见）；其余 tab 行为不变。

## Revision 151 — 2026-09-10

- “我的”资料读取正式绑定当前 `userAccountId`，账户切换先清空上一账户视觉状态；禁止把无法确认归属的旧设备全局资料迁入新人账户。
- 更换头像接入媒体上传与服务端 Profile，其他设备通过媒体缩略图读取；选择头像本身即完成同步，不再隐藏依赖第二次“完成”。
- 新账户中性兜底不再包含 Huyen 演示身份；增加 Shell 接线与默认身份回归守卫，页面布局不变。

## Revision 150 — 2026-09-10

- 存量 "你" 展示名回填（079）：动态 / 状态 / 个人机会的脏展示字段清成空串，归属列不动；幂等可重放。
- 市场机会卡发布方走 viewer 相对作者标签，残留脏串中性兜底；卡片布局无变化。

## Revision 149 — 2026-09-10

- 服务端发布时不再信任客户端展示名：动态、状态、个人机会的作者名一律按已验证账户 profile 解析；无 profile 存空，读端中性兜底。
- 卡片布局无变化；未接线调用方（单测）保持旧回显行为，生产双路径均已接线。

## Revision 148 — 2026-09-10

- me 页 hydration 按账户隔离：服务端 profile → 本账户本地记录 → 同号旧记录继承 → 按登录标识派生 → 中性兜底；新账号不再显示写死的演示身份。
- 视觉无变化；profile 写盘 key 按账户隔离，同机多账号不再串名；发布器与状态流读同一账户的 profile。

## Revision 147 — 2026-09-10

- 真人能力页返回栏进入 iOS/Android 安全区，扩大点击热区，返回明确关闭全屏页并回到 Home。
- 历史活动数字改为可点击的公开履历；只展示本人选择公开的摘要，明确标注非公开记录不展示。
- Linh 样板补齐三条公开活动记录；该公开范围是产品隐私选择，不代表平台可公开全部履约明细。

## Revision 146 — 2026-09-09

- Home 真人头像进入全屏能力页；添加、主页、发消息提升至人物信息顶部，沿用 AI 主页的操作顺序。
- 页面核心改为可做事项、可邀请时间、历史活动、信誉评价、语言、主题和适合场景；Linh 补齐胶片 / 老城区 / 日落及河内场景关联。
- 共同好友属于关系内部信息，不再公开显示，也从首页公开筛选项移除。

## Revision 145 — 2026-09-09

- 保留既有 Home 真人场景浮窗、透明度和好友/主页/消息操作，不重做视觉皮肤。
- 补齐可用时间、距离、共同好友、评分与活动记录，以及动作 / Scene / 主题关联。
- “当前可一起去”照片卡只消费服务端 Scene 图片，点击进入对应场景，不向 App 包写入业务照片。

## Revision 140 — 2026-09-09

- 从新版生活方式资产中采用低风险“城市协助”家族：商务陪同、办事陪同、
  看房、SIM、本地向导、学习交流和内容拍摄；保持单一顶层入口。
- 银行金融、移民法律、警务和驾驶资质代办不进入撮合分类；新增图片继续
  走服务端语义目录，现有 Proxy Logo 基线不变。

## Revision 139 — 2026-09-09

- 场景撮合收敛为都市低风险行为：移除徒步/爬山及水上运动入口；新增
  医院场景、翻译动作、陪诊主题及挂号/问诊/检查/取药等非医疗细分。
- 新版 R42 与医院拼图拆为服务端独立图片资产，客户端只消费语义目录；
  陪诊入口明确禁止诊断、治疗、护理和急救服务。

## Revision 138 — 2026-09-09

- 新建按钮进类型行（PLACEHOLDER-018）：全部/照片/视频/＋新建同一排，
  点开行内输入，创建后收起并选中。

## Revision 137 — 2026-09-09

- 文件夹页媒体墙下加回自建文件夹（PLACEHOLDER-016 修正四）：新建/
  选中/移入移出全落盘，成员可点开、可移出。

## Revision 136 — 2026-09-09

- 文件夹改微信式媒体浏览器（PLACEHOLDER-016/017 修正三）：扫各会话
  真实消息体，照片格子+发送人按日期排，可点开放大，视频进会话看。

## Revision 135 — 2026-09-09

- 文件夹改按类型+日期组织（PLACEHOLDER-016/017 修正二）：照片/视频
  取最近一条消息种类，今天/昨天/更早分组；去掉归档概念与自建文件夹。

## Revision 134 — 2026-09-09

- 系统筛选只在对话页出现（PLACEHOLDER-017）；文件夹页加归档统计与
  未归档一键回 Convo 整理。

## Revision 133 — 2026-09-09

- 文件夹独立成第三页签（PLACEHOLDER-016 修正二）：对话/Convo/文件夹
  并列；文件夹页可建可选可移入移出、落盘持久化。

## Revision 132 — 2026-09-09

- 文件夹归位 Convo（PLACEHOLDER-016 修正）：页签与系统筛选恢复两行；
  自建文件夹可建可选可移入移出、落盘持久化，只过滤 Convo 列表。

## Revision 129 — 2026-09-09

- 对话/Convo/文件夹并入同一横滑行（PLACEHOLDER-016），免占两行；
  筛选逻辑不变。

## Revision 128 — 2026-09-09

- 对话列表去掉多余“最近”分区头（PLACEHOLDER-015）：服务端已按最后
  消息倒序，最新自然在第一行。

## Revision 127 — 2026-09-09

- 消息页禁左滑跳页（PLACEHOLDER-014）：左滑归行内删除，向右保留；
  读页走 ref，不再拿首屏旧值。

## Revision 126 — 2026-09-09

- Home 场景发现区的横滑轨道新增子按钮轻点通道：轻点不再被
  PanResponder 抢走，横移超过 3px 后才由轨道接管，兼顾点击与防翻页。
- 动作、场景、主题的“全部”从无反馈的清空操作改为完整选择面板；
  支持单选、主题多选、清除筛选和完成。

## Revision 125 — 2026-09-09

- 左滑删除宽松结算：轻滑 24px 即展开，被列表抢走手势也按最后位移
  结算，不再中途收回看不全。

## Revision 124 — 2026-09-09

- AI 小美主页三按钮直接复用动态帖文头像菜单的单层玻璃口径：
  `GlassView clear + isInteractive`、44 高、14 圆角。
- 删除 R123 增加的紫/金底层光场、tint、外层壳和高光层，消除白色实体
  背景及双重背景；业务动作不变。

## Revision 123 — 2026-09-09

- AI 小美主页三枚水滴按钮增加身份色底层光场与轻量紫色玻璃 tint，
  让 regular 液态玻璃在浅色页面上仍有可见折射，不再退化成白色胶囊。
- 按钮结构、状态与添加/主页/发消息链路保持不变。

## Revision 122 — 2026-09-09

- 对话左滑两段删除（PLACEHOLDER-013）：无手势库，用 PanResponder 实现；
  服务端无删接口，删除=本机可见性（落盘持久化，服务端保留审计）。

## Revision 121 — 2026-09-09

- Home 进入 AI 小美主页后的添加、主页、发消息三按钮改为与底栏水滴
  相同的分层结构：外层连续曲率壳、绝对铺满 regular GlassView、高光带
  和独立点击层；不再由 GlassView 直接包裹按钮。
- 三项业务状态和点击链路保持不变。

## Revision 120 — 2026-09-09

- 账户头像、动态帖文头像与个人主页帖文头像改用 SVG `Circle` 的真实
  `clipPath`，不再依赖 iOS 小尺寸圆角图层合成，消除真机多边形边缘。
- 图片仍按中心等比填充，不放大、不额外截断人物左右两侧。

## Revision 119 — 2026-09-09

- AI 三按钮换真水滴配方（regular 材质 + continuous 曲线 + 高光线，
  对齐底栏 lens；之前抄成近乎透明的 clear）。

## Revision 118 — 2026-09-09

- AI 主页三液态玻璃按钮（PLACEHOLDER-012）：添加/主页/发消息等三份，
  待定态收窄；查看个人主页进动态看她的全部内容（搜索种子即消费）。

## Revision 117 — 2026-09-09

- 动态帖文与个人主页帖文头像统一使用独立正圆裁切层；场景角标留在
  裁切层外，不再破坏头像轮廓。
- 撤销头像照片 1.1 倍放大补丁，避免人物脸部左右被截断。

## Revision 116 — 2026-09-08

- AI 主页添加走好友关系真相（PLACEHOLDER-010）：已申请未同意显示
  “添加中”并锁定，不再挂添加前文案；与首页 + 号同一条链。

## Revision 115 — 2026-09-08

- 个人总管理头像与 Home 同尺寸正圆（88）。

## Revision 114 — 2026-09-08

- 对话头像落盘缓存（PLACEHOLDER-009）：列表/详情/会话内头像改
  expo-image memory-disk，切模块回来秒出；avatar 类型收窄，
  去 RN 宽类型。

## Revision 113 — 2026-09-08

- 头像统一正圆（PLACEHOLDER-008）：hub/身份卡头像由圆角方形改半经圆，
  渐变容器加裁剪，色带不再戳出方角。

## Revision 112 — 2026-09-08

### Conversation avatar identity pipeline

- Inbox snapshots and profile reads now carry human portraits through contacts and
  conversation navigation into the header and peer-message bubbles.
- AI conversations keep using their persona portrait across inbox re-entry; gray
  initials remain only as a fail-closed fallback when an account truly has no avatar.

## Revision 111 — 2026-09-08

### One direct-message thread per account pair

- Starting a DM from profile, post, Home or another discovery entry reuses the latest
  active conversation for the same two accounts instead of creating another inbox row.
- Existing historical duplicate DMs remain auditable but both API and mobile inbox
  collapse them to the latest thread; non-DM business and group threads stay separate.

## Revision 110 — 2026-09-08

### Stable AI companion identity and photo replies

- Inbox re-entry resolves legacy and current AI account IDs back to the bundled
  persona, preserving her display name, portrait and personality in conversation.
- Photo requests attach the companion's existing profile portrait; persona prompting
  knows the account owns photo assets and avoids repetitive, customer-service AI tone.
- Conversation camera and microphone controls reuse the same Proxy icon system as Home.

## Revision 108 — 2026-09-08

### Immediate AI companion send feedback

- A user's outgoing bubble is painted before the AI completion request starts.
- Live history refresh pauses while that completion is pending, so hydration cannot
  erase the optimistic bubble; the companion shows an explicit replying state.

## Revision 107 — 2026-09-08

### Compact, single-submit Home AI conversation

- Sending a message is the only submit action and persists it immediately; closing the
  Home panel no longer sends a second hidden summary prompt.
- The embedded Home conversation defaults to 350 pt, approximately two thirds of its
  previous height, preserving more of the discovery surface.

## Revision 109 — 2026-09-08

- 横滑跟手 1:1（PLACEHOLDER-007）：隔离组件用 grant 时刻快照做滚动
  基准，不再拿持续更新的偏移重复累加；轻滑不再飞出去，松手即停。

## Revision 106 — 2026-09-08

- AI 横滑与真人横滑对齐：AI rail 出血到边（去左右空白），间距与真人一致。

## Revision 105 — 2026-09-08

### Persistent Home AI window and shared keyboard safety

- Reopening Proxy AI from Home hydrates the same durable timeline and its Home event
  dividers instead of presenting an empty temporary window.
- Leaving Home closes the window without clearing history; no automatic expansion,
  timed clearing, or redundant received-message strip remains.
- A shared keyboard-overlap hook keeps composers above the keyboard across Home AI
  and regular message conversations.

## Revision 104 — 2026-09-08

### Dual-entry Proxy AI conversation

- Home remains search-first, while tapping its AI mark expands the familiar embedded
  Proxy conversation with its own composer instead of navigating away to Messages.
- The embedded conversation and the Messages entry share the same durable HOME / Proxy AI
  thread; Home can collapse after inactivity without losing history.
- Opening a fresh embedded conversation no longer renders an empty user bubble.

## Revision 103 — 2026-09-08

### Home recommendations use durable friendship truth

- Recommendation `+` actions send real friend requests instead of disguising a
  profile follow as friendship.
- Home hydrates outgoing, incoming, and accepted friendship states from the server;
  the state survives navigation, reload, and another device.
- Human and AI accounts share the same visible relationship state machine while
  retaining their separate scene and profile navigation boundaries.

## Revision 96 — 2026-09-08

### Explicit search and Proxy AI conversation boundary

- The Home field is deterministic search by default and no longer silently sends
  unmatched queries to the model gateway.
- The left AI mark opens the user's single durable HOME / Proxy AI conversation in
  Messages, reusing it when present and creating it only when absent.
- The obsolete local conversation-history sheet is removed; durable history has one
  source of truth in Messages.

## Revision 95 — 2026-09-08

### One durable Proxy AI thread with ephemeral Home receipts

- Home model replies remain visible briefly, then leave Home instead of becoming a
  permanent second row. Their complete transcript remains in Messages.
- Every user reuses one durable HOME / Proxy AI conversation. Older clients' duplicate
  HOME conversations are collapsed to the newest inbox item without deleting audit data.
- A durable system divider separates successive Home exchanges inside that conversation.

## Revision 94 — 2026-09-08

### Compact logo-only opportunity type rail

- Opportunity type filters now show only their visual logos. Chinese and English
  helper captions are removed from the visible rail while names remain exposed to
  accessibility services.
- Logo slots are reduced to 46px with a 3px rail gap so additional scene types can
  fit without turning the filter into a text-heavy list.

## Revision 93 — 2026-09-08

### Market opportunity logo canvas normalization

- The four order-type PNG masters no longer carry different asymmetric white
  canvases; their visible tile bounds are normalized to the full 68×68 source.
- Selection uses an absolute border overlay, so selecting a type cannot shrink or
  offset the logo. The renderer no longer adds a second beige background below it.

## Revision 92 — 2026-09-08

### Home unified search/conversation contract

- Home now has one composer for both entity search and Proxy model conversation. The
  embedded model transcript is display-only and cannot introduce a second send box.
- Model feedback stays inside the same bordered search shell instead of appearing as
  a separate receive field. Empty state no longer fabricates response text or history.
- AI history, camera and microphone controls use larger, unwrapped glyphs so their
  visual size matches their touch target on a phone.

## Revision 91 — 2026-09-08

- 市场机会订单图取消圆角并贴齐卡片上、下、左三边；图片宽度保持 104，不再向右扩张。

## Revision 90 — 2026-09-08

- 市场机会订单卡的场景图片由 64×88 放大为 104×136，提升手机端图片利用率；订单信息与接单操作保持不变。

## Revision 89 — 2026-09-08

- 四宫格任一选择弹层打开期间硬关闭 App Shell 根页面翻页手势，关闭或卸载时恢复；子层横滑不再依赖 responder 竞争结果。

## Revision 103 — 2026-09-08

- Checklist 走查补漏（PLACEHOLDER-006）：进行中加载失败给重试按钮
  （不再写“下拉”）；我的活动/活动导流列表拆嵌套 Pressable，点报名
  不再误开明细。

## Revision 102 — 2026-09-08

- 动态本人头像与个人总管理同源（PLACEHOLDER-005）：之前写死黑底圆圈；
  发 Moment 成功后直达动态，看得见新帖。

## Revision 101 — 2026-09-08

- 邀约 Moment 可发布到动态（PLACEHOLDER-004）：复用发帖管线
  buildCreatePostPayload + localNet.createPost，成功确认、失败留屏可重试。

## Revision 100 — 2026-09-08

- 死链清理（PLACEHOLDER-003）：MarketSurface 未使用的 onOpenActivity
  prop 与 shell 空函数一并删除；他人主页图片接真查看器、点赞接真接口。

## Revision 99 — 2026-09-08

- 全链路走完（PLACEHOLDER-002）：出图分享接忙态/确认/取消/失败重试；
  市场双搜索生效、自定义报价独立输入校验、活动地图藏错钉；场景三态
  未登录与失败都明说；活动报名刷新详情+确认；会话发送失败撤气泡回
  草稿、转发接真接口（建 Convo 无后端移除）；权限序列化进正文；
  动态找同行走搜索、自定 AI 频道按名描述过滤、偏好静音/时限/权重全
  消费；助手 pill 进市场、建连失败可重试；资料/邀请/外链失败留屏显；
  主页实搜、店铺素材真 picker、状态表全局挂载、安全区死按钮移除；
  候选落草稿、权益拉领取记录、Creator 输入进 Review 且接受持久化；
  联系人走收件箱真数据且可达，去编造字段。

## Revision 98 — 2026-09-08

- 店铺“公开主页”死按钮接真分享（公开店铺链接）；内容/社媒归因三组
  无口径漏斗数字画“—”不编数（与 R87 分析区同口径）。

## Revision 97 — 2026-09-08

- 占位按钮/字段真接线（PLACEHOLDER-001 v2）：mock 数据全部保留作测试
  替身，但每个按钮都走通——好友 CRM 添加变已发送、请求可接受/忽略、
  拉黑即时移除（无后端走本地演示状态机，有后端调真实接口），服务端
  与本地双列表并排渲染；消息/活动/帖子/钱包死按钮接真分享/真导航/
  真点赞或移除；钱包与收入未知金额画“—”不编数。仅冒充本人的假身份
  与假二维码彻底删除。
- 发布器串帖“添加下一条”不再是空 toast：跟帖可增删改，发布时按编号
  拼进正文并计入字数，发布成功后清空。

## Revision 88 — 2026-09-08

- 商家工作台诚实化：邀请按钮文案改为真实意图（不再冒充自动派发）；
  清理任务页死样式。

## Revision 87 — 2026-09-08

- 我的分析区去假数：浏览/互动没有服务端口径，不再用公式现编，
  没接入口径前画“—”；关注数拉失败保持未知不回填 0，标签 Tabs
  同步支持未知态。

## Revision 86 — 2026-09-08

- 关注/取关报错按因说人话（个人主页、AI 主页、动态头像菜单共用
  mapFollowError）：没登录才提登录，服务端拒绝码说具体事，不再
  一律报访客。计数没拉到画“—”不回填 0。

## Revision 85 — 2026-09-08

- 活动详情诚实化：分享按钮接线（之前是死按钮）；感兴趣/报名失败
  不再静默吞掉，透出错误行，报名按服务端错误码说人话（与首页同口径）。

## Revision 84 — 2026-09-08

- 订单工作流报错说人话：工作区发消息失败不再静默吞掉（撤回乐观
  气泡、恢复草稿并提示）；订单加载/取消失败不再展示英文技术错，
  会话类问题提示重登。

## Revision 78 — 2026-09-08

- Human accounts remain user-defined; registration and messaging do not infer
  or classify users as “小美” or “小帅”.
- Open conversations now refresh server truth every three seconds while the
  app is active and immediately on foreground resume. The inbox refreshes every
  five seconds, enabling two-device account testing without exit/re-entry.

## Revision 77 — 2026-09-08

- Paid opportunity orders now have a `100,000 VND` minimum guarantee and a
  `10,000,000 VND` ceiling. Publication, applicant quotes and quick offers
  reject values outside that range; explicitly free opportunities remain free.

## Revision 76 — 2026-09-08

- Adopted the supplied Proxy UI Foundation as a shared React Native control
  layer without replacing the Proxy R3 identity or product-object language.
- Market opportunity/activity tabs and conversation/settings secure switches
  now share accessible state implementations; added regression guards against
  local duplicate controls and documented the BoardUI adoption boundary.
- 商家 Creator 详情的“发起定向邀请”只是跳活动列表、并不创建邀请，
  改名“查看活动报名”。真定向邀请（指定 Creator 进指定场次）需房主
  场景 + 邀请命令，链路未接前不挂邀请字样。

## Revision 75 — 2026-09-08

- Unified the VND ceiling for direct invitations, candidate offers, orders,
  settlements, supplier reference prices and city-companion offers at
  `10,000,000 VND`. Both clients and domain services reject larger values.

## Revision 74 — 2026-09-08

- Direct Scene invitations now require the requester to enter an explicit VND
  compensation before sending. The validated amount is shown to the invitee
  and frozen into the fulfillment order on acceptance.

## Revision 73 — 2026-09-07

- Replaced the static My Scenes invitation examples with actor-scoped scene and
  invitation reads plus real accept, ask and decline actions.
- Direct human invitations now freeze scene, time, place, scope, `150,000 VND`
  compensation and materialize an idempotent fulfillment order when accepted.

## Revision 72 — 2026-09-07

- Scene-originated paid opportunities now carry an explicit VND amount
  (`150,000₫`) and state that the selected human receives it; bare `150K`
  labels are rejected by the scene action regression contract.

## Revision 71 — 2026-09-07

- 快速 Offer 金额边界：下限 100₫（低于此基本是误填，端上先拦），
  上限 1,000,000,000₫（镜像服务端 maxAmountVND）。精度仍为 1₫。

## Revision 70 — 2026-09-07

- 快速 Offer 改走选人工作台：目标固定为报名名单里的真实 applicantId，
  金额发布者现填（VND），对方接单后直接生成订单。写死 agent_linh 的
  演示位已删除，没有报名人不发 Offer。

## Revision 69 — 2026-09-07

- PublishDemand now takes a price range (最低 + 最高可选) instead of a
  single price. The two boxes compose to the existing wire price string
  (`min – max`, collapsing to a single price when equal or one-sided),
  so server validation/normalize and card rendering are unchanged.

## Revision 68 — 2026-09-07

- Custom locations now render their reverse-geocoded address directly instead
  of repeating city, custom-storage marker and address in the Home header and
  saved-location history.
- Reverse geocoding now preserves the available locality/district hierarchy,
  falling back cleanly to city and country when Photon has no street detail.

## Revision 67 — 2026-09-07

- Removed the remaining coordinate duplication from Home's location summary and
  the Android map fallback. Coordinates remain available to the map and ranking
  pipeline, while user-facing summaries show only the place and coverage range.

## Revision 66 — 2026-09-07

- Moved the single-line Home intent entry above discovery and unified its copy
  as search plus Proxy conversation. Human and AI recommendation ordering is
  unchanged below it.
- Location selection now presents one human-readable address/area. Latitude and
  longitude remain in the consented location/ranking data pipeline but are no
  longer duplicated beside the address, map hint, history or confirmation UI.

## Revision 65 — 2026-09-07

- Home's embedded Proxy conversation now has a resumable single-line state.
  Users can collapse explicitly; a settled, unfocused exchange collapses after
  inactivity while loading, sending, focused input and temporary forms stay open.
- Keyboard position/height is not a collapse trigger. Follow-up send dismisses
  the keyboard, and the compact strip preserves the latest reply for continuity.

## Revision 64 — 2026-09-07

- User jurisdiction now uses the existing PostgreSQL truth table whenever the
  database is configured. Order/policy evaluation no longer falls back to a
  fresh in-memory default after an API restart.

## Revision 63 — 2026-09-07

- AI persona accounts and likeness-consent history now use PostgreSQL whenever
  `DATABASE_URL` is configured; process restart no longer erases the account or
  consent truth. This is persistence only and does not grant AI personas any
  activity, order, payment, or physical-presence capability.
- Expanded the persisted persona enum to the existing runtime actor kinds and
  fixed revoked consent so a later re-consent appends a new auditable row.

## Revision 62 — 2026-09-07

- No visual or interaction change. Removed unreachable profile statistic code
  and an unused task-surface type import after verifying the active personal
  profile and activity references remain unchanged.
- Retained the verified automatic iOS signing team used by the connected-device
  development build; this changes delivery configuration, not screen design.

## Revision 61 — 2026-09-07

- 修正 Home 真人与 AI 导航边界：真人推荐先进入明确绑定的现实 Scene，再
  二级查看主页；AI 小美因无实体到场能力，头像直接进入 AI 主页。
- 增加真人 Scene 关系卡和回退链路，明确“推荐匹配”不等于本人已到场或
  已接受邀请，并冻结为 `UI-HOME-DISCOVERY-001` 回归契约。

## Revision 60 — 2026-09-07

- 删掉设置页无响应模拟按钮与收件箱无入口加号；会话历史读取封顶
  200 条（PERF-001，尾部保留 + truncated 标志）。

## Revision 60 — 2026-09-07

- 冻结 Home 小美头像导航：头像先打开服务端绑定的 Scene/活动，而不是直接
  进入个人主页或在 Home 展开预览；Scene 内再二次查看小美主页。
- 五个 AI 账户增加权威场景、时段与活动标题绑定；Scene 明示 AI 仅提供聊天、
  陪伴和 UGC 灵感，不能到场、接单或报名活动。

## Revision 59 — 2026-09-07

- 首页场景改横滑大图；business-home controlLabel 提到 11pt（R3 门禁修复，
  纯排印）。

## Revision 58 — 2026-09-07

- 商家 hub 加场景运营页（R27 对齐）：旗舰场景实况投影 + 本场景活动 +
  真人 + 订单成交，全部真数据，无 mock KPI。

## Revision 57 — 2026-09-07

- 首页地图入口计数改为真实场景数/进行中数；地图下方加场景推荐横滑
  （真场景列表，点进地图详情）；继续进行去掉假数据 fallback，未加载/
  失败显示诚实状态。

## Revision 56 — 2026-09-07

- 删掉设置里四个无响应的模拟按钮（后台恢复/深链/离线/重置原型）；
  收件箱去掉无入口的新聊天加号（联系人为空态已诚实）。

## Revision 55 — 2026-09-07

- 商家 Home 补身份卡（门店名/地址/状态/人数，点进我的）与在售菜单快照
  （HOT/COOL 位，横滑 dish 图+红价），经营脉搏卡接真实 store/member 数；
  店铺 hero 优先用相册封面图，无图回退字母标。

## Revision 54 — 2026-09-07

- 店铺菜单对齐 R25（MENU-002）：商品加分类/场景字段（075），菜单页改
  hero 卡片 + 值得先看 SKU 横滑 + 按分类结构化目录（可展开）+ SKU 详情
 （大图/价格/场景 pills/编辑上下架），价格红色突出。

## Revision 53 — 2026-09-07

- 恢复 R34.5 真人推荐的圆形照片资产；保留“真人推荐在上、AI 推荐在下”及
  点击头像进入主页的冻结交互，不再用字母占位代替原型人物照片。
- 新增照片资产回归断言，防止真人推荐再次退化为无图节点。

## Revision 52 — 2026-09-07

- 对齐 R20.1 线上店铺层级：默认页恢复“店铺资产”菜单，菜单与价格、照片与内容、
  当前礼券和经营资料点击后分别进入对应页面，不在首页直接堆叠编辑器。
- 未创建店铺的动作改为进入企业运营助手生成 Store Draft，取消内联手工建店表单。

## Revision 51 — 2026-09-06

- 店铺/菜单照片走媒体管线远端展示（R36.x PHOTO-001）：store_photos 与
  store_products 加 media_asset_id（074），挂载时授权 PUBLIC，相册与菜品
  行显示 thumb 缩略图（远端优先，本地保留文件次之）。

## Revision 51 — 2026-09-07

- 线上店铺恢复后期公开资产基线：店铺头图与二维码之后依次呈现菜单 / 服务、
  照片与视频、活动 / Offer、Creator 权益、优惠券和营业资料。
- 移除误植的旧版访问漏斗及面向开发者的 JSON / 资产路径输入；编辑表单仅在
  用户主动操作后展开，店铺照片以真实缩略图显示。
- 新增结构守卫，禁止上述公开资产分区消失或开发字段再次回到用户界面。

## Revision 50 — 2026-09-06

- 店铺菜单与价格模块恢复（R36.x MENU-001）：store 维度商品真 CRUD
  （Create/Update/List/SetAvailability，VND 分，无硬删除），菜单管理页
  接 BusinessClient；当前展示页接关联活动。空菜单/无关联时显示诚实空态。

## Revision 49 — 2026-09-06

- 线上店铺空态引导：无店铺时 hub 显示"还没有店铺"+创建 CTA，创建表单下预告
  相册/信息/成员/数据四个模块（静态 IA 名称，无假数字）；我的入口文案去掉
  过时的"实时数据待接入"。

## Revision 48 — 2026-09-06

- Removed the legacy R7 opportunity quick filters (recommend/value/time/nearby/
  invite) and dead OPP_FILTERS from market.tsx. Opportunity filtering is now
  solely the R37 scenario type palette; search, supply status line and R37
  cards unchanged.

## Revision 47 — 2026-09-06

- Applied the R3 11pt readable-text floor to merchant-storefront summary and
  funnel labels (10pt to 11pt). Typography compliance only; no layout or
  information-architecture change.

## Revision 46 — 2026-09-06

- Froze the R35 surface boundary: demand/supply, forecast and Best Next
  Decision belong only to the BUSINESS Home tab. Merchant Me retains its
  established account, store and operating-management information architecture.
  `R35-HOME-BOUNDARY-001` prevents future cross-surface leakage.

## Revision 45 — 2026-09-06

- R35 signal ingestion now persists privacy-safe aggregate demand and merchant
  Scene supply snapshots in Memory and Postgres. Only SYSTEM actors may record
  demand; only an authorized store operator may record supply. Operating Home
  resolves persisted inputs through the frozen decision engine.

## Revision 44 — 2026-09-06

- R35 server decision resolver now enforces the privacy threshold and uses
  supplied future capacity rather than current occupancy alone. It fails
  closed to `NO_ACTION`, can issue `STOP_TRAFFIC` for future over-capacity,
  and keeps balanced `NO_ACTION` distinct from missing data.

## Revision 43 — 2026-09-06

- R35 merchant Operating Home now starts from real seven-day outcome and
  repository-backed operating state. Demand × Supply and forecast explicitly
  remain unavailable until privacy-thresholded demand and Scene-capacity
  signals exist; the server returns `NO_ACTION` instead of fabricating nearby
  traffic or future occupancy. The Home exposes this truth state and restores
  eligible Creator recommendations.

## Revision 42 — 2026-09-06

- R36.1 messaging supersedes the earlier chat visual reference. Conversation
  now uses Lotus-style clustered bubbles, a secure-message control sheet,
  sticker drawer, reply preview, message reactions and a pinned-message strip.
  Existing server-backed image, video, audio and proxy-object lanes remain in
  place. All readable labels comply with the R3 11pt minimum; unsupported
  call/thread/forward flows remain explicitly partial rather than simulated as
  completed operations.

## Revision 41 — 2026-09-05

- 活动导流页去占位化：有 tile 无页面的死入口改走真实商家活动
  （Origin=MERCHANT 过滤＋明细＋报名），从我的活动页模式复用。

## Revision 40 — 2026-09-05

- R18.x R3 typography guard (design-system-r3.test.ts)
  requires all readable UI text at 11pt or larger.
  Two pre-existing 10pt violations in HEAD were
  fixed: `aiPillText` (AI 生成 pill in
  ai-account-profile.tsx, 10→11) and `menuHint`
  (search-safety menu hint in conversation.tsx,
  10→11). The guard had been silently failing on
  HEAD since those files landed; fixing the
  fontSize keeps the gate green.
- R18.x ProfileTabs AboutTab dead helper
  removal: the `AboutStat` component (3-prop
  hardcoded-stat-row renderer) was deleted in
  commit c03097a but the function definition
  and the 4 `aboutStat*` style entries were
  left behind. Both are gone now.

## Revision 39 — 2026-09-05

- R18.x DEAD-FIXTURES-001: removed 3 hardcoded
  fixture arrays (`MARKET_EXPERIENCES`,
  `MARKET_HOSTS`, `MARKET_OPPORTUNITIES`) and 2
  lookup helpers (`marketHost`, `marketExperience`)
  from `market-fixtures.ts`. The `MARKET_HOSTS`
  rows shipped fabricated reputation strings
  ("fulfill: 99% / 95% / 98% / 99%" for Linh /
  Mai / Thao / Anh) that no server side ever
  recorded. The `MARKET_OPPORTUNITIES` rows were
  superseded by the live `opportunities` prop
  coming from the marketplace client's
  `ListMarketOpportunities` server call. The 2
  dead interfaces `MarketHost` and `MarketExperience`
  are also gone (only the `MarketOpportunity` /
  `MarketOpportunityMoneyFlow` / `OpportunityLens`
  / `MarketTab` types remain, and they are all
  referenced by the live market surfaces).

## Revision 38 — 2026-09-05

- Froze requester-home discovery as `UI-HOME-DISCOVERY-001`: the visibly
  labeled `真人推荐` section precedes the visibly labeled `AI 推荐 / AI 生成`
  section. AI recommendations use plain circular portraits without card
  shells or inline relationship/chat controls. Selecting an AI portrait opens
  its profile; adding/following and messaging remain profile-level actions.

## Revision 37 — 2026-09-05

- R18.x DEAD-MARKET-001: removed 3 dead sub-views in
  market.tsx (`ApplicantDetail` / `SubmissionDetail` /
  `CompareScene`), the dead `MarketExperienceSurface`
  surface + `openExperience` state in app-shell.tsx,
  and the dead `TasksSurface` export + hardcoded
  `IN_PROGRESS` / `DONE` rows in tasks.tsx. All of
  these were unreachable from any production code
  path, but each one shipped hardcoded mock data
  (composite price text, "比较 3 位候选" 96/98/94%,
  "Bonsaidon / 78 health / 248 到店 / 6.2M 成交额
  ..."). tasks.tsx is now a shared
  ActivityFeedCard + ActivityDetail module; the
  workspace entry pattern it used to back is
  driven by the live supply / fulfillment
  surfaces. `MarketSurface.onOpenExperience` is
  now an optional prop, and app-shell no longer
  passes it.

## Revision 36 — 2026-09-05

- Closed the 'me hub + bdash' remaining fabrication
  gaps and removed three dead subPages. The '个人总管理'
  (personalmanage) subPage used to render
  '已验证 · 准时 98%' as the city line; the personalhub
  AboutTab used to render '已履约 42 · 98% 准时 · 复购 7
  · ✓ 真实性已校验' as a fabricated stats row; the bdash
  (企业 / 店铺资料) hero used to render the hardcoded
  'Bonsaidon' + '海鲜自助 · 河内 · 主体已验证' regardless
  of which business the user actually owns. The
  REQUESTER_ME persona `desc` also carried the fake
  '河内 ✓ 已验证 · 准时 98%' stat. This revision:
  - personalmanage: city line now reads the live
    profileDraft.city (server-backed via ProfileClient).
  - personalhub AboutTab: the fake stats row is
    removed; the about card now shows only the bio,
    city, handle, and the real followers/following/posts
    counts.
  - bdash hero: pulls the live shop name via
    useMerchantIdentity (the same hook tasks.tsx +
    market.tsx use) and falls back to the persona name
    when the user has no shop yet. The fake
    '主体已验证' badge is gone.
  - REQUESTER_ME persona `desc`: the fake '已验证 · 准时
    98%' is replaced with '河内 · 个人身份', which is
    descriptive context, not a reputation claim.
  - me-sub-pages.ts: 'personalhub' / 'myscenes' fixture
    sections lose the fake '准时 98%' / '已履约 42' /
    '复购 7' rows.
  - Dead subPages removed from me.tsx + me-sub-pages.ts:
    'messages' (4 hardcoded threads Linh / Bonsaidon /
    Mai / 西湖摄影散步), 'requestermemory' (5 hardcoded
    confirmed + suggested memories), and
    'businessdiagnostic' (Bonsaidon + 78 health / 248
    到店 / 6.2M 成交额 / 172 新客户 / 38 复购 / 37% /
    +22% — 8 fabricated business metrics in a single
    render). All three were unreached from any menu row,
    from meOwnedRouteForLabel, or from any setSubPage
    call. memorySourceLabel helper, also only used by
    requestermemory, is removed.
  - FAKE-STATS-001 tripwire (grep guard on the live
    surfaces).
  - DEAD-SUBPAGE-001 tripwire (grep guard on the three
    removed subPages; me-sub-pages.ts must not
    re-introduce them).

## Revision 35 — 2026-09-05

- Closed the me-hub social badge gap. The hub top
  card used to render the hardcoded
  `persona.profileCard.social` (`["TT","Z","IG","in"]`)
  no matter what the user actually configured in
  the social accounts editor. Editing a handle +
  flipping visibility to "公开展示" had no effect
  on the hub. This revision adds `resolveHubSocials`
  in `me-types.ts` and rewires the me.tsx render
  path to project the live `socialAccounts` (already
  wired to `socialSettingsClient` + 250ms debounced
  write) onto the badges. Accounts with blank handles
  or non-public visibility are hidden; when the list
  is empty the card shows a "去 我的 → 社媒账户 设置"
  hint. HUB-SOCIAL-001 tripwire (1 mobile vitest
  + 2 grep guards).

## Revision 34 — 2026-09-05

- Closed the '我的' hub card gap. The me-hub top
  profile card + identity card used to render the
  hardcoded `persona.name` ('Huyen' for requester,
  'Bonsaidon' for business) and a fake
  '已验证 · 准时 98%' verification stat, no matter
  who was signed in. The profile editor (编辑主页)
  wires profileStore + ProfileClient, but the hub
  card never read those fields, so editing 主页 had
  no visible effect on the hub. This revision adds
  `resolveHubProfile` in `me-types.ts` (single source
  of precedence for displayName / initial / city /
  handle / hasAvatar) and rewires both the profile
  card and the identity card to project the live
  profile onto their renders. The fake verify badge
  is gone; the handle now shows in its place when
  the user has set one. HUB-PROFILE-001 tripwire
  (6 mobile vitest + 3 grep guards).

## Revision 33 — 2026-09-05

- Closed the '我的 → 好友与关系' gap. The mobile
  FriendCrmSurface was entirely hardcoded mock: 4 fake
  friends (Mai / An / Luna / Khoa), 2 fake pending
  requests, fake contact / social matches; every
  action (add / accept / ignore / block) mutated only
  local React state. This revision adds the
  relationship package end-to-end: server commands
  ListMyFriendships / SendFriendRequest /
  AcceptFriendRequest / IgnoreFriendRequest /
  BlockFriend with USER-only auth + symmetric (a,b)
  pair canonicalisation + IGNORED_TOMBSTONE row
  semantics, PG persistence (migration 040), mobile
  RelationshipClient with 4 cases, and the surface
  rewire that projects server active + pending buckets
  into the existing render path. The 4 mock constants
  remain as offline fallback only. FRIEND-001 tripwire
  (6 server + 4 mobile + grep guard).

## Revision 32 — 2026-09-05

- 小美快捷入口改道：推荐页未落地前，“看小美机会”进真实 AI 活动流
  （ACTIVITY tab），不再跳机会页占位。纯路由改道，无视觉新增。

## Revision 31 — 2026-09-05

- Closed the storefront '编辑主页 / 联系方式 / 营业时间' gap.
  The server has had UpsertStoreLines since R18.x b77187a,
  but the mobile MerchantStorefrontSurface was read-only:
  business owners saw their old lines but had no way to
  edit description / contact / hours / logo. This revision
  adds the inline edit form (5 TextInputs + a 保存
  button + 取消) and the startEditLines / saveLines
  handlers; saveLines calls client.upsertStoreLines, and
  validates the hours JSON client-side before sending so
  the user gets a clearer error than the server's reject.
  LINES-EDITOR-001 tripwire.

## Revision 30 — 2026-09-05

- Closed the '取消订单' gap. The Order lifecycle enum
  included CANCELLED, but no server command ever wrote it:
  every '我的订单 → 已取消' tab was empty, and the surface
  had no button. This revision adds the
  fulfillment.CancelOrder command (actor must be either
  party; OFFERED / CONFIRMED / EXECUTING are cancellable;
  COMPLETED / CANCELLED are terminal; the reason lands in
  the OrderCancelled event payload for audit) and the
  me-orders surface's red outline '取消订单' button with
  confirmation prompt + optimistic lifecycle update.
  CANCEL-001 tripwire (5 server + 3 mobile tests).
  Also enables the previously-disabled PROFILE-001 mobile
  half of commit 946a710.

## Revision 29 — 2026-09-05

- 商家身份发布 (MERCHANT-PUBLISH-001)：发布需求/活动表单新增“发布身份”
  选择（个人/名下店铺，无店不显示）；以店名义发布时订单 Owner/OwnerType、
  活动 Origin/merchantName 由服务端注记盖章。个人路径零变化，无视觉新增，
  只是发布表单多一行选择器。

## Revision 28 — 2026-09-05

- Wired the Profile service half that commit 6e68aaf
  accidentally missed: identity.Service.profileService
  field, NewWithRepositoryAndClockAndChallengeProvider
  initializes it to NewProfileService(nil, clock),
  SetProfileRepository lets the transport layer swap in
  the PG repo, and main.go's PG path now calls
  identityService.SetProfileRepository(postgres.NewIdentityRepository(pool))
  so UpdateProfile survives restarts. The PROFILE-001
  server half is now actually exercised by identity_test.

## Revision 27 — 2026-09-05

- Replaced feed-local fixed `0/1` reaction displays with authenticated server
  counts and viewer state; like and unlike are idempotent across Memory and PG.
- Added the minimal per-post reply list and refresh-after-send path so replies
  and their counts remain visible (`POST-REACTION-TRUTH-001`,
  `POST-COMMENT-VISIBILITY-001`).

## Revision 26 — 2026-09-05

- 修头像 P0 丢失：hydration 用了不存在的 `file.exists`（恒 falsy，每次冷
  启动都丢头像只剩字母头）＋绝对路径存 container UUID（重装即死）。现只
  存文件名、启动按当前沙盒重锚＋校验，老记录后台回写自愈。无视觉变更。

## Revision 25 — 2026-09-05

- 商家店铺页补建店入口：无账号时可一次建账号+首店，有账号无店时可追加
  店铺。之前两处空态互相指“去别处建”但全仓无入口，商家链路（相册、
  以店名义发布）对新商家完全不可达。纯增量 UI，无视觉规范变更。

## Revision 26 — 2026-09-05

- Closed the '编辑主页' gap. The mobile profile editor in me.tsx
  was a local-only write (profileStore.write to iOS Keychain /
  Android Keystore). No server command existed, so the new
  name / handle / bio / city / avatar never reached feeds,
  opportunity applicants, or any cross-device read. This
  revision adds the server half: identity.Profile aggregate
  with ProfileRepository (memory + PG /039), two commands
  (UpdateProfile / GetProfile) in the identity service, with
  actor-scoped authorization (USER only) and the same asset
  path rule as business.store_photos (rejects external URLs).
  PROFILE-001 tripwire. (Mobile wire lands in the next commit.)

## Revision 24 — 2026-09-05

- Closed the merchant surface gap. The previous '商家' tab in
  business-home.tsx and merchant-me-r21.tsx was entirely hardcoded:
  'Bonsaidon' identity, '48 张相册' counter, '8,426 关注' stats, and
  every manage tile was a non-clickable View. This revision gives the
  business domain four new server-side commands (AddStorePhoto /
  ListStorePhotos / DeleteStorePhoto, UpsertStoreLines / GetStoreLines,
  UpsertMemberDirectory / ListMemberDirectory, UpsertSpendDaily /
  ListSpendDaily) backed by a real PostgreSQL schema (migrations
  /038) and an in-memory repository. Asset paths are constrained to
  Proxy-internal prefixes (ai-personas/, assets/, store/, photo_); an
  external URL on the photo or logo path is rejected with
  INVALID_ASSET_PATH. Mobile commit (de2538e) wires the new
  BusinessClient methods, the photo picker
  (retainStorePhoto + ImagePicker.launchImageLibraryAsync) and the
  me.tsx > merchantstorefront route into MerchantStorefrontSurface
  so the user can upload a real photo. Mobile commit
  (merchant-me-r21-replacement) removes merchant-me-r21.tsx
  (1250-line @ts-nocheck hardcoded mock) and
  merchant-creator-center.tsx, replacing them with
  MerchantMeR21Replacement — a real surface that calls
  BusinessClient.listMyAccounts / ListBusinessStores /
  ListMemberDirectory / ListSpendDaily, SupplyClient.querySuppliers
  for creator recommendations, and ActivityClient.listActivities
  for the activity surface. Empty states are honest ('server 列表
  为空') instead of the bogus '12.6tr VND' / '148 订单' fallbacks.
  app-shell.tsx threads the activities client down to MeSurface.
  Mobile commit (BusinessHome real wire) replaces the 242-line
  hardcoded 'Bonsaidon today push' / 'Rooftop Photo Afternoon' /
  '场景结果 Invite Sent 12' mock with a real surface that calls
  BusinessClient.listMyAccounts / listStores / listMemberDirectory /
  listSpendDaily and ActivityClient.listActivities, with honest
  empty states. app-shell.tsx threads business + activities into
  <BusinessHome/>. Tripwires: STORE-PHOTO-001, STORE-LINES-001,
  MERCHANT-DIRECTORY-001, MERCHANT-SPEND-DAILY-001, MERCHANT-R21-001,
  BIZ-HOME-WIRE-001.

## Revision 23 — 2026-09-05

- Hardened marketplace confirmation so application state and the derived
  fulfillment order commit atomically in PostgreSQL and fail together in memory.
- Made order derivation deterministic and idempotent across retries, and hydrate
  the requester from the authoritative opportunity owner (`CHAT-ORDER-ATOMIC-001`).

## Revision 22 — 2026-09-05

- chat → order 派生路径 (R17.x): marketplace
  ConfirmMarketApplication 不再用 fake "order_" +
  applicationID 拼接 — server 生成真 ord_<hex>, 委托 fulfillment
  MemoryRepository 创建真 Order (production 走 PG adapter)。“我
  的订单”页 (走 fulfillment.listMyOrders) 现在能看到
  marketplace confirm 产生的 Order。Application 加 OwnerID 字
  段 (apply 时快照 opportunity owner 作为 Order.RequesterID) 。
  Idempotency: 重复 confirm 不重复创建 Order。
  tripwire CHAT-ORDER-MATERIALISATION-001 跳防 " 我的订单/我
  的机会" 两路径不一。

## Revision 21 — 2026-09-05

- Added a merchant-only `Creator 推荐` rail backed by `QuerySuppliers`, using
  real active profiles, verified eligibility, market availability, profile
  photos and reference pricing. Missing/error states remain explicit instead
  of falling back to hard-coded people. Added the durable
  `MERCHANT-CREATOR-001` client/server regression tripwire.

## Revision 19 — 2026-09-04

- 对话中 "活动" 按钮发出的 proxyObject 不再 hardcoded
  "act_westlake" (一个 server 不存在的 ID). 现在 conversation
  sheet picker 从 server listActivities() 选真实活动, 发
  真 ID. tripwire CHAT-PROXY-ACTIVITY-001 跳防 hardcoded
  fallback 重现。“点聊天活动” 路径与“我的活动”页在 server
  同一份仓储。

## Revision 19 — 2026-09-04

- 平台 AI 5 角色 (ai_001-ai_005) 冷启动活动带 photo 资产。
  apps/mobile/assets/ai-personas/ 下五个统一风格 SVG 头像
  (紫/粉/绿/橙/金主题 + AI 虚拟 badge); ActivitySchema 增
  aiPersonaPhoto 字段; tasks.tsx + me-orders.tsx 改用 persona
  圆形 token 渲染 (SVG 上线后 Image 可换 require); 5 个
  冷启动活动 seed 都 携带 ai-personas/ai_00X.svg 路径,
  tripwire AI-PERSONA-PHOTO-001 跳防路径丢失。明确不
  “看起来像真人": 是 AI-rendered 头像, 不是真人拍提。

## Revision 18 — 2026-09-04

- “我的活动” surface (me.tsx > myactivities) 接进 server
  真实 activity 仓储。MyActivitiesSurface 不再用 hardcoded
  mock; ActivityClient.listMyActivities() 取代“本周暂无
  开放活动” fallback。匿名访问下“已参加 / 我发起的”诚
  实提示登录。detail 页面 复用 ActivityDetailSurface 加
  initialActivityId / onBack props (与别人 cherry-pick 一致)，
  修一个别人留下的 detailId 状态未声明 的 TS bug.

## Revision 17 — 2026-09-04

- “我的活动” 物化路径 (R17.x): server 端 ListMyActivities 返
  actor-scoped created + joined 两个数组; PG 以 payload->>'ownerId'
  和 activity.participants JOIN 提供仓库事实; contracts 增
  ListMyActivitiesPayloadSchema schema + 3 个 tripwire。Anonymous
  / 空 actor 被 server 拒绝 (不能“看到任何我的活动"")。下一个
  commit 将进 mobile surface 替换 hardcoded mock  (MyActivitiesSurface)。

## Revision 16 — 2026-09-04

- 个人总管理页可编辑基本信息：新增“编辑资料”入口，复用个人主页编辑器
  （Modal 移到根，各页可开）。无视觉新增，只是把已有编辑器挂到总管理页。
- 二维码分享接通：两处 QrCard 的分享按钮调起系统分享（真实主页链接）；
  文案诚实化（二维码图形升级中，先分享链接）。无新增图形资源。
- 总管理注册文案与 AVAILABILITY_OPTIONS 对齐（忙碌/暂不接单/隐身）。
- 我的活动页接真实活动服务（可参加/报名），去掉写死假数据。列表卡片沿用
  现有 savedCard/orderTab 样式，无新视觉规范。

## Revision 15 — 2026-09-04

- Closed the client side of R16.x single-source-of-truth: the
  `PublishDemand` publish() path no longer constructs a PriceLabel
  locally, and `apps/mobile/src/surfaces/market.tsx` no longer
  carries the `priceLabelForFlow` helper that mirrored
  `opportunityPriceLabel`. `apps/mobile/src/marketplace-client.ts`
  publish() now takes the new
  `PublishMarketOpportunityInputSchema` from packages/contracts
  (with `priceLabel: z.string().optional()`), parses the response
  through the strict `MarketOpportunitySchema` so the wire-down
  invariant ("no naked amount") still holds.
- Added `MONEYFLOW-005` regression tripwire: client publish may
  omit, blank, or send a wrong-flow PriceLabel; the server's
  `normalizeOpportunityMoney` always derives the wire-down
  PriceLabel from MoneyFlow. Combined with the MONEYFLOW-004
  server-side fix in bdb1857, the R16.x PriceLabel contract is
  now end-to-end server-authoritative: mobile does not maintain a
  parallel mapping.

## Revision 14 — 2026-09-04

- Replaced the active opportunity candidate workbench's hard-coded Xiaomei,
  Linh, and Minh inventory with owner-only, repository-backed applications.
- Added the prototype lifecycle: human applies, owner selects one application,
  the other submissions close, and the selected human confirms cooperation to
  materialize a stable order reference. Platform AI, user twins, and AI
  assistants cannot select or confirm.
- Added `OPPORTUNITY-DEAL-001` across service, PostgreSQL lifecycle, mobile
  wiring, and the regression gate. Reputation/profile enrichment remains a
  named gap; the UI no longer invents rankings or fulfillment percentages.

## Revision 13 — 2026-09-04

- Raised the conversation composer above the device bottom safe area and kept
  keyboard overlap handling inside the fixed AppShell body.
- Added camera/library selection, local preview, the existing resumable media
  upload pipeline, IMAGE message send, and historical thumbnail rendering.
- Added `UI-CHAT-001` to prevent regression to text-only/local-only image UI.

## Revision 12 — 2026-09-04

- Promoted the prototype activity creation path into the active implementation
  baseline: a signed-in human can publish a shared-participation activity at a
  real CAFE/RESTAURANT scene and immediately open its server-backed detail.
- Enforced the prototype boundary in the service: user activities are free;
  venue consumption is separately declared as SPLIT or HOST_COVERS; paid
  capability requests stay in the demand/opportunity pipeline.
- Added `ACT-PUBLISH-001` backend, PostgreSQL, mobile command, and offline-write
  guards. Participant invitation and activity chat remain explicit next gaps.

## Revision 11 — 2026-09-04

- Added `docs/spec/Proxy_PRD_v1.7_R16_AI_Three_Actors_MoneyFlow_Direction.md`:
  canonical entry for the R16.x AI-three-actors + MoneyFlow-direction
  freeze. Records the AI boundary capability matrix (Human / PlatformAI /
  UserTwin / UserAssistant), the four-way MoneyFlow wire contract
  (EARN / PAY / FREE / TBD for Opportunity; FREE / PAY_TO_JOIN /
  PAID_TO_ATTEND for Activity), the publisher / applicant dual-perspective
  priceLabel wording, and the g4 tripwire registry (AI-ACTOR-001/002,
  MONEYFLOW-001/002/003, LIFECYCLE-PG-001 — 13 named tests).
- `scripts/check-regression-contracts.sh`: registered four pre-existing
  PG lifecycle integration tests (TestActivityPostgresLifecycle /
  TestMarketplacePostgresLifecycle / TestScenePostgresLifecycle /
  TestOutcomePostgresLifecycle) under the new `LIFECYCLE-PG-001` tripwire.
  Previously these tests existed but were not gated; a future refactor
  that weakened their SQL semantics could land without g4 noticing.

## Revision 10 — 2026-09-04

- `market` scope (PublishDemand): split the price label helper into
  `priceLabelForFlow` (wire-bound, applicant-side) and
  `priceLabelForPublisher` (view-only, publisher-side). The previous
  version used the applicant-side copy in the publisher UI which read
  as "completed you receive" — wrong perspective. Both helpers keep
  the same Chinese wording intent as before but address the right
  reader; the wire contract still flows through `priceLabelForFlow`
  and server `normalizeOpportunityMoney`. `IMPLEMENTATION_CONTRACTS.json`
  updated to describe the dual-perspective design and to list
  `apps/api-go/internal/marketplace/service_test.go` as additional
  evidence for both `market` and `activity` scopes (AI-ACTOR-002 /
  MONEYFLOW-001 tripwires that pin the wire contract).

## Revision 9 — 2026-09-04

- Anchored the market/tasks/activity UI work that was previously scopeless:
  `market` + `activity` are now ACTIVE_SCREEN_REFERENCE under
  `Proxy_Market_Opportunity_Filter_R7.html` ("Opportunity / Activity R2"),
  `my-tasks` is FUNCTIONAL_REFERENCE_ONLY under `proxy_my_market_modules_v5.html`.
- Added `market` + `activity` implementation contracts (PARTIAL): moneyFlow
  4-state + priceLabel rendering wired; known gaps are EARN copy unification
  and organizer-delegated attendance marking.
- Security hardening that touches baseline-sensitive surfaces: facet writes
  require session + server-stamped UpdatedBy + rate limiting (FACET-AUTH-001),
  attendance verifies participation (ACT-ATTEND-001), market dismiss enters the
  AI boundary gate (AIBOUND-001). No visual contract changed by these.

## Revision 8 — 2026-09-04

- Replaced the mobile Reality Scene launch catalog and fixed `47` count with a
  PostgreSQL-backed catalog projection.
- Added consent-gated current-location recommendations ranked by distance and
  popularity, plus timestamped private visit history (`UI-SCENE-MAP-001`).

## Revision 7 — 2026-09-04

- Preserved device-only settings during the first account-sync upgrade instead
  of treating an absent server record as authoritative empty data.
- Serialized preference writes to prevent slow, older requests from restoring
  stale settings; added the `UI-SOCIAL-003` regression contract.

## Revision 6 — 2026-09-04

- Upgraded social and collaboration settings from device-only persistence to
  authenticated account persistence with local offline cache fallback.
- Added `UI-SOCIAL-002` client/server ownership and round-trip regression coverage.

## Revision 5 — 2026-09-04

- Added persisted collaboration opt-in, types, optional rate and contact fields.
- Disabled and labeled Merchant Me tiles that do not yet have a real route.

## Revision 4 — 2026-09-04

- Persisted user-controlled social accounts and visibility locally; removed
  realistic prefilled identities that could be mistaken for user data.
- Relabeled merchant preview metrics so static prototype values no longer claim
  to be live server truth.
- Added `UI-SOCIAL-001` regression coverage.

## Revision 3 — 2026-09-04

- Corrected Personal Profile from `IMPLEMENTED` to `PARTIAL`; its five-tab
  implementation does not match the active three-tab prototype.
- Corrected Social Contact ownership from Friend CRM to the `me.tsx`
  `socialidentity` route and documented missing persisted collaboration settings.
- Corrected Creator Center to `SCAFFOLD_ONLY`.
- Closed `UI-PROFILE-001` (first post hidden without a real pin) and
  `UI-PROFILE-002` (unrelated photos presented as saved/tagged content).

## Revision 2 — 2026-09-04

- Added monotonic baseline protection: active scopes cannot disappear, point
  into archive, or be downgraded without an explicit baseline revision.
- Added machine-readable prototype-to-implementation contracts and explicit
  known-gap states.
- Bound root dock and profile references to implementation and test evidence.
# Revision 79 — Four-grid center remix control (2026-09-08)

- Requester Home 四宫格中心空位新增“整组换一组”按钮，一次轮换人物、时间、活动与地点。
- 四张卡片、布局尺寸、下方操作链路均保持不变；中心按钮采用统一矢量图标，避免平台字体偏移。

# Revision 80 — Four-grid remix separator refinement (2026-09-08)

- 中心换组按钮的留白隔离圈由 5px 收窄至 2px，其他尺寸与布局不变。

# Revision 81 — Four-grid people photo chooser (2026-09-08)

- “选一起的人”由姓名纵向列表改为可横向滑动的小美照片卡，显示照片、姓名和个性简介。
- 时间、活动、地点选择器及四宫格主体保持不变。

# Revision 82 — Four-grid visual choosers (2026-09-08)

- 地点和活动选择改为横向实景照片卡；活动优先使用活动封面，否则使用绑定 Reality Scene 的实景图。
- 时间选择改为横向时段卡，保留清晰的当前选择状态，不再使用纵向文字列表。

# Revision 83 — Four-grid chooser gesture isolation (2026-09-08)

- 四宫格人物、时间、活动、地点横滑选择器统一接入共享手势隔离层，优先消费横滑，防止误触根页面翻页。
- 视觉、数据选择和四宫格业务链路保持不变。

# Revision 129 — Scene editorial media pipeline (2026-09-09)

- 将用户提供的动作与越南场景拼图拆为 59 张独立服务端媒体资产；照片不进入移动端安装包。
- 新增公开、可缓存的 `/v1/scene-assets` 语义素材目录，动作、场景、主题和 Moment 通过稳定媒体 ID 加载，可在不发版 App 的情况下换图。
- 场景横栏、Moment、详情及完整选择器只接受网络照片；断网时诚实显示中性占位，不回退到打包示例图。
- 保持首页“真人撮合优先、场景只是见面道具”的既定信息层级，顶部动作图标结构不变。

# Revision 130 — Conditional active-work surface (2026-09-09)

- “继续进行”改为由真实草稿或已发布需求触发的状态机界面；服务端返回 0 项时整块隐藏。
- 删除匿名、未下单和读取失败时伪造的两张进行中卡片，以及无意义的“0 项”和空态说明。
- 刷新失败时保留上一次已成功加载的真实投影，不用错误状态制造首页模块。

# Revision 131 — Remove duplicate Home activity list (2026-09-09)

- 删除 Home 中重复的“店铺场景活动”横向列表；活动发现、报名、到店与复盘继续由市场活动模块负责。
- Home 仍读取活动数据供四宫格“选活动”使用，保留“人物 × 时间 × 活动 × 地点”的撮合组合链路。

# Revision 133 — Progressive scene taxonomy picker (2026-09-09)

- Home 默认只显示一行紧凑动作入口；场景和主题筛选默认隐藏，避免三行分类同时造成认知负担。
- 动作入口取消包住图标与文字的大卡片，改为独立图标、下方短标签，整体宽高收紧。
- 三个“全部”合并为一个入口，在同一底部面板按动作、场景、主题分区选择，并统一完成或清除。

# Revision 134 — Expandable matchmaking action taxonomy (2026-09-09)

- “全部筛选”底部固定提供“重置 / 完成”，重置一次清空动作、场景与主题。
- 动作从固定平铺升级为稳定一级动作加可扩展细分节点；选择“运动”后按需展开跑步、骑行、羽毛球、网球、瑜伽/普拉提、徒步/爬山及水上运动。
- 细分动作保留对一级撮合标签的兼容映射，并分别接入服务端网络照片，后续可以继续扩充动作族而不增加 Home 默认信息密度。

# Revision 141 — Compact Home discovery and market workflow filters (2026-09-09)

- Home 动作入口统一补齐共享 Proxy 图标；真人推荐移除重复场景标题与解释行，保留真人标识和筛选入口。
- “场景灵感”改为与“为你组合”同级字号的“附近场景”，新增直接地图入口，原有网络场景卡和数据管线不变。
- 市场头部移除“城市 · 机会 · 活动”重复文案；机会状态改为全部、已申请、已创建、执行中，不再把 Offer、打卡和证据操作伪装成列表筛选。
- 顶部和滑动页底部共用双发布入口；订单沿用价格守卫流程，活动绑定已有真实场景后走 PublishActivity 服务端命令。

# Revision 142 — Shared action logo registry (2026-09-09)

- Home 第一行拍照、同行、吃饭、活动等入口不再临时映射通用线性图标，直接复用附近场景动作栏的 `SCENE_ACTIONS` SVG 注册表。
- 市场机会筛选与机会卡删除旧 `order-type-logos` PNG 视觉，按订单类型映射到同一套拍照、City Walk、咖啡、翻译和活动图标。
- 新增源码契约守卫，禁止 Home 拍照/同行退回自建图标，也禁止市场重新引用旧订单 Logo 包。

# Revision 143 — Human × Scene linked preview (2026-09-09)

- Home 真人头像不再直接跳离发现页，先打开人物与当前 Scene 的玻璃关联层；场景卡仍可继续进入完整 Reality Scene。
- 关联层只使用推荐账户与服务端场景已有字段，不展示原型中未落库的评分、履约次数或虚构活动数据。
- 添加按钮复用好友关系状态机，明确展示添加、添加中、已添加与接受添加；查看主页和发消息分别接入既有真人主页与消息会话。

# Revision 144 — Market publish launcher safe position and routing (2026-09-09)

- 市场机会与活动页的悬浮发布按钮上移至底栏安全区之上，避免被原生导航栏覆盖。
- 双发布选择从滚动内容顶部移到独立底部弹层；无论列表滚到哪里，点击 `+` 都能立即看到发布订单和发布活动。
- 发布订单强制切到机会编辑态，发布活动强制切到活动编辑态并加载真实场景；编辑态重新挂载在滚动顶部，消除点击后仍停留在旧滚动位置的问题。
