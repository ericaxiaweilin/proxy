# Design baseline changelog

Every intentional change to a baseline-sensitive implementation must update
this file and `CURRENT_BASELINE.json` or `IMPLEMENTATION_CONTRACTS.json` in the
same commit. Do not record routine business logic changes here.

## Revision 268 — 2026-09-23

- **AI 分身中心新增「用户建模」**（AI-MANAGE-015，原型 deepseek_html_20260923_c9c642.html，logo user_modeling_black_white_clean.svg）：
  AI 分身的核心是给小美生成模型资产（照片 / 视频），建模是生成时锁住的「她长什么样」。
  - 卡片：本人头像 / 名字、AI 建模标、识别状态、特征 chips；详情页：授权图库张数、物理锚点（身高 / 体重 / 年龄 / 身材 /
    肤色 / 发型，每项标 AI 或 手动）、亚洲人特征锁定开关、「让 AI 从图库识别」、「编辑模型」表单。
  - 全是真值：AI 识别 = vision 模型读本人**授权**的公共图库照片（POST /v1/ai/user-model/analyze，最多 4 张）；
    识别不出的项就是「待补充」，体重不让 AI 猜；本人改过的项 AI 以后不覆盖。原型里写死的 165cm / 12 张 / 8 项不照搬。
  - 没有形象授权就没有建模，只给授权入口（与 AI-MANAGE-010 一致）。
  - 模型底座：vision 任务改走同 provider 里声明能看图的模型（原来会把图发给纯文本模型）。
- 影响文件：`apps/mobile/src/components/twin-user-model-section.tsx`、`apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx`、`apps/mobile/src/surfaces/me.tsx`。

## Revision 267 — 2026-09-23

- **裸账号 id 不再上屏**（NO-RAW-ID-001）：用户「无头像无用户名只有纯 user_ID，
  不符合规矩」。两处回退改中性「用户」：会话列表对端名（`messages.tsx`，id 只
  留作导航标识）、好友洞察展示名（`twininsight.buildInsight`）。另清掉 fixture
  污染进真会话的 `u_linh` 幽灵参与者（2 个会话；平台助手 / AI 账号靠
  `IsHumanTarget` 在读时过滤，不删数据）。
- 影响文件：`apps/mobile/src/surfaces/messages.tsx`、
  `apps/api-go/internal/twininsight/insight.go`。

## Revision 266 — 2026-09-23

- **全页面内容长按可复制**（SELECTABLE-TEXT-001）：用户「现在我先复制给你都不行」。
  全仓 RN `<Text>` 统一加 `selectable`（codemod，约 3100 处）；例外：会话气泡
  （长按出管理菜单，复制走菜单新增的「复制」项，经 expo-clipboard）与
  `TooltipOnLongPress` 包裹的工具栏按钮（长按出 tooltip）。回归钉
  `selectable-text.test.ts`。
- 影响文件：`apps/mobile/src` 下 81 个 tsx（纯加 `selectable`）、
  `apps/mobile/src/surfaces/conversation.tsx`（菜单复制项）、
  `apps/mobile/src/selectable-text.test.ts`（新建）。

## Revision 265 — 2026-09-23

- **对话权限「每次确认」真正可用：AI 替你起草，你确认后以你的身份发出**（AI-MANAGE-013）：用户规则「代回复…应该是代真人的回复」。
  之前「每次确认」只是不回（AWAITING_OWNER），草稿那一步没做。
  - 别人私信你 → AI 用你的语气起草一条回复，存成**只有你看得到**的草稿（`conversation.stand_in_drafts`，迁移 121）；
    发消息的人那边仍是「对方还没回」，拿不到也动不了草稿。
  - 会话里输入框上方出现草稿卡：「丢弃 / 修改 / 以你的身份发送」；发出去的是你确认过的话，就是你的消息（不带「AI 代回」）。
  - 消息列表该会话预览前加「[AI 草稿待你确认]」。
  - 对方又发一条 → 旧草稿作废换新；你自己直接回了 → 草稿作废，过时的草稿不能再被发出。Token 记在你头上。
- 影响文件：`apps/mobile/src/surfaces/conversation.tsx`、`apps/mobile/src/surfaces/messages.tsx`。

## Revision 264 — 2026-09-23

- **折叠地图 logo 放大 + 首页入口同步**（MAP-FOOTPRINT-LOGO-001 跟进）：用户：
  「把地图 logo 做大一点」「home 首页的地图 logo 也要换这个」。
  - 市场切换按钮 `mapFold` 用到 26，比 + 号（18）大一圈。
  - 首页 `LocationContext`「打开场景地图」入口同步换 `mapFold`（27 小格里
    用 21，等效原来 route 17 的分量）。
- 影响文件：`apps/mobile/src/surfaces/market.tsx`、`apps/mobile/src/shell/app-shell.tsx`。

## Revision 263 — 2026-09-23

- **折叠地图 logo 视觉对齐**（MAP-FOOTPRINT-LOGO-001 跟进）：48 栅格原画占盒
  比例小一圈，同 size 下比旁边的 + 号显小。`mapFold` 状态用 size 22，
  跟 + 号（18）视觉对齐；`storeLines` 状态保持 18。
- 影响文件：`apps/mobile/src/surfaces/market.tsx`。

## Revision 262 — 2026-09-23

- **市场 / 个人主页换原型 logo**（MAP-FOOTPRINT-LOGO-001）：用户原型
  `deepseek_html_20260923_5c4a22.html` 更新了 2 个 logo。
  - `ProxyIcon` 新增 `mapFold`（折叠地图：三折外轮廓 + 两条折痕 + 右上苹果绿
    `#34C759` 状态点）与 `footprint`（场景足迹：镜头圈 + 轨迹曲线 + 起终点），
    48 栅格路径照抄原型，线条跟 color 走。`route` 通用图标保留给定位按钮。
  - 市场头部去地图的切换按钮用 `mapFold`；个人主页场景足迹入口用 `footprint`
    （紫色不变，只换形状）。
- 影响文件：`apps/mobile/src/components/proxy-icon.tsx`、`apps/mobile/src/surfaces/market.tsx`、
  `apps/mobile/src/surfaces/me.tsx`。

## Revision 261 — 2026-09-23

- **AI 分身中心：图库分「公共图库（输入）/ AI 生成图库（输出）」两个按钮，好友洞察只看真人**（AI-MANAGE-012）：用户：
  「ai 分身 移除 ai 小美 和 user_proxy 这是对真人用户设计的功能…好友洞察只关心真人用户」「我点击开启单独运营报错 404」
  「有 2 个图库按钮 一个是个人主页的公共图库 一个是 ai 生成图库 一个输入 一个输出」。
  - 图库：公共图库 = 个人主页照片 + 导入（AI 出图素材）；AI 生成图库 = `GET /v1/ai/personas/{id}/media?source=ai`，
    只属于已授权的分身，未授权显示「授权形象」按钮，出图任务未接上时如实空态，不放假图。
  - 好友洞察：服务端 `twininsight.IsHumanTarget` 过滤平台助手 / AI 账号 / agent（proxy_ai、user_proxy_ai、ai_*、agent_*），
    好友和陌生人两条来源都过滤。
  - 开启单独运营 404：`RecordOperate` 原来只认好友，列表里的陌生人点了就 404；现在以洞察列表本身为准。
  - 帖文编排 / 编辑受众的好友选择器显示真实头像（AI-TWIN-AUDIENCE-AVATAR-001，接手上一个中断会话的未提交改动）。
- 影响文件：`apps/mobile/src/components/twin-gallery-section.tsx`、`apps/mobile/src/components/twin-post-composer-section.tsx`、
  `apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx`。

## Revision 260 — 2026-09-23

- **AI 分身不再静默自动建，进入时先弹授权提示**（AI-MANAGE-010）：用户规则「ai 分身只给小美授权使用 没有这个授权的
  就是没有」「目前是测试账户 全部权限 后期…必须要等你申请接单权限 验证你是小美 会自动更新展示 点击进入自动默认授权
  但是要弹授权提示」。删除 `ensurePersonalTwin`（TWIN-SUBSPACE-ACTIVATE-001 的进页面就地建分身）：
  - `findAuthorizedTwin` 只读：有分身且本人形象授权仍生效才算有分身，没授权的旧分身当作没有；
  - 进入 AI 管理 / 好友洞察时若未授权，弹一次授权提示（`likeness-consent-prompt.ts`），同意才 `grantLikeness`
    （此时才建分身并写 VISUAL 授权）；「暂不」则什么都不建，显示未授权态 +「授权形象」按钮。
  - 接单权限 / 小美验证（入口只对小美展示）按用户要求本次不做；当前测试账号全部可见。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`、`apps/mobile/src/components/twin-insight-section.tsx`。

## Revision 259 — 2026-09-23

- **AI 管理加「形象授权」**（AI-MANAGE-009）：用户要求「模型提示要有本人授权 否则很容易侵犯肖像权 所以这个
  ai 管理还要有授权按钮 读取个人主页的图库 不然模型访问不了个人公共相册」。主页新增形象授权卡：未授权说明
  「不授权，模型读不到你的个人相册」+「授权」；已授权显示日期 +「撤回授权」；授权 / 撤回都要系统弹窗二次确认。
  授权即本人对自己 AI 分身的 LC-07 likeness consent（VISUAL，走已有的 /v1/ai/personas/{id}/consents）。
  服务端新增唯一的模型读图入口 `likenessReferencePhotos`：没有生效授权一张不给，撤回后立刻失效，只给本人上传的原图。
  图片管理 → 参数「形象绑定」改为反映授权状态（原来只看有没有照片）。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`。

## Revision 258 — 2026-09-23

- **AI 目录外置：价格 / logo / 免费额度不再写在代码里**（AI-MANAGE-007）：用户要求「价格 logo 数字…
  肯定加载专门的文件 别写在代码里 token 的费用属于高度变化的 后期运营了 直接对接 自动更新就好了」。
  出图厂商、模型、价格、logo、每月免费出图额度、聊天 Token 付费方放进运营维护的 `config/ai-catalog/`
  （`catalog.json` + `logos/*.svg`），服务端 `GET /v1/ai/catalog` 下发，按文件修改时间自动重载，坏文件
  继续用上一份好的。App 的图片管理 → 模型页从目录读，免费额度写在价格提示里；App 里不再有价格和厂商 logo。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`、`apps/mobile/src/surfaces/ai-management-data.ts`、
  `apps/mobile/src/ai-catalog-client.ts`。

## Revision 257 — 2026-09-23

- **生成场景换成照片样片、扩到 12 个**（AI-MANAGE-005）：用户反馈「图片生成场景 目前的 logo 有点难看
  场景有点少 这是做的场景资产样板 你也同步更新代替目前 6 个 增加场景 代替 logo」。场景卡改用
  `proxy_scene_photo_assets` 的 12 张样片做封面（底部压暗 + 白字名称 / 描述，选中黑框 + ✓），
  不再是 emoji + 渐变色块。场景：暖调咖啡厅、高级餐厅、海边度假、花园漫步、自然光 Brunch、城市天台、
  文青甜品店、夜色露台、老街灯笼、书店咖啡、江边日落、度假泳池；新场景各配视觉要素、提示词与 6 个姿态。
  旧场景 id（restaurant / izakaya / night）映射到新场景。照片打包在 `assets/ai-scenes/`，经
  `media/asset-sources.ts` 的 `getAiScenePhoto` 取。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`、`apps/mobile/src/surfaces/ai-management-data.ts`、
  `apps/mobile/src/media/asset-sources.ts`。

## Revision 256 — 2026-09-23

- **AI 管理的三张管理卡换用户给的图标**（AI-MANAGE-004）：用户反馈「把这 3 个 logo 换一下 目前的 ai 管理
  图片管理 logo 有点难看」。对话 / 图片 / 动态管理卡改用 `proxy_management_icons_svg` 里的
  conversation / image / dynamic-management.svg（原样内嵌、自带圆角底色），不再是 emoji + 渐变底。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`、`apps/mobile/src/surfaces/ai-management-data.ts`。

## Revision 255 — 2026-09-23

- **好友洞察头像空白**（TWIN-INSIGHT-AVATAR-001）：「为什么好友洞察头像是空白」。
  - 服务端 `buildInsight` 写死 `AvatarURL: ""` → 从 `identity.profiles.avatar_path` 解析，经
    `WireAvatarURL` 翻成可下发形状（`/v1/media/thumb/<id>`、`/`、http(s)）；认不出前缀回空串，
    宁回首字不发必 404 的 URL。`main.go` 挂 `SetAvatarSource(authorNames.ResolveAuthorAvatarPath)`。
  - 客户端不再把相对路径裸塞 `<Image>`：`twin-avatar-source.ts` 的 `twinAvatarSource` 统一经
    `resolveMediaUrl` 拼 base；`ProxyAvatar` 加 `Image onError` 回退首字（uri 变更重置失败态）。
  - 回归契约 `TWIN-INSIGHT-AVATAR-001` 写入 `check-regression-contracts.sh`。
- 影响文件：`apps/api-go/internal/twininsight/insight.go`、`apps/api-go/internal/identity/profile.go`、
  `apps/api-go/cmd/api/main.go`、`apps/mobile/src/components/{proxy-foundation.tsx,twin-insight-card.tsx,
  twin-insight-section.tsx,twin-avatar-source.ts}`、`apps/mobile/src/surfaces/AIIdentityShowcaseSurface.tsx`。

## Revision 254 — 2026-09-23

- **AI 管理按原型重做 + 对话管理管对人**（AI-MANAGE-003）：用户反馈「原型给了 干的一坨屎 logo 也不对
  功能也不对」（原型 `deepseek_html_20260923_83b40b (1).html`）。
  - 页面：页头（返回 / 节点牌标 / 红色暂停钮）、副标题「AI 正在替你工作」、深色状态卡、三张管理卡、
    版本行；三个 sheet 的标签页 / 选项 / 配色 / 尺寸逐项照原型。目录（6 场景、36 姿态、6 运镜、
    7 厂商含模型与价格）用 node 直接执行原型脚本导出到 `ai-management-data.ts`。所有选择真落
    服务端，点下去先变、失败撤回。与原型不同的：Token 不画「/ 200K」假上限；出图、自动发帖没接上，
    徽标写「未接出图」「全自动」并附说明，不画「运行中」；字号下限 11。
  - 「我的」入口：原来的 `sparkle` 不在图标表里、回落成文字「sp」，换成原型节点牌标。
  - 服务端：对话管理读**被代表的人**（私聊里收消息的真人）的设置，不再读发消息的人；
    暂停 / 关闭 / 每次确认都不替 TA 回（每次确认的「草稿给本人确认」尚未做，先不漏草稿给对方），
    全自动用 TA 的语气 / 长度 / emoji、以代回复人设回；Token 记在 TA 头上。跟 Proxy 助手的会话
    不受对话管理影响。演示用真人账号（home rail 28 人）种一行「全自动」，保持可测。
- 影响文件：`apps/mobile/src/surfaces/ai-management.tsx`、`apps/mobile/src/surfaces/ai-management-data.ts`、
  `apps/mobile/src/surfaces/me.tsx`、`apps/mobile/src/surfaces/me-profile-components.tsx`、
  `apps/mobile/src/surfaces/me-styles.ts`。

## Revision 253 — 2026-09-23

- **下拉刷新**（PULL-REFRESH-001）：用户反馈「目前所有社交产品都是上下滑动进行刷新 我们缺少
  这个逻辑」。首页、「更多」真人列表、「更多 → 聊天房」、消息收件箱、动态、市场的主列表都加了
  系统下拉刷新（`RefreshControl`）。转圈跟真实加载走：`src/components/pull-to-refresh.ts` 的
  `usePullToRefresh` 等 load 的 Promise，`useTrackedRefresh` 让首页的加载 effect 随 nonce 重跑、
  请求被 track，全部回来才收起；都带 15s 兜底。「我的」页本轮没接（该文件另一会话正在改）。
- **招呼句子不重复**（HOME-MORE-GREET-004）：挑句子时避开跟这个人聊天里我已经发过的句子，
  全发过了才允许重复（之前只记本次运行里上一句，AI 代回复会回「又是这句」）。
- 影响文件：`apps/mobile/src/components/pull-to-refresh.ts`、`apps/mobile/src/greet-state.ts`、
  `apps/mobile/src/shell/app-shell.tsx`、`apps/mobile/src/surfaces/requester-home.tsx`、
  `apps/mobile/src/surfaces/messages.tsx`、`apps/mobile/src/surfaces/feed.tsx`、
  `apps/mobile/src/surfaces/market.tsx`。

## Revision 252 — 2026-09-23

- **我的 → 账户 → AI 管理按新原型全量落地，连后端一起做**（AI-MANAGE-002）：
  原型 `deepseek_html_20260923_83b40b` 的暂停按钮、本月 Token、对话/图片/动态
  三个设置 sheet，此前诚实切片因「无后端」整段不做。本轮补齐服务端事实源并接线：
  - 服务端：迁移 119 `ai_engine_settings`（设置单行 + 当月 token_usage）；
    命令 `GetAiEngineSettings` / `UpdateAiEngineSettings`（owner 由 actor 盖章，
    部分字段先 normalize 补默认再 validate）；`RecordAiTokens` 在真实推理成功后
    累加当月用量；擦除回执带两张表计数。
  - 会话门禁：`SetAiEngineChatStateReader` + `SetTokenMeter` 装进 `cmd/api`；
    paused 全局挡（`PAUSED`），`off` 不生成（`OFF`），`confirm` 出草稿不落库
    （`aiDraft`/`DRAFT`）；reader 未接 = fail-open（见 `ai_engine_gate.go`）。
  - mobile：新增 `ai-engine-client.ts`（command 信封读写，read 成功后种子
    write 链避免首写按默认盖掉服务端字段）；`ai-management.tsx` 按原型全量
    重写（暂停钮、Token/图片/视频状态卡、三管理卡+badge、chat/image/post
    三个 sheet、`AI Engine v2.4 · 平台托管` footer）。Token 只显示服务端本月
    累计、不编 120K/200K 上限；厂商/模型是偏好 ID 不直绑 provider；
    动态卡 `auto` badge 显示「全自动」不虚报「运行中」（无自动发帖 worker）。
- 影响文件：`apps/api-go/migrations/119_ai_engine_settings.sql`、
  `apps/api-go/internal/identity/ai_engine_settings.go`（+test）、
  `apps/api-go/internal/identity/{service,repository}.go`、
  `apps/api-go/internal/platform/postgres/ai_engine_settings.go`、
  `apps/api-go/internal/platform/postgres/identity.go`、
  `apps/api-go/internal/conversation/ai_engine_gate.go`（+test）、
  `apps/api-go/internal/conversation/service.go`、`apps/api-go/cmd/api/main.go`、
  `apps/api-go/openapi.commands.generated.yaml`、
  `apps/mobile/src/ai-engine-client.ts`（+test）、
  `apps/mobile/src/surfaces/ai-management.tsx`、`ai-management.test.ts`、
  `apps/mobile/src/surfaces/me.tsx`。

## Revision 251 — 2026-09-23

- **「已邀约」落盘 12 小时，可连发 3 条**（HOME-MORE-GREET-003）：用户反馈「已邀约 切换到
  home-更多 又重置了 … 可以发 3 条连续 超过没有回复等待回复吧 但是状态不能重置 必须要冷静
  12H 后才能重置状态」。
  - 新增 `src/greet-state.ts`：按登录账号记每个人最近一次打招呼时间（SecureStore），
    12 小时内一直「已邀约」，切页面 / 重启不重置；过期条目读回时丢掉。
  - 「已邀约」还能再点，再发一句；发之前查 DM：末尾我已连发 3 条、对方本人没回，就不发，
    提示「已经连发 3 条了，等 X 回复吧」。「回复」只认对方本人 —— 真人账号的 AI 代回复署名
    `proxy_ai`，每条秒回，算它的话上限形同虚设。
- 影响文件：`apps/mobile/src/greet-state.ts`、`apps/mobile/src/i18n.ts`、
  `apps/mobile/src/shell/app-shell.tsx`、`apps/mobile/src/surfaces/requester-home.tsx`。

## Revision 250 — 2026-09-23

- **邀约按钮：点下去立刻「已邀约」，不再等对方回复**（HOME-MORE-GREET-002）：用户反馈
  「显示发送中-已打招呼 这属于多余 邀约 已邀约 就可以 … 不能必须等对方（模型 真人）回复
  才能更新状态」。真人账号接了 AI 代回复，`StartConversation` 带首条消息时服务端会同步生成
  代回复再返回，之前挂在请求结果上改状态 = 等对方回复。现在点下即置「已邀约」，请求在后台发，
  只有发送失败才撤回并提示；去掉「发送中」和成功横幅。按钮加图标：邀约 = 气泡，已邀约 = ✓。
- 影响文件：`apps/mobile/src/i18n.ts`、`apps/mobile/src/surfaces/requester-home.tsx`。

## Revision 249 — 2026-09-23

- **「更多」列表：拼桌 / 邀约按同一窗景分，邀约 = 一点就打招呼**（HOME-MORE-GREET-001）：
  用户反馈「点击邀约 弹出了底部提示 和拼桌一样 这个要改」。以前按在线状态分拼桌 / 邀约，
  两个都弹同一个破冰面板。现在：
  - 已知距离 ≤ 200m（同一窗景）→「拼桌」，仍弹破冰面板约见面；
  - 更远或距离未知 →「邀约」= 纯打招呼：点一下直接从 8 句预制招呼里随机挑一句，
    经 PROFILE 源 DM 真发出去（已有会话就续在里面），按钮变「已打招呼」，列表顶部
    一行显示发了哪句；同一个人连着两次不会收到同一句。发失败说没发出去，访客提示登录，
    没账号的人如实说发不了。招呼句 6 种语言各 8 句（`GREETING_LINES`）。
- 影响文件：`apps/mobile/src/i18n.ts`、`apps/mobile/src/shell/app-shell.tsx`、
  `apps/mobile/src/surfaces/requester-home.tsx`。

## Revision 248 — 2026-09-23

- **我的 → 账户新增 AI 管理入口**（AI-MANAGE-001）：原型
  deepseek_html_20260923_83b40b 落地诚实切片 —— 状态卡只画真数（分身
  listMine 真查 + 照片/视频/动态现算），管理项只保留有真实去处的两条
  （出图 → AI 分身页，动态 → 个人主页）。Token 用量/暂停/三设置 sheet
  无后端，不做。
- 入口行图标用 `sparkle`（AI 分身行是 `aiPersona` 半身像，两行不再撞脸）。
- 影响文件：`apps/mobile/src/surfaces/me.tsx`（账户组加行 + `aimanage`
  路由，新文件 `ai-management.tsx` 不在契约实现清单内）。

## Revision 247 — 2026-09-23

- **好友洞察目标集扩大**（TWIN-INSIGHT-TARGETS-001）：只认好友会漏掉聊过天/
  看过主页的陌生人，rail 上出现"刚说过话却没有洞察"。目标=好友∪互动者，
  陌生人显示账号名或解析到的真名；无目标时空态文案改为"有人找你聊天或
  来看过主页后…"。
- **洞察工具仅向实名创作者发放**（TWIN-INSIGHT-ENTITLEMENT-001）：无使用权的
  账号读/写一律 403（`insight_viewer_forbidden`），客户端照实说"仅向认证
  创作者开放"，不折叠成未成年或故障。
- **分身副空间就地激活**（TWIN-SUBSPACE-ACTIVATE-001）：进 AI 分身页无分身则
  建一个（默认名，可改），不再停在"还没有洞察"死胡同；建失败走错误态。
- 影响文件：`apps/api-go/cmd/api/main.go`、
  `apps/mobile/src/twin-insight-client.ts`、
  `apps/mobile/src/components/twin-insight-section.tsx`。

## Revision 246 — 2026-09-23

- **卖家实名核验补上受控写入口**（COMP-SELLER-001）：读侧（撮合/收款按「已实名且
  未过期」放行）一直是通的，但「已实名」这个状态**没有来源** ——
  `INSERT INTO supply.seller_real_name_verifications` 全仓零命中，库里那 6 行只能靠
  手写 SQL，同时违反 084 自己的三条承诺（`legal_name='TEST-ONLY …'`、
  `id_number_hash` 是字面量而非哈希、`verified_by` 是会话标签而非运营主体），
  而读侧又把 `expires_at IS NULL` 读成「永不过期」⇒ **6 个卖家在无人核验的情况下
  通过了实名闸，而 5 条钉全绿**（「没数据」与「没权限」在这里长得一样）。
  现在：新增命令 `AttestSellerRealName`（operator 门 + 新增 `IDENTITY` scope；明文
  证件号在命令边界就地 sha256，领域事件载荷不带姓名/证件号）、迁移 118 加两条
  DB 级 CHECK、读侧谓词收紧为 `expires_at > NOW()`，dev 种子改走真实写入口。
- **simulated + Postgres 起不来**（SEED-IDENTITY-CHANNEL-001）：开发身份种子往
  `identity.login_identities` 写 `channel='PHONE'`，而 049 的 CHECK 只认 `EMAIL`/`SMS`
  —— 049 比这条 INSERT 晚三周上线，之后启动必然 `log.Fatalf`，**排在后面的
  supply / home-rail / media 三个种子一个都跑不到**（上一批实名行只能手写 SQL 的
  根因）。改为与内存种子 `localIdentityService` 对齐：不写 channel/identifier。
- 影响文件：`apps/api-go/internal/supply/seller_identity.go`、
  `apps/api-go/internal/supply/service.go`、
  `apps/api-go/internal/platform/postgres/supply.go`、
  `apps/api-go/internal/platform/postgres/seller_identity.go`、
  `apps/api-go/internal/api/security.go`、
  `apps/api-go/internal/api/operator_scopes.go`、
  `apps/api-go/cmd/api/wire_seed.go`、`apps/api-go/cmd/api/wire_supply.go`、
  `apps/api-go/migrations/118_seller_real_name_attestation_guards.sql`、
  `scripts/check-regression-contracts.sh`（另有新增测试：
  `internal/supply/seller_real_name_attestation_test.go`、
  `internal/platform/postgres/seller_real_name_attestation_integration_test.go`、
  `cmd/api/dev_identity_seed_test.go`）。

## Revision 245 — 2026-09-23

- **开房 / 进房不再闪回首页**（HOME-MORE-ROOMS-002）：用户反馈「点击聊天房卡片
  创建 先弹回 home 再进入创建 这个多此一举」。根因是「更多」整页是全屏 Modal，
  创建页 / 房间是 app-shell 里另外的 Modal，iOS 只能呈现一个，只好先关「更多」。
  现在 `RoomCreateSurface` / `RoomSurface` 新增 `presentation="overlay"`，从
  「更多 → 聊天房」进来时叠在「更多」Modal 里面；返回回到聊天房列表（并重读列表）。
  从消息页进房仍走原来的独立 Modal（app-shell 按入口区分，同一时刻只有一份 visible）。
- 影响文件：`apps/mobile/src/shell/app-shell.tsx`、
  `apps/mobile/src/surfaces/requester-home.tsx`、
  `apps/mobile/src/surfaces/room-create.tsx`、`apps/mobile/src/surfaces/room.tsx`。

## Revision 244 — 2026-09-23

- **「更多 → 聊天房」改成列表视图**（HOME-MORE-ROOMS-001）：照原型
  `deepseek_html_20260923_2308b7.html`，「聊天房」chip 不再直接跳创建页，
  而是把本页列表切成「开房大卡 + 正在进行的房间」。大卡整卡 = 默认场景开房，
  4 个场景 chip（City Walk / 咖啡 / 看展 / 桌游，复用 `room-create.tsx` 的
  `SCENE_OPTIONS`）= 带着该场景打开创建页。房间列表只列服务端真实的 GROUP
  会话（带 `roomScene`），点一行进房；读失败与没有房分开显示，访客提示登录。
  没有公开可加入的房间目录，所以不画别人的房、不画假「加入」。
- **语言入口挪到「更多」的「中文」chip**（HOME-I18N-002）：首页页头的「中」
  按钮去掉；「中文」chip 显示当前语言本名（中文 / Tiếng Việt / English …），
  点开选择语言面板。面板新增 `presentation="overlay"`，叠在「更多」整页 Modal
  里面，不嵌第二个 Modal。原「会中文」筛选随之让位给语言入口。
- **「更多」chip 行改为单行横滑**：返回箭头、搜索固定两端，chip 在中间横滑
  （原型 `.filter-chips { overflow-x: auto }`）。之前 flexWrap 换行时「聊天房」
  会被挤到第二行，落进返回箭头的 hitSlop。
- 影响文件：`apps/mobile/src/components/language-sheet.tsx`、
  `apps/mobile/src/i18n.ts`、`apps/mobile/src/shell/app-shell.tsx`、
  `apps/mobile/src/surfaces/requester-home.tsx`、
  `apps/mobile/src/surfaces/room-create.tsx`。

## Revision 243 — 2026-09-22

- **房间见面进壳**（ROOM-CREATE-001）：`app-shell` 新增创建房间面板 +
  房间聊天页（GROUP + RoomScene），`conversation-client` 新增
  Propose/Accept/Nudge/Arrive/CompleteMeetup；`main.go` 只做服务接线，
  不改视觉。
- **场景地图默认不再硬编码 threebeans**（SCENE-MAP-DEFAULT-001）：无参
  打开为地图/列表总览，带 sceneId 才直达详情。
- **聊天门禁提示分槽**（COMP-AI-MINOR-001 聊天侧）：`conversation.tsx`
  新增持久门禁横幅（GATED 重试无效），瞬时失败仍走 error，不改气泡视觉。
- **主页帖子失败与空态分开**（PROFILE-POSTS-FAILURE-001）：`ProfileTabs`
  新增 `postsFailed`，失败显示“动态没读出来”，不再冒充“还没有动态”；
  `me.tsx` 主页搜索/图库排除 TARGETED 私密帖（AUDIENCE-004），相对路径
  经 resolveMediaUrl 拼装（GALLERY-004）。
- **「更多」页距离改成真半径控件**（HOME-MORE-DIST-001）：照
  `deepseek_html_20260922_1c2e2c.html` 的 distance-chip，「附近」不再是
  写死 1km 的开关 —— 距离恒生效、可选 1/3/5/10/20/50/100 km（默认 10km），
  chip 显示当前半径并展开滑杆面板；距离未知的人在任何半径下都不算「附近」
  （PERSON-DISTANCE-ZERO-001 不变）。chip 样式随原型：无边框、选中转深色。
- **首页 rail 全部换成真账号写真**（HOME-RAIL-ACCOUNT-001）：废止
  OVERRIDE-UNSplash-001 的 5 张 stock 占位图（其中 4 张是风景/食物，被当成
  人脸渲染），28 个 rail 人物全部对应服务端真实账号 + 写真 thumb；缺图回落
  首字母。目标不存在的好友申请服务端明确拒绝（FRIEND-TARGET-EXISTS-001），
  文案区分“人不存在”与“不收申请”。
- **首页语言可选**（HOME-I18N-001）：照原型 `deepseek_html_20260922_1c2e2c.html`
  的 `LANGS` / 选择语言 sheet，新增 `src/i18n.ts`（6 种语言：zh/vi/en/lo/ko/ja，
  文案直接取原型 I18N 原文）+ `src/components/language-sheet.tsx`（底部面板），
  真人推荐页头加「中」按钮显示**当前**语言短标；选完落盘 `pref_language`、
  冷启动读回。首页整面 chrome（章节标题、空态、按钮、a11y、AI 对话回话、
  破冰开场白、骑行档位、距离 chip 单位）改为走 `t()`，不再写死中文。
  顺带修 `preferences.ts` 的语言校验：原先只认字面量 `"vi"`/`"en"`，其它一律
  回落 `"zh"` —— 会把新增的 lo/ko/ja **静默吞回中文**；改为 i18n 白名单判定。
  用户可见改动：页头多一个语言按钮、页面文案随语言切换。
- 影响文件：`apps/api-go/cmd/api/main.go`、
  `apps/mobile/src/components/language-sheet.tsx`、
  `apps/mobile/src/conversation-client.ts`、
  `apps/mobile/src/i18n.ts`、
  `apps/mobile/src/media/author-avatar.ts`、
  `apps/mobile/src/preferences.ts`、
  `apps/mobile/src/shell/app-shell.tsx`、
  `apps/mobile/src/surfaces/ProfileTabs.tsx`、
  `apps/mobile/src/surfaces/conversation.tsx`、
  `apps/mobile/src/surfaces/me.tsx`、
  `apps/mobile/src/surfaces/requester-home.tsx`。

## Revision 242 — 2026-09-20

- **访客首页不再弹"好友状态暂时无法加载"**（GUEST-RELATIONSHIP-001）：
  首页关系链 effect 先认 `isGuest` 再拉 `listMyFriendships`，访客直接跳过；
  切到访客时清掉上一手的失败提示。点 + 号仍走"登录后可添加好友"，行为不变。
- 影响文件：`apps/mobile/src/surfaces/requester-home.tsx`、
  `apps/mobile/src/shell/app-shell.tsx`（透 `isGuest`，1 行）。

## Revision 241 — 2026-09-20

- **benefit 做正本（按决议；018 暂不动）**：`DATABASE_URL` 分支改用
  `postgres.NewBenefitRepository`，内存仅回退；商户归属活动核销必须验成员
  （OWNER/ADMIN/OPERATOR，无 verifier fail-closed，BENEFIT-REDEEM-002）；
  voucher 钱包只读桥接 `bft_` 到 benefit claims，不再自发免费券
  （VOUCHER-DEFAULTS-001）；核销回执去伪 `MERCHANT_CONFIRMED` 改
  `SELF_REPORTED_NO_MERCHANT_VERIFICATION`（VOUCHER-CONFIRM-001）。
- **对话点头像直达主页**：去掉中间「关注/进入主页看看」sheet
  （`peer-follow-prompt.tsx` 删除），意图明确不再多一步确认；
  头像透传（AVATAR-CARRY-001），主页不再画首字母圆圈。
  回归钉 CONVO-AVATAR-PROFILE-001 反向钉同步退役（改守直达+禁加回中间
  sheet），关注走他人主页自己的按钮（`toggleFollow` 真接口）。
- **1:1 消息发送者名诚实**（SENDER-NAME-HONEST-001）：1:1 非自己发的消息
  气泡用顶栏真名，不再落到字面“对方”；群聊仍保留“对方”。
- **注册页单验证码按钮**：对齐 `Proxy_Auth_Standard_UI_v7`，渠道由填了
  邮箱还是手机决定，不再分两个按钮。
- **切 tab 防抖**（TAB-SWITCH-JANK-001）：市场/动态 remount 有缓存同步渲染，
  后台 30s 节流刷新，评论注水合并一批一次 setState。
- 影响文件：`apps/api-go/cmd/api/main.go`、
  `apps/api-go/internal/business/service.go`、
  `apps/mobile/src/shell/app-shell.tsx`、
  `apps/mobile/src/surfaces/conversation.tsx`、
  `apps/mobile/src/surfaces/market.tsx`（另有非敏感：feed/媒体/native-app）。

## Revision 240 — 2026-09-20

- **「个人总管理」改名「个人管理」**。只是标签文案，路由（`personalmanage`）、
  页面结构、二维码与状态管理都不变。
- **接单编号（AGENT-CLAIM-NUMBER-001）**：个人管理→编辑资料新增只读行。
  编号由服务端注册时按顺序分配（1 起、无跳号，上限 10000000），展示至少 3 位
  零填充（001）；仅状态为可接单（AVAILABLE）时展示，不接单整行隐藏，无手动开关。
- 影响文件：`apps/mobile/src/surfaces/me.tsx`、`me-styles.ts`
  （新样式 `profileEditorClaimNumber`）、`me-profile-components.tsx`（转出
  `formatClaimNumber`）、`me-sub-pages.ts`（改名）。

## Revision 239 — 2026-09-20

- **个人主页搜索命中项：把「我的回复 / 动态」前缀补回来（修复 55ccbd4 造成的恒红钉）**。
  起因：`SEARCH-CORPUS-002` 第 3 臂要求 `me.tsx` 的命中项标明命中类型
  （`hit.kind === "reply" ? "我的回复" : "动态"`），理由是命中项可能是动态也可能是回复，
  不区分会让用户点进去发现「这上面没我搜的那句话」。9be8ae9 立了这条钉，
  **55ccbd4 把命中项渲染从底部弹层改成顶部浮层时没把这行带过去** —— 钉还在，实现没了，
  并且 55ccbd4 顺手把「没有这行」的状态记进了 Rev238。
  **改动的性质**：这是把 Rev238 里记录错的状态改回钉所要求的样子，不是新增设计。
  恢复后该臂转绿（改前红、改后绿，单独验证过）。
- 影响文件：`apps/mobile/src/surfaces/me.tsx`（1 行，命中项文案前缀）。
  搜索链路（`filterPostsByFeedSearch` / `replyMatchesProfileSearch`）与命中的数据域不变。

## Revision 238 — 2026-09-19

- **阅后即焚：撤回接线，并把它钉成合规闸（COMP-EPHEMERAL-001）**。
  起因：`conversation.tsx` 里 `markMessageRead` 是零调用方，收件人侧从不消耗阅览
  次数 —— 看起来是「半截接线」，我一度把这条消耗接上了。
  **经确认这是合规问题，不是漏接线**：`docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md`
  的「功能层面的硬性约束（不得回退）」第 1 条要求付费会话（OriginType TASK /
  SERVICE / ACTIVITY / NEED / OFFER / ORDER）**禁用阅后即焚、查看上限、防截屏**，
  服务端强制；同文档 Review Checklist 里
  「法务 review：防截屏 / 阅后即焚 / BURNER 在越南 / 东南亚的法律风险」**至今未勾**。
  **改动已全部撤回**（`conversation.tsx` 与 HEAD 逐字节一致，新增的测试文件已删）。
  撤回来的这条通道改成合规钉：守住服务端对付费来源走
  `TransactionLinkedProtection()` + 空策略（`ErrEphemeralNotAllowed`），并**禁止
  客户端自行消耗阅览次数**（那会让阅后即焚在社交会话里真的烧起来）。两种注入见红：
  拆掉服务端付费闸 / 客户端又去消耗次数。
  - 无基线敏感实现改动（`conversation.tsx` 未变）；本条目记录的是撤回与约束入闸。
  - **遗留（未处理，需产品/法务定）**：客户端「安全对话」面板里的
    「阅后即焚」6 档开关**没有按来源关闭**，付费会话里也能开，而服务端会拒
    （`ErrEphemeralNotAllowed`）。即：UI 仍在承诺一件服务端不允许、法务未过的事。
- 重建审计台账：原 `Backend_Frontend_Architecture_Audit_2026-09-17.md` 已丢失
  （从未被 git 跟踪，删了无痕），重建为 `architecture/Audit_Item_Status_2026-09-19.md`
  并入库 —— 记每项的状态、证据与待定，避免再次丢失后从头核。

## Revision 237 — 2026-09-19

- 审计第三轮/第四轮残留四项（2026-09-17 那批被 index-only 提交扫掉后重建）：
  - MARKET-DEAD-MORE-001：删 `market.tsx` 四处头部「•••」死按钮（订单详情 /
    发布需求模板页 / 发布需求表单 / 选人工作台）+ 零引用的 `styles.detailMore`。
    不给它接空壳菜单 —— 按不动的按钮是在承诺一个不存在的菜单。
  - PUBLISH-NO-FAKE-DEFAULT-001：发布表单 title/time/location/priceMin 从空开始。
    以前预填"周六城市同行 + 拍照"／"河内 · 西湖 / 老城区"／具体金额，用户不改
    直接发布就产出一条自己没写过的假需求。示例改走 placeholder
    （标题 `#D8D4CA`，其余 `#A9A2B0`）。选模板/预设时才回填真值。
  - OPP-TYPE-OTHER-001：机会类型新增 `other`（其他 · 未分类）。关键词一个都不中
    时不再 return `coffee_photo`（那把「咖啡 + 拍照」稀释成垃圾桶）；未分类不给
    活动图标（给咖啡杯/相机都是编语义），渲染中性 `⋯` 占位；筛选面板补一个入口。
    样张复用咖啡那张 —— 没有新写 require（media 管线 R1 禁止 media/ 之外新增）。
  - SCENE-HUMANS-EMPTY-001：场景详情"适合一起的人"为空时补空态。SCENE-HUMANS-004
    只做了去重，空态是另一件事；这里用户正准备付钱，空白会被读成"加载中"。
    文案明说不是加载失败，也不承诺"再等等就会有人"。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`、
    `apps/mobile/src/surfaces/reality-scene-map.tsx`。
    无主题 token 改动；`other` 只多一个筛选 pill 和一个中性占位字形。
  - ADD-FRIEND-ENTRY-001 重写（不改产品行为，只改钉的形态）：好友与关系页那个
    重复的「添加好友」按钮被 ADD-FRIEND-ENTRY-002 摘掉后，旧钉仍要求
    `setView("ADD_FRIEND")` 按钮存在，与 002 直接矛盾、门禁恒红。
    已核实 ADD_FRIEND 仍由两处调用方以 `initialView="ADD_FRIEND"` 挂载进入
    （`me.tsx` 我的 → 添加好友、`messages.tsx` 顶栏扫码 MSG-SCAN-SHORTCUT-001），
    `friend-crm.tsx` 用 `directEntry` 接住这条路径 —— 通道没断，只是换了入口。
    钉改为守住不变量本身：必须有调用方挂载，入口可以换，不能没有；并补了 3 个
    真测试（原来那条只靠注释里的字符串偶然满足）。
    已做反向注入验证（改坏 `directEntry` → 红，恢复 → 绿）。
  - ADD-FRIEND-FROM-MESSAGES-001 同步改名（同样不改产品行为）：MSG-SCAN-SHORTCUT-001
    把消息模块「+」号方式选择页摘掉后，`onOpenAddFriend` / `setShowAddFriend` 那套
    入口名字没了，钉的 6 个条件里 4 个恒假、门禁恒红。已核实能力还在 —— 顶栏「扫码」
    → `scanShortcut` → 内嵌同一个 `FriendCrmSurface initialView="ADD_FRIEND"
    initialSheet="SCAN" scanOnly`，退出走 `setScanShortcut(false)`。
    钉改为守住「入口在 + 能退出去」，两处都做了反向注入（各见红一次）。
  - SCENE-ADDRESS-001 不再把街道名钉死：threebeans_bn 的地址在 2026-09-18 真机
    实测后更正过一次（Lê Văn Thịnh → 109 Lý Chiêu Hoàng，用户在店内上报定位），
    而钉里写死了旧街道名，于是「改对了」也被判红、门禁过不去。改成钉形状 —— 这条
    目录项必须自带 Address 且是街道级（带 `TP Bắc Ninh`），不许拿 Area（"Bắc Ninh"）
    冒充。三种注入都见红：删 Address / 地址退化成区名 / 删整条目录项。
  - FEED-SAVED-COUNT-001 / AUDIT-BATCH3-001 同样只是换针、不动产品代码：
    收藏在 FEED-ACTION-ICONS-001 之后从文字态（"收藏"/"已收藏"）变成图标态
    （`filled={isSaved} name="bookmark"`），漏斗副标题在 PROFILE-VISIT-001 接上真实
    主页访问数后改成「主页访问是真实数据；往后每一步和下方渠道来源仍是示例」。
    两处的测试文件都已跟着升级并通过（7 个），红的是 shell 钉里那两个旧字符串。
    针都换成当前形态，各自反向注入见红。
  - STORE-AMENITIES-001 原本**写错了**：它让 `104_store_amenities.sql` 去 grep 自己的
    文件名，而全仓 121 个迁移文件没有一个自报名字 —— 条件恒假，这条钉从写出来起就
    没绿过（门禁每次都在更前面退出，没人看见）。改成钉真东西：迁移文件存在、wifi 与
    空调温度是 `ADD COLUMN IF NOT EXISTS` 幂等新增、客户端 `StoreAmenities` 类型在。
    两种注入见红（各删一个字段）。

## Revision 236 — 2026-09-19

- CREATOR-HANA-NAM-001（Hana / Nam 转正为真人账户）：首页真人推荐里的 Hana、
  Nam 一直用 stock 占位；测试账号在动态里发来两人单人正脸（F组拆分，已验
  非同一人），转正为真人账户（facet 键＋写真资产＋identity 行＋首页映射）。
  - **基线敏感文件**：`apps/mobile/src/recommend-fixtures.ts`（首页映射）。

## Revision 235 — 2026-09-19

- SCENE-HUMANS-004（场景主页“适合一起的人”去重）：同一行 `detail.humans.map`
  并排挂了两次，每个人出现两遍。删掉第二遍，rail 只渲染一遍。
  - **基线敏感文件**：`apps/mobile/src/surfaces/reality-scene-map.tsx`（详情 humans rail）。
- SCENE-NAV-PIN-001（图钉快打卡）：点地图图钉不再直通详情，弹快打卡
  （导航去这里 / 看详情二选一）；导航走 MEETUP-NAV-001 同一套系统地图深链，
  看详情才进老链。详情页内导航按钮保留。
  - **基线敏感文件**：`apps/mobile/src/surfaces/reality-scene-map.tsx`（地图快打卡）。
- SCENE-STUDIO-001（场景 Studio 出图）：详情新增“场景 Studio”区，选中的时段
  场景 × 点中的菜单 × 绑定本场景的小美拼一张卡，截屏走系统分享；缺元素按钮
  disabled 并明说，不拿默认替身凑数。
  - **基线敏感文件**：`apps/mobile/src/surfaces/reality-scene-map.tsx`（详情 Studio 区）。

## Revision 234 — 2026-09-18

- PROFILE-SEARCH-DOCK-001（个人主页搜索换 Home 搜索条同款浮条）：删标题
  「搜索主页」、说明文案、底部「搜索」按钮与结果类型小标签；浮条白底圆角
  27、高 54，只留输入框＋→（去相机/语音/AI），在顶栏搜索图标下方弹出，
  透明底点外部关闭；输入即搜，点结果直达。搜索语料不变（动态正文/作者/
  城市＋我的回复）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`（搜索弹层）、
    `apps/mobile/src/surfaces/me-styles.ts`（浮条样式）。复用 Home 搜索条
    既有圆角/阴影语言，无主题 token 改动、无外部视觉参考变更。

## Revision 233 — 2026-09-17

- SHEET-ICONS-001（＋ 面板文字行换图标块）：名片 / Proxy 活动 / 位置三个入口
  改成 56px 图标块＋小字（`user` / `ticket` / 新增 `pin` 形），处理函数一个没动；
  相机媒体不进 ＋ 面板（都在相机图标的相册里）。`pin` 形走 registry 既有
  24 格线形语言。
## Revision 232 — 2026-09-17

- SHEET-ICONS-001（＋ 面板文字行换图标块）：名片 / Proxy 活动 / 位置三个入口
  改成 56px 图标块＋小字（`user` / `ticket` / 新增 `pin` 形），处理函数一个没动；
  视频行删除 —— 拍照/选图/选视频都在相机图标的相册里，＋ 里留任何一个都是
  第二条路。`pin` 形走 registry 既有 24 格线形语言。
  - **基线敏感文件**：`apps/mobile/src/surfaces/conversation.tsx`（面板条目展示）、
    `apps/mobile/src/components/proxy-icon.tsx`（新增 `pin` 形）。无主题 token 改动
    （图标块用 lotus 现有墨/纸/灰）。

## Revision 228 — 2026-09-17

- CONVO-ATTACH-002（相机图标合并为相机位+全量相册网格，替换 CONVO-ATTACH-001
  遗留问题）：001 的首格是"点了跳系统相机"的按钮、相册只查图片且硬编码
  24 张上限、缩略图逐张调用 `getUri()`（触发 iCloud 下载，是选完等 3 秒
  的根因）、没带 mimeType（iPhone 默认 HEIC 声明成 JPEG，被服务端
  `mediaMimeAllowed` 拒收，是"选好照片发不出去"的根因）、视频要另外去
  ＋ 面板找。
  - 首格换成 `CameraView` 实时取景 + 快门直接拍；下面是图片+视频全量
    网格（`.within(AssetField.MEDIA_TYPE, [IMAGE, VIDEO])`，FlatList
    `onEndReached` 静默分页，无可见"加载更多"按钮）。
  - 缩略图改用 asset id 直接渲染（不碰网络），`getUri()` 只在点选那一张
    时才调用一次，按文件名推 mimeType 再发送。＋ 面板去掉重复的
    "照片"/"视频"两行。
  - **基线敏感文件**：`apps/mobile/src/surfaces/conversation.tsx`（相册
    sheet 交互与相机位）。复用既有 bottomSheet 语言与图标，无主题 token
    改动、无外部视觉参考变更。

## Revision 227 — 2026-09-17

- MAIN-WIRING-SPLIT-001（`cmd/api/main.go` 按域拆分）：1387 行的单文件接线根
  拆成 `wire_providers.go` / `wire_seed.go` / `wire_supply.go` /
  `wire_fulfillment.go`，`main.go` 只留 `main` 函数。纯文件搬运，零行为变更
  （函数清单 diff 为空，`go build`＋包单测全过）。多 worktree 并行时它是
  merge 冲突概率最高的单点，拆完各域改各域的文件。
  - **基线敏感文件**：`apps/api-go/cmd/api/main.go`（集成接线面）。
    无接线语义改动、无新增依赖、无主题改动。
## Revision 228 — 2026-09-17

- AUDIT-BATCH3-001（第五~九轮 P0 小项合集）：分享链接按登录用户动态拼
  （空 handle 禁分享）；收藏页假记录换诚实空态；App Shell 挂载法律状态横幅
  （开机＋回前台拉公开接口，失败静默）；访问转化页副标题改“示例数据”；
  粉丝假脸删除只留真数字。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`（分享链接、漏斗文案、
    粉丝区）。无主题 token 改动（删的恰好是三处 Tailwind 外来色）。
## Revision 231 — 2026-09-17

- BADGE-WALL-001（个人徽章墙＋场景进度）：10 枚成就只管“得没得”，墙和进度
  要“还差几家”—— 个人主页加徽章墙（得过点亮、未得置灰给条件、失败可重试），
  场景主页加本店进度（能点亮哪些、还差几家点谁的名）。数据源是新增的
  `ListMyCheckinHistory`（all-time 打卡史，取消即删；有效期内的 here 集合
  会过期缩水，不能用）。计数/集合类给进度，hasAny 与足迹类没有进度概念。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`（个人墙新区段）、
    `apps/mobile/src/surfaces/reality-scene-map.tsx`（场景进度块）。
    复用既有卡片语言与徽章 emoji，无主题 token 改动。

## Revision 230 — 2026-09-17

- UNREAD-PIPELINE-001（未读徽标真管线＋删在线圆点）：会话列表的未读徽标
  以前永远不亮（没映射），在线圆点全仓无数据源。现服务端按阅读位算未读数
  下发，打开会话标一次已读；在线圆点直接删除（presence 系统另立项）。
  - **基线敏感文件**：`cmd/api/main.go`（阅读位仓接线，一行）、
    `conversation-client.ts`（`markDialogRead` 方法）、`conversation.tsx`
    （首次加载后上报）。`messages.tsx` 的改动是同文件徽标映射与删圆点。
    无主题 token 改动、无列表结构改动（徽标是既有样式）。

## Revision 226 — 2026-09-17

- NOTIF-INVITE-OFFER-001（邀请卡片删“询问”按钮）：点它只是把邀请状态从
  PENDING 改成 ASK，用户没有地方输入问题，跟拒绝没有实质区别 —— 按死按钮
  纪律删掉，不是藏起来。接受/拒绝保持接线；服务端仍接受 ASK（不断旧链）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`（个人主页邀请卡片
    少一个按钮）。无主题 token 改动、无列表结构改动。

## Revision 225 — 2026-09-17

- DESIGN-CLEANUP-001（token 纪律第一批＋共享原语）：65 处硬编码 hex 换成
  值完全相等的 color token（零视觉差，逐个验值，见门禁）；`proxy-foundation`
  新增 `ProxyLoading`（tone 必传：brand/onDark/onLight/violet/muted）与
  `ProxyEmptyState`（icon/title/sub/cta），替换 21 处原生 ActivityIndicator
  （conversation 3 处 lotus 金先跳过，等 B 档定值）与 7 文件 12 处手写空态。
  - 有意为之的近似：原来不传色的 13 处吃系统默认灰，收敛到 muted（差一个色阶，
    统一比精确值钱）；`ProxyEmptyState` 的 CTA 走既有 `ProxyButton`，不再各写一套。
  - 删 `assets/order-type-logos/` 4 张死 PNG（无 import，测试早就不让引了）；
    `chat-lotus-aligned` 的 SUPERSEDED 引用从 screenReferences 挪进 legacy 数组。
  - **基线敏感文件**：`surfaces/ProfileTabs.tsx`、`surfaces/merchant-storefront.tsx`、
    `surfaces/merchant-me-r21-replacement.tsx`（空态迁移）。foundation 本体不在
    敏感名单，但三屏在，同提交认领。
  - B 档（lotus 近黑收敛）、C 档（Tailwind 系返工）、行内提示是否要 ProxyEmptyLine
    都没动，等设计拍板。
## Revision 224 — 2026-09-17

- CONVO-ATTACH-001（相机图标直进相册）：会话窗输入框的相机图标以前和 ＋
  弹同一张 sheet，进相册要点两次。现在点图标直进自建相册 —— 首格拍摄，
  后面是最新 24 张；选图进已有的预览＋发送链，拍摄复用 `chooseImage("CAMERA")`。
  - 为什么自建：系统相册一次只能做一件事（选图 XOR 拍照），合并不了；
    v57 顶层的 `getAssetsAsync` 是只会 throw 的占位实现（见 `image-export.ts`
    开头），列表走新 API `Query`/`Asset`，门禁有反向钉。
  - ＋ 面板同步减负：照片和拍照两行都撤（都在相机图标上了），只留名片 /
    视频 / 活动 / 位置。
  - **基线敏感文件**：`apps/mobile/src/surfaces/conversation.tsx`（入口行为、
    相册 sheet）。复用既有 bottomSheet 语言与图标，无主题 token 改动、
    无列表结构改动。

## Revision 223 — 2026-09-17

- CONTACT-CARD-001（会话里发名片）：`＋` 面板多「名片」入口 —— 第一张永远是
  「我的名片」，下面是服务端好友里能解析出 handle 的那些，点一张发出去，
  点开能再画成码给第三个人扫（复用 `QrZoomOverlay`）。
  - 收发同一串：body 就是 `buildContactCard()` 的 vCard（和二维码里编的同一串），
    渲染时 `parseContactCard` 解码；解不出就不带 contact，body 留原文（和 LOCATION
    解不出时同一个口径）。空 body 本地先挡（`sendContactMessage` 抛错），不发
    无法解释的空白气泡。
  - 服务端保护默认值和位置**反着来**：名片的意义就是被转出去，所以可转发、
    可复制、无查看次数上限、不警告截图，30 天过期与其他消息一致（位置默认是
    看一次、一小时消失 —— 照抄会让名片能发、不能转、一小时后变空白卡）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/conversation.tsx`（名片气泡、
    名片选择器、二维码放大）、`apps/mobile/src/conversation-client.ts`
    （`sendContactMessage`，CONTACT 类型）。选择器沿用既有 bottomSheet 语言，
    无主题 token 改动、无列表结构改动。

## Revision 221 — 2026-09-16

- PROFILE-QR-002（码里到底编什么）：**链接 → 标准 vCard 名片**。
  `apps/mobile/src/profile-qr.ts` 新增 `buildContactCard()` / `parseContactCard()`，
  替换原先的 `profileQrPayload` / `inviteQrPayload`。三处出示码的地方
  （我的二维码页 / 店铺卡 / 好友邀请）全部改成编名片。
  - 为什么不再编链接：那个域名**不是本项目的**（curl 返回 200，页面标题是 Spaceship 的
    待售页）；`app.json` 没有 `associatedDomains`、仓库里没有 AASA，所以就算域名是
    我们的，iOS 也不会把链接交给 App；而 `SearchProfiles` 按 handle/昵称**字面匹配**，
    那串链接粘进搜索框谁也对不上 —— 这正是用户报的「二维码 link 自己系统的搜索都搜不出来」。
    真域名 + Universal Link 是 T-15，**还没做**。
  - 卡片形状（ECC H 实测版本号）：个人 `N/FN/NICKNAME/X-PROXY-HANDLE` v10 57×57；
    店铺 `N/FN/X-PROXY-STORE` v12 65×65。**刻意不写 `ORG:`** —— 它只是把 FN 抄一遍，
    却要吃掉一整档版本号（v12→v13），实测解码通过率 88.2% → 76.5%。
  - 可扫性是量出来的，不是拍的：51 个尺寸（200–400px 步长 4）逐张解码的**通过率**
    —— 旧店铺链接 98.0% → 个人名片 88.2% / 店铺名片 88.2%。App 真正渲染的每个尺寸都过
    （104pt@2x=208px、@3x=312px、168pt@2x=336px，以及放大层的 2x/3x）。
    **单个尺寸不能当样本**：解码结果非单调（v10 在 260px 失败、288px 通过）。
  - 往返验证：解码文本与源 payload 0 处不一致，`parseScannedQr` 能读回全部四种真实形状。
  - **复制 / 分享的是「搜得到的那串」**（人给 `@handle`、店铺给店名），不再是链接；
    `QrZoomOverlay` 的 `value` / `caption` 拆开：编进码里的 vs 给用户看的。
  - 那三个出示码的文件里**一个字符都不许再有那个域名**（连解释「为什么删」的注释也不写
    —— gate 读原文，写了会在正确的树上误报）。完整实测记录只在 `profile-qr.ts` 文件头。
- PROFILE-QR-007（扫码支持从相册选取）：加好友的 SCAN sheet 增加「从相册选取」，走
  `expo-image-picker` 的 `launchImageLibraryAsync` + `expo-camera` 的
  `scanFromURLAsync` —— **标准组件，不自己写解码**。相册 / 相机 / 剪贴板三条路最后都
  汇进同一个 `handleScannedCode`。
  - 四种结局四种说法：没相册权限 / 图读不出来 / 图里没有二维码 / 不是 Proxy 名片。
- PROFILE-QR-008（亮屏范围）：「我的二维码」页那张 208px 的码，停在该页期间也把屏幕拉满
  （`useScreenBrightness`）。**同一时刻只允许一个 active** —— 放大层开着时由放大层负责，
  所以条件是 `route === "personalqr" && !qrZoomOpen`，不是 `qrZoomOpen || …`。
- 店铺名片被扫到时**单独说一句**：它没有 handle，直接丢进按 handle 查人的流程会落成
  「查无此人」，等于把「这是一家店」显示成「这个人注销了」。`scanLookup` 增加 `"store"`。
- **基线敏感文件**：`apps/mobile/src/profile-qr.ts`（payload 形状与可扫性）、
  `apps/mobile/src/lib/screen-brightness.ts`（新）。
- 测试口径：`src/profile-qr.test.ts` 已删除 —— 它是纯函数单测，证明的是「这几行代码
  还在」，而本轮改的是真机行为（相册选图 / 亮屏 / 名片格式）。gate 的 PROFILE-QR-003
  改由**接线钉**接手：vCard 字面量、三个调用点必须出现 `buildContactCard(`
  （裸符号会被 import 行满足）、三个文件里不许再出现那个域名、相册入口必须汇进共用处理器。
  7 个反向注入全部实测变红、基线绿，0 个钉没咬住。
- 生效前提：`expo-brightness` 仍需 `pod install` + **重建 dev client**（见 Rev 220）。

## Revision 220 — 2026-09-16

- PROFILE-QR-002（高亮补完）：放大层接上**真·系统亮度** —— 亮着这一层把屏幕拉到最亮，
  退出 / 卸载还原原值（`expo-brightness`，iOS 不需要 Info.plist 权限）。作用范围只有出示码
  这一屏，且只在 `visible` 时生效。
  - **基线敏感文件**：`apps/mobile/src/components/qr-zoom-overlay.tsx`
    —— 亮度副作用的位置与还原语义属于基线行为。
  - **不能顶层 `import`**：`expo-brightness/build/ExpoBrightness.js` 在**模块作用域**就执行
    `requireNativeModule('ExpoBrightness')`，而它在原生模块缺失时是**抛异常**、不是返回 null。
    本组件在 me.tsx / merchant-storefront / friend-crm 的 import 图里 → 顶层 import 会让
    **还没装这个 pod 的包一启动就崩**。改为 `loadBrightness()` 延迟 require + try/catch，
    原生模块不在就静默降级（白底满屏照常生效）。
  - 已用项目真实的 `babel-preset-expo` 转换该文件核对：模块顶层只有 react / react-native 等
    静态依赖的 require，`require("expo-brightness")` 落在 `loadBrightness()` 函数体内 ——
    启动期不会执行。
  - 还原语义：进入时先 `getBrightnessAsync()` 存原值 → 拉满 → 退出 / 卸载写回；**读不到原值
    就什么都不写**（宁可还原不了，也不要瞎写一个值）。还原挂在同一条 promise 链上，快速开关
    不会把亮度卡在 1 下不来。
  - **生效前提**：`pod install` + **重建 dev client**（`ExpoBrightness` 目前不在 Podfile.lock；
    Metro reload 不够）。

## Revision 219 — 2026-09-16

- PROFILE-QR-006（统一二维码管线）：全 App 只剩一处画码的地方
  `apps/mobile/src/components/proxy-qr-code.tsx` —— 分离的圆角点阵 + 圆角定位角 +
  圆形品牌徽标。四处调用点（个人二维码页 / 个人总管理卡 / 好友邀请 / 店铺卡 + 各自的
  放大层）全部收口，`react-native-qrcode-svg` 从依赖里移除。
  - **基线敏感文件**：`apps/mobile/src/components/proxy-qr-code.tsx`（新）
    —— **几何常数即基线**：点边长 0.87、点圆角 0.22、定位角外圈 0.30 / 挖空 0.55 /
      内芯 0.40、徽标 24% + 白圈 3.2%。动任何一个都要重跑解码验证。
  - 为什么要自己画：库把整个矩阵压成**一条** `strokeLinecap='butt'` 的 `<Path>`，
    圆点在它的 props 里没有入口；而参考样式（用户提供）要求分离的圆角点。
  - 编码器改成**直接依赖** `qrcode`（纯 JS）。不能让 `qrcode` 退回成
    react-native-qrcode-svg 的传递依赖 —— pnpm 严格布局下从 apps/mobile 根本解析不到，
    而 ambient d.ts 会把这个问题在类型层藏起来（typecheck 绿、Metro 报 Unable to resolve）。
  - 几何是量出来的不是拍的：在参考样式图（v3、29×29、模块 47.97px）上，相邻深色模块的
    公共边界 134/134 全为纯白，点宽中位 42.0px、缝宽 6.0px → 点 0.876 模块、缝 0.125
    模块（7:1）；点宽随高度的收缩曲线匹配**圆角方块**而不是圆。
  - 可扫性验证：144 用例（3 payload × 6 尺寸 × 4 徽标比 × 1x/3x）用 CoreImage 逐张解码，
    132 通过；12 个失败**与旧几何逐个同名**（即这次改几何零代价），且全部带「无徽标」
    对照，集中在 1x 的 88/104px 长 payload —— 真机 3x 全过。
- PROFILE-QR-002（放大 + 高亮）：全屏放大层统一成
  `apps/mobile/src/components/qr-zoom-overlay.tsx`，替换 me.tsx 里那套私有 Modal。
  - **基线敏感文件**：`apps/mobile/src/components/qr-zoom-overlay.tsx`（新）
    —— 深色标题条（圆形 qrGrid 徽章 + 粗体白标题 + 关闭钮）+ 纯白码区（**不加边框/阴影**，
      白边本身就是静默区）+ 灰色底部提示 + 动作行。
  - 高亮 = 纯白满屏（微信 / 支付宝出示码那一屏的做法）。真·系统亮度需要
    `expo-brightness`，要 pod install + 重建 dev client，本次未引入；接入位置在文件头注释里。
  - 放大层必须挂在 `contentWrapper` **外面** —— 全屏 Modal 塞进页面外壳会跟着被裁。
- 修掉一处「按了没反应」：个人总管理页的 QrCard 已经传了 `onQrPress`，但放大层只挂在
  personalqr 分支 —— 点下去只改了一个没人渲染的 state。两个分支各挂一份（互斥，共用锚点）。

## Revision 222 — 2026-09-16

- SCENE-CHECKIN-100M-001：场景详情只留「收藏 / 打卡」两个动作（requester-home-discovery scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/reality-scene-map.tsx`
    —— 删「标记去过 / 去这里 / 我在这里」三个人工声明入口；打卡走 100m GPS
    门禁（圈内可打 + 进圈自动打卡，圈外/无定位拒绝并明说距离）；取消不限。
    去过改由 300m 自动足迹记，planned/visited 历史数据照常加载展示。
    无列表结构、无主题图标改动。
  - 其余文件（`scene-checkin.ts` 纯门禁逻辑与单测）均非基线敏感。

## Revision 218 — 2026-09-16

- MAP-CONTAINER-PARITY-001：Home 场景页 / 市场内联卡 / 发布器三处地图容器统一
  （高 330、圆角 22、边框 line、底 offWhite），地图视图双 tab 横向一律顶边无间隙；
  定位/全屏/收起钮只留图标；地图下面只放地图（market scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`
    —— geoMap 规格、双 tab contentFlat、图标钮、全屏 Modal、聚合、需热；
    文案只做减法（删地址粒度卡、按钮去字），无新增页面。
- MAP-FULLSCREEN-001：市场内联地图右上 ⛶ 进真全屏（单实例复用，定位态不断），
  ✕ / 返回键退出（market scope)。
- MAP-CLUSTER-001：订单钉 + 探索点按可视跨度聚合，簇点放大散开；活动 tab
  不渲染订单钉旧语义保留（market scope）。
- OPP-REAL-COORDS-001：订单钉用服务端真 lat/lng（grid 投影只留兼容）；
  发布契约开 lat/lng 口，发布器地点下嵌地图选点（market scope)。
- SCENE-FOOTPRINT-AUTO-001：当面开详情 + 300m 内 + 已登录自动记私人足迹；
  SCENE-MAP-GESTURE-001：详情改盖层，地图常驻、手势不断（requester-home-discovery scope)。
  - **基线敏感文件**：`apps/mobile/src/surfaces/reality-scene-map.tsx`
    —— mapWrap 顶边、供热圈、自动足迹、详情盖层；视觉结构不变。

## Revision 217 — 2026-09-16

- PROFILE-QR-002 修复：「保存到相册」在真机上调用即抛，相册里什么都没有（personal-profile /
  invite / storefront 三个 scope 共用同一条坏调用）。
  - **根因（不是 UI 问题，是调用了一个只会 throw 的占位函数）**：
    `expo-media-library@57.0.5` 主入口 `src/index.ts` 结尾是
    `export * from './legacyWarnings'`，把真实现整个盖掉了；`legacyWarnings.ts` 里
    `saveToLibraryAsync` 的实现体是 `throw errorOnLegacyMethodUse('saveToLibraryAsync')`。
    也就是说从 Revision 210 起，「保存到相册」**在真机上从来没有成功过一次** ——
    它甚至没有走到权限或截图那一步。真实现在 `expo-media-library/legacy` 子路径，
    官方迁移方向是新类 API `Asset.create()`（走 `ExpoMediaLibraryNext` 原生模块）。
  - **修复**：新增 `apps/mobile/src/image-export.ts` 收口这条路径，三处调用点
    （`me.tsx` / `friend-crm.tsx` / `merchant-storefront.tsx`）不再各抄一遍。
    - `saveImageToAlbum(uri)` 用 `Asset.create()`；返回值区分
      `code: "permission" | "failed"` —— 没权限要引导去设置，保存失败才谈重试，
      两者合成一句「保存失败请重试」会让用户对着一个永远不会好的按钮反复点。
    - `toFileUrl(uri)`：`captureRef` 在 iOS 上返回的是**裸绝对路径**
      （`/var/mobile/.../tmp/ReactNative/xxx.png`，没有 `file://`）。相册模块对裸路径
      宽容，但系统分享面板拿到无 scheme 的 URL 会少给动作 —— 分享路径同样收口。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`、
    `apps/mobile/src/surfaces/friend-crm.tsx`、
    `apps/mobile/src/surfaces/merchant-storefront.tsx`、
    `apps/mobile/src/image-export.ts`（新增）。
  - `friend-crm.tsx` / `merchant-storefront.tsx` 的 `catch {}` 不再吞掉真实错误，
    失败文案带上原因。
  - **不改**：三个页面的布局、按钮位置、成功文案、二维码 payload 全部不变。
  - **验证方式**：真机点一下，相册里有图。源码级 grep 测试对这一类故障无效 ——
    它证明的是「这行代码还在」，不是「这个功能能用」，所以本次不加单测。

## Revision 216 — 2026-09-16

- STORE-QR-001：店铺二维码从图标改成真码（merchant-storefront scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/merchant-storefront.tsx`
    —— 店铺卡片上的「店铺二维码」此前画的是一个 58×58 的 `qrGrid` 图标，
    却写着「扫码进入 … 可用于店内桌牌、海报和 Creator 分享」——承诺了一个
    不存在的功能。改为真实可扫二维码（`proxy.app/store/<id>` 的 https 全量），
    并补「复制链接」「保存到相册」两个动作与失败提示。
  - 截图锚点按店铺分开（`storeQrRefFor(storeId)`）：一个账号可能有多家店，
    共用锚点会在 A 店按保存时截到列表里最后渲染的那张码。
  - 样式：`qrIcon` 换成 `qrShot` / `qrActions` / `storeQrNotice`。
  - 无新增页面、无列表结构改动、无文案改动。

## Revision 215 — 2026-09-16

- PROFILE-QR-005：子页返回认父页（personal-profile scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`
    —— 新增 `closeSubPage()`：子页带 `backRoute` 时返回到父页，缺省回「我的」
    根页。三条退出路径（硬件返回 / 侧滑 / 页内返回键）统一走这个出口；
    二维码页的两个入口分别声明 `backRoute: "personalmanage"` /
    `"bdash"`。没有 `backRoute` 的子页行为一字不变。
  - `apps/mobile/src/surfaces/me-types.ts`（`MeSubPage` 增加可选 `backRoute`）。
  - 无新增页面、无列表结构改动、无文案改动。

## Revision 214 — 2026-09-16

- PROFILE-QR-004：二维码常规能力不再只挂在商家路径（personal-profile scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`
    —— 「个人总管理」的二维码卡片改成多动作（`QrCard` 新增可选 `actions` /
    `shotRef` / `qrSize`）：复制链接、保存到相册、我的二维码页入口，三件事在
    普通用户路径上就能按到；handle 非法时不画码、也不给存假码的按钮。
    `personalqr` 子页接受透传的 `qrPayload` / `qrTitle`，商家卡片画店铺码时页里
    仍是店铺码（以前一律画成个人主页码）；店铺码下不渲染「扫码后看到」的
    TikTok / Zalo 分层预览 —— 那是个人主页的口径，套到门店页属于编内容。
    保存/分享的截图锚点改由调用方传入，不再写死 `qrShotRef`。
  - `apps/mobile/src/surfaces/me-profile-components.tsx`（QrCard 多动作 + 存图锚点）、
    `apps/mobile/src/surfaces/me-styles.ts`（新增 `qrCardActions` / 幽灵按钮样式）、
    `apps/mobile/src/surfaces/me-types.ts`（`MeSubPage` 增加可选二维码透传字段）。
  - `apps/mobile/src/surfaces/friend-crm.tsx`：邀请二维码补「保存到相册」，
    与另两处能力对齐。
  - 无新增页面、无列表结构改动。

## Revision 213 — 2026-09-16

- MARKET-LEGEND-PARITY-001：地图图例行锁高，订单/活动两 Tab 等高（market scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`
    —— 图例行定高 34、副标题两行封顶+可收缩换行；副标题长短不再撑出不同卡高。
    文案内容不变，无新增页面。

## Revision 212 — 2026-09-16

- MARKET-PIN-PARITY-001：探索点图钉去半透明，与订单钉同视觉权重（market scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`
    —— 摘掉探索点 `Marker` 的 `opacity={0.85}`；颜色语义不变（订单靛青/探索紫）。
    仍是原生图钉，无自定义尺寸。

## Revision 211 — 2026-09-16

- MARKET-MAP-USER-CENTER-001：市场地图初开以人为中心（market scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`
    （`MarketMap` 新增 `userCenter`，有人位先居中、无人位退回订单 centroid/河内；
    人位晚到补飞、不抢手动定位；文案无蓝点时不写“蓝点是您”）、
    `apps/mobile/src/shell/app-shell.tsx`（透传壳人位 `sceneMapOrigin`）。
    按钮行为与图钉不变，无新增页面。

## Revision 210 — 2026-09-16

- PROFILE-QR-002：一键保存二维码到相册（personal-profile scope）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/me.tsx`
    —— 二维码区新增「保存到相册」（`expo-media-library` 存图 + 相册权限说明；
    无权限/失败走文案提示，不静默）。「分享二维码图」「分享链接」改回幽灵按钮，
    同行只留一个主按钮。无列表结构改动、无新增页面。

## Revision 209 — 2026-09-16

- MSG-LOCATION-DUPE-001：顶栏本地范围入口只留 Home，消息页不再重复。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx`
    —— root Chrome 的 `LocationContext`（城市 + 切换 + 地图入口）只在
    `tab === "HOME"` 渲染；MESSAGES 分支摘掉，入口只在 Home 留一个。
    picker sheet 与定位状态透传不变，无新增入口、无列表结构改动。
## Revision 209 — 2026-09-16

- 「编造数据清扫批」的续批 —— 补 Rev207 漏掉的地图/场景域残留。
  原则与 Rev207 一致：**没有数据源时不许显示成数字**。
  涉及回归 ID：`GEO-HONEST-001`、`OPS-TELEMETRY-001`。

  为什么 Rev207 没扫到：那一批钉的是 `Scene` 结构体上的字段
  （`Quality`/`Posts`/`Creators`/`Activities`/`Invites`），
  而这三处编造值不在 `Scene` 上，在**详情响应**里，所以绕过了清扫。

  最刺眼的一处不是"数字是假的"，而是**假数字和真数据在接口上长得一模一样**：
  `capacityFor()` 用一张写死的 map 返回 61/39/74/81 当"容量"，
  `LiveState.FreshUntil` 又把它声明成"5 分钟内有效"，客户端渲染成
  「容量 61%」「数据有效至 14:32」—— 一个带保鲜期的实时占用率。
  而仓库里**存在**真实容量来源：`business.scene_supply_snapshots`
  （internal/business/operating_resolver.go，命令 `UpsertSceneSupplySnapshot`）。
  所以这不是"没数据"，是"生产方存在、读取方绕过了它"。
  接上它属于 `GEO-SUPPLY-WIRE-001`，不在本次范围。

  - **基线敏感文件**：
    - `apps/mobile/src/surfaces/market.tsx`（market scope）—— 三处改动，
      均为**文案与常量提取**，不改列表结构、不改交互、不新增入口：
      1. `EXPLORER_SPOTS` → `SEEDED_EXPLORER_SPOTS`；marker 文案
         「热门探索点」→「种子探索点 · 非实时热度」。原先注释声称
         "如果 server 返回了真实推荐点，该结构被覆盖"，实测**没有这段覆盖代码**，
         渲染是无条件的 —— 已删除该说法。
      2. 兜底视口坐标 `21.0285, 105.8542` 内联字面量 → 具名常量
         `HANOI_VIEWPORT_FALLBACK`。
      3. 删除零调用方的死桩 `mapConfig()`。
  - 其余文件均非基线敏感：
    - `apps/api-go/internal/realityscene/service.go` —— `LiveState.CapacityPct` /
      `FreshUntil` 改为可空并省略；`Human` 增加 `source` 字段、`SceneFit` 改为可空；
      删除 `capacityFor()`；`humansFor()` 的 `FitReason` 由断言
      "同类 Scene 有真实完成记录" 改为自报占位。
    - `apps/mobile/src/surfaces/reality-scene-map.tsx` —— 删除
      `TEMP-DIAG-MAPDEAD-001`（4 处调试输出 + 2 个只打日志的 handler）、
      兜底中心提取为具名常量；「容量 N%」在无来源时显示「容量未知」，
      占位候选不显示「Scene fit 96%」。
    - `apps/api-go/internal/api/operator_market_execution.go` —— 三个纯字面量端点
      增加 `dataSource: "FIXTURE"`。
    - `apps/market-intelligence-console/**` —— 新增 `FixtureNotice` 组件，
      由服务端的 `dataSource` 字段驱动显示占位横幅；`Engine.tsx` 删去
      "业务智能**已直连**在线决策引擎"的说法（`/v1/decisions/evaluate`
      在 server.go 里没有任何路由注册，属可证伪的假话）。
    - 命名测试、回归契约条目、`AGENT_LOCK.md`。

  反向注入验证：14 条钉（7 条 Go 测试 + 7 条静态）全部实测会变红，
  且每条注入都先确认写入、再确认**注入后仍能编译**（否则编译失败会被误读成钉生效）。
  过程中抓到两条我自己的假守卫，已修：见 `AGENT_LOCK.md`。

## Revision 208 — 2026-09-16

- MERCHANT-ACCOUNT-AVATAR-001：个人主页有头，商家账户卡永远字母（P0）。
  - **基线敏感文件**：`apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx`
    —— 身份卡头像改走店主头像指针解析（远端指针拼 thumb，与个人主页同一张；
    拼不出的回渐变首字）。无新增入口、无列表结构改动。
  - 其余文件（服务端读模型 JOIN、客户端透传与单测、命名测试、回归契约条目）
    均非基线敏感。

## Revision 207 — 2026-09-16

- 「编造数据 / 假状态」清扫批。统一原则：**没有数据源时不许显示成数字、成功、或者空**
  —— 编出来的数、把失败显示成「你还没有」、把占位当真值，三者都算。
  本次涉及的回归 ID：`MARKET-FAKE-JUDGMENT-001`、`MARKET-SEEDED-TRAVEL-001`、
  `MARKET-PRICE-RANGE-PARSE-001`、`MARKET-SEED-FAKE-ACTIVITY-001`、
  `CONVO-INBOX-SWALLOW-001`、`PROFILE-TAB-LOAD-FAILED-001`、
  `SCENE-COMPOSER-PREVIEW-001`、`ENTERPRISE-FABRICATED-001`、`STATIC-COUNT-001`、
  `FACET-HERO-FABRICATED-001`、`RECOMMEND-REPUTATION-FABRICATED-001`、
  `PERSON-DISTANCE-ZERO-001`、`SUBPAGE-GENERIC-FABRICATED-001`
  （同时收紧了既有的 `ADD-FRIEND-PHONE-COPY-001`）。
  - **基线敏感文件**：
    - `apps/mobile/src/surfaces/market.tsx`（market scope）—— 详情页不再直接读
      `opportunity.travel` 渲染「通勤约 N 分钟」，改走只认
      `travelSource === "user_distance"` 的派生函数（种子占位值不再冒充实时推算）；
      价格区间按两端解析而不是把两个数字拼成一个；删掉整盒写死的
      「Proxy · 给小美的判断」三条结论，改一句如实说明。**无渲染结构、无筛选、
      无发布链路改动。**
    - `apps/mobile/src/market-fixtures.ts`（market scope）—— 新增两个纯派生函数
      `parseOpportunityPrice` / `travelMinutesFromViewer`。**无 UI 结构。**
    - `apps/mobile/src/surfaces/ProfileTabs.tsx` —— 收藏 / 回复 / 被标记三个 tab
      增加 `failed` 入参，失败时在**长度判断之前**渲染「没读出来」，
      不再显示成「还没有收藏 / 回复 / 被标记」。
    - `apps/mobile/src/surfaces/me.tsx` —— 上一条对应的三个 failed 状态（失败置位、
      成功复位）；企业 / 经营子页面改为说明缺什么，不再整屏编内容。
    - `apps/mobile/src/conversation-client.ts` —— `listConversations` 的三条坏
      payload 路径由「返回空数组」改为抛错；收件箱加载失败不再长得像
      「还没有对话」。
    - `apps/mobile/src/shell/app-shell.tsx` —— Scene Composer 的「对方将看到」
      由写死的样例文案改为按用户选的参与方式 / 费用方式 + 与 `createScene`
      **同一个 `startsAt`** 拼出。**无渲染结构、无筛选、无发布链路改动。**
    - `apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx` ——
      「未读通知：2 条」改为「暂无数据接入」（没有通知数据源）。
    - `apps/api-go/internal/marketplace/service.go`（market scope）—— 发布不再
      无条件写 `Match = "100%"` / `Verified = true`（改为默认 false，仅在
      `merchantStamp` 命中、商家成员资格确被验过时置 true）；四条种子行的
      Match / Verified 清空，响应数归零、紧急度标记清空（发布路径的响应数初值
      本就是 0，只在真有人报名时 +1）。
  - **非基线敏感**的其余文件：facet 服务端 hero 统计（改为按对象 signals 累加，
    不再返回字面量）、`recommend-fixtures.ts`（推荐人评价类字段不再由下标生成）、
    `requester-home.tsx`（服务端真人不再被盖上距离 0；空状态文案如实）、
    `supply-client.ts` / `engagement-client.ts` / `surfaces/messages.tsx`、
    以及新增测试与 `scripts/check-regression-contracts.sh` 的回归条目。
    其中 `apps/mobile/src/surfaces/me-sub-pages.ts`（`SUBPAGE-GENERIC-FABRICATED-001`）：
    「我的 → 子页面」有专属分支与通用兜底两条渲染路径，通用兜底会把
    `SUB_PAGE_CONTENT[route].sections` 的每一行原样当用户数据渲染。删除 17 处
    `sections` 表 —— 其中 **「成员与权限」和「商家结果历史」两条路由没有专属分支，
    真的会把编造内容上屏**（前者列过三个不存在的人并给它们派了所有者 / 运营 / 账单
    权限，后者列过一条不存在的复查趋势：三次分数一路走高外加结论）。删除后这两条
    路由落回诚实的空态「正在准备这个工作区」。同时给 `ADD-FRIEND-PHONE-COPY-001`
    补上条件式正向钉：说明表一旦被加回来就必须写清搜索范围。**无渲染结构改动**，
    `me.tsx` 的兜底分支本身未改。

## Revision 206 — 2026-09-15

- DEVICE-LOCATION-003 + LOC-PIN-3KM-001 + LOC-SHARE-001：开屏定一次位，
  拖拽限 3KM，地址可复制/进 Google 地图。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— mount 后定
    一次位（跟随开着才定，拿不到当没发生）。无渲染结构、无筛选、无发布链路改动。
  - **视觉改动**（均非基线敏感）：选点页地址行下加复制地址/Google地图两按钮；
    拖 pin 超 3KM 停在 3KM 处并明说；地图"定位"按钮复用同一份取 fix 逻辑。
  - 其余文件（helper 与单测、命名测试、回归契约条目）均非基线敏感。

## Revision 205 — 2026-09-15

- DEVICE-LOCATION-002：跟随开关冷启动必丢（P0）。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— 恢复流程读写
    开关持久值（明确开过跟随不再被存过的手动地点打回；手动选择落盘关闭）。
    无渲染结构、无筛选、无发布链路改动。
  - 其余文件（store 持久层与单测、接线命名测试、回归契约条目）均非基线敏感。

## Revision 204 — 2026-09-15

- SCENE-MAP-LOCATION-001：场景地图每次打开回到河内默认（P0）。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— 算出
    `sceneMapOrigin`（设备 tracking 优先，其次手选地点 DEVICE 整条 /
    CUSTOM 有坐标）并透传给地图面。无渲染结构、无筛选、无发布链路改动。
  - **视觉改动**（非基线敏感的 `reality-scene-map.tsx`）：面挂载时 origin
    从透传值起步（仅还没值时接，不抢手动定位）；真没位置才走目录模式。
    用户看到的不再是每次重置的河内，而是手机位置附近。
  - 其余文件（接线命名测试、回归契约条目）均非基线敏感。

## Revision 203 — 2026-09-15

- MARKET-QUOTE-SHEET-001：报价搬出详情页，独立「你的报价」sheet。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`（market scope）——
    详情页删 customQuote 输入框与 quoteMode 本地计算，改 sheet 开关 + K 单位
    公平区间（与详情 VND 同一份预算推）；hero 加场景样张兜底（真媒体优先）；
    报价提交走 sheet 回调（K×1000）。无列表、无筛选改动。
  - 其余文件（sheet 新文件、推断函数参数放宽、命名测试、卡片 export 沿用
    Rev201）均非基线敏感。

## Revision 202 — 2026-09-15

- HOME-PEOPLE-SEARCH-001：首页人名搜不到新注册用户（P0）。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— 只把既有的
    `profileClient` 多透传给 `RequesterHome`（与 Rev197/198/199 同 pattern）。
    无渲染结构、无筛选、无发布链路改动。
  - **视觉改动**（均在非基线敏感的 `requester-home.tsx`）：输入人名本地推荐
    未命中（或同时）时，够长（≥2 码点）且有 client 就问服务端全站，结果以
    「全站真人」独立区块展示（主页 / + 加好友，本人显示"这是你"不给加按钮）；
    空结果与失败各说各话，失败给重试。无现有区块、无主题图标改动。
  - 其余文件（intent 触发判定与单测、命名测试、回归契约条目）均非基线敏感。

## Revision 201 — 2026-09-15

- MARKET-R37-DETAIL-001：订单详情头部与 R37 卡片视觉断裂修复。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`（market scope）——
    `OpportunityDetail` 头部不再写英文 OPPORTUNITY kicker，改用批准的类型 logo
    （`MarketTypeLogo`，与卡片同一组件）+「标准订单类型 + 中文类型名」
    （`TYPE_LABEL[detailType]`，与卡片同一张表，推断函数共用
    `inferOpportunityTypeForFilter`）；新增 `detailHeroTypeRow/Meta/Title`
    三个样式，其余 hero 结构不动。无列表、无筛选、无发布链路改动。
  - 其余文件（卡片 `TYPE_LABEL` 改 export、命名测试、回归契约条目）均非基线敏感。

## Revision 200 — 2026-09-15

- DEVICE-LOCATION-001 + CONVO-OPEN-001 / merchant-me Proxy 子页与真头像。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— ① 设备定位订阅
   （expo-location watchPositionAsync，DistanceInterval 1000m + 低精度，不碰
    精确定位那条需服务端同意的线；手动选过地点就关跟随，上次地点读完前不启动，
    未授权/不可用停在对应状态绝不伪装成成功）；LocationContext 副标题区分
    跟随中/定位中/没授权/不可用四态文案；LocationPickerSheet 多透传设备状态与
    跟随开关。② Convo 支线打开：messageChat 多带 convoId/convoTitle，
    MessagesSurface 新增 onOpenConvo。无顶栏/底栏/页面结构、无主题图标改动。
  - **基线敏感文件**：`apps/mobile/src/surfaces/merchant-me-r21-replacement.tsx`
    —— Proxy 数据页下新增平台通知/政策与规则/认证与资格/支持与申诉四个子页
    （复用既有 detailHead 与卡片样式；政策文案引用 Decree 248/2026、PDP 91/2025
    等已生效规则，缺失项明示并指向运营条款补充文档，不编造登记号与资质状态）；
    店铺头像有真图用真图，无图保持原渐变 + B fallback。无新增导航入口、
    无列表结构改动。
  - 其余文件（device-location 纯逻辑与单测、location-options/picker、
    reality-scene-address、scene 迁移 094–097、conversation/realityscene 服务、
    messages/me-sub-pages/friend-crm、回归契约脚本）均非基线敏感。

## Revision 199 — 2026-09-15

- FEED-AVATAR-REMOTE-001 + AVATAR-FLASH-001：动态本人头像黑头两连修。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx` —— 只把既有的
    `profileClient` 多透传给 `FeedSurface`（与 Rev197/198 同 pattern）。
    无渲染结构、无筛选、无发布链路改动。
  - **视觉改动**（均在非基线敏感的 `feed.tsx`）：① 本机文件丢失时（重装/清理）
    按远端指针回退服务端 thumb（与个人主页同一张），替代黑头；② 首帧用内存
    缓存直出、算不出时画透明占位，替代"黑底闪一下再换照片"。
    首字 fallback（#111 圆 + 字母）只在确认无照片时画。
  - 其余文件（profile-store 远端指针字段、clients、隐私/位置鉴权）均非基线敏感。

## Revision 198 — 2026-09-15

- APPLICANT-PROFILE-001：选人工作台的报名人从截断 ID（`申请人 xxx…`）换成真人
  名字（+ @handle），解析不到时回退截断 ID。
  - **基线敏感文件**：`apps/mobile/src/surfaces/market.tsx`（market scope）、
    `apps/mobile/src/shell/app-shell.tsx`（market 等 scope 的实现载体）。
    market 侧只动选人工作台的人名行与新增的 best-effort 解析 effect；
    shell 侧只把既有的 `profileClient` 多透传给 `MarketSurface`（与之前
    Rev197 给 Me 透传 `SessionClient` 同 pattern）。无列表结构、无筛选、
    无发布链路、无主题/图标改动。
  - **视觉改动**：报名人卡片标题从 `申请人 {id前10位}` 变成 `名字 @handle`
   （读不到时保持原样）。名字/handle 是报名人自选的公开身份（与扫码分享
    同一口径），不是联系方式；该面本就只给发布者看（"报名明细 · 仅发布者可见"）。
  - 单个解析失败只影响那一行，不整面报错 —— 一个人的资料读不到，
    不该挡住整份报名名单。

## Revision 197 — 2026-09-15

- DEVICE-LIST-001：设置页「设备管理」卡片从"设备列表尚未接入"换成真会话列表
  （ListMySessions + 踢出）。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx`、
    `apps/mobile/src/surfaces/me.tsx`。两处都只是把新建的 `SessionClient`
    顺着既有管线透传（native-app 构建 → shell → Me → SecuritySettings，
    与 `profileClient` 同 pattern），无渲染结构、无文案口径（除设备卡片自身）、
    无主题/图标改动。
  - **视觉改动**：只在 `security-settings.tsx`（非基线敏感）的设备卡片内：
    原来一行"设备列表尚未接入"的位置现在是四态列表（读取中 / 失败可重试 /
    空 / 设备行：平台 + 状态 + 登录日期 + 本机标记 + 非本机踢出）。
    卡片标题与"最多 2 台…自动踢出最旧"承诺文案不变 —— 该行为服务端本就
    在执行（MaxConcurrentSessions），这次只是让用户看得见两格槽位。
  - 其余文件（`session-client.ts` 新建、Go `ListMySessions`、openapi regen）
    均非基线敏感，按常规业务逻辑处理，不在此登记。

## Revision 196 — 2026-09-15

- ADD-FRIEND-FROM-MESSAGES-001：接上「信息 → 添加好友」入口，并修掉返回按钮
  **写错目的地**的标签。
  - **基线敏感文件**：`apps/mobile/src/shell/app-shell.tsx`、
    `apps/mobile/src/surfaces/me.tsx`。
  - `app-shell.tsx`：新增 `meOpenSubPage` 请求状态与 `clearMeOpenSubPage`
    （`useCallback` 稳定，否则 Me 侧的消费 effect 每次渲染都会重跑）；
    `MessagesSurface` 接 `onOpenAddFriend`（内部 `setMeOpenSubPage(meSubPage("addfriend"))`
    + `goToPage("ME")` —— 用 `goToPage` 而不是 `setTab`，因为
    `currentPage = pageOverride ?? 派生值`，`pageOverride` 停在 `MSG_FRIENDS` 时
    只改 `tab` 切不过去）；`MeSurface` 接 `requestedSubPage` /
    `onRequestedSubPageConsumed`。
  - `me.tsx`：新增消费跨模块请求的 effect（**请求 + 消费**，不是初始值 ——
    `MeSurface` 切走 tab 会卸载，用初始值会在之后每次进「我的」时又弹回添加好友）；
    `addFriendBackLabel="‹ 返回我的"`；三处重复的 `{title,desc,icon,route}`
    拼装收进 `me-sub-pages.ts` 的 `meSubPage(route)`（跨模块入口要用同一份文案，
    不收就会变成第四份拷贝）。
  - **视觉改动**：只在 `messages.tsx`（非基线敏感）的「新聊天」联系人页顶部加一行
    「添加好友」（＋ 圆形图标 / 两行文案 / 「去添加 ›」）。图标底色 `#efe9ff`、
    字形 `#6b4fd8`，与该文件既有硬编码色值同口径；无新增组件、无主题/图标注册表改动。
  - **原状**：`friend-crm.tsx` 的返回分支写着「当从 Messages 进入时…」，但信息模块里
    从来没有这个入口（全仓库 `addfriend` 只有渲染分支和内容条目两处命中），
    「新聊天」只能列收件箱里已聊过的人；同时 `me.tsx` 以
    `initialView="ADD_FRIEND"` 进这个表面，组件就从 `initialView` **猜**返回标签，
    猜出的目的地与 `onBack` 实际去向不是同一个地方 —— 标签在撒谎。
  - **改后**：标签由调用方给（`addFriendBackLabel`），且同一个 `directEntry`
    同时驱动行为与标签，两者不可能再对不上。
- DEAD-PROP-001（同一提交批次）：删掉两个「声明了但没人读」的 prop，两个文件都是
  基线敏感文件。
  - `me.tsx`：删掉一个全站搜索回调 prop（`(query: string) => void`）。它在全仓库
    只出现一次 —— 就是它自己的类型声明；没有调用方，也没有读者。
  - `app-shell.tsx` + `messages.tsx`：删掉 `MessagesSurface` 的初始 tab prop
    （`"CHAT" | "FRIENDS"`）。shell 一直在传值，组件从来没读过；而且这不是
    「忘了读」—— 它的词表和本页的 panel 模型（对话 / Convo / 文件夹）对不上，
    补线就得先编一套映射，那正是「组件替调用方猜」的老毛病。**删，不补。**
    真正区分「在聊天里 / 在消息列表」的是 shell 的 `messageChat` 状态
    （它会换成 `ConversationSurface` 渲染），不是这个 prop。
  - **无视觉改动**：两个 prop 都没人读，删除是行为等价的。
- PROFILE-POSTS-FAILURE-001（同一提交批次，基线敏感文件 `me.tsx`）：修掉
  「拉动态失败被渲染成 0 条动态」。
  - **原状**：两条读取路径（`listMyFeedPosts` → 失败后分页 `listFeedPosts` 过滤）
    都失败时，第二个 catch 体是**空的**，`profilePosts` 留成 `[]`，于是
    `ProfileTabs` 收到 `posts={[]}`、`stats.posts = 0` —— **「没拉到」和
    「你还没发过动态」渲染成同一个样子**。
  - **改后**：加 `profilePostsState: "loading" | "ready" | "failed"`；成功（含
    合法空结果）置 `ready`，两条路都失败置 `failed`。失败时在 ProfileTabs 上方
    渲染一条可重试的提示（`profilePostsReload` 计数进 effect 依赖，重试真的会重跑），
    且 `stats.posts` 传 `undefined` → 走同文件既有的 `dash()` 显示 **—**（未知不是零）。
  - **视觉改动**：仅失败态新增一条内联样式提示条（`#fdf2f2` / `#B3261E`，字号 11，
    与同文件 `profileSaveError` 的写法一致）。成功态与空态渲染不变。
  - **为什么不是新发明**：同文件里关注数早就是 `dash(n)`（未知显示 —），
    这次只是把同一个口径补到动态条数上。

## Revision 195 — 2026-09-14

- PROFILE-FROM-ANY-TAB-001 的**代码**落地：`app-shell.tsx`（两个个人主页分支
  提到 tab 分支之上 + `isNavVisible` 补 `!openHumanProfile`）、
  `app-shell.test.ts`（4 条顺序/接线测试）、`check-regression-contracts.sh`
  （PROFILE-FROM-ANY-TAB-001 回归钉）。**无新增视觉改动** —— 只是让既有的
  全屏主页目的地真的能被读到。
  - **为什么 193 和 195 说的是同一件事**：Rev 193 的条目已经完整描述了这个改动，
    但它在 `ee362ab`（PROFILE-QR-002）里被同批带走了 —— 那个提交因为「基线敏感
    文件必须在同一提交里登记」这条规则，收编了我当时尚未提交的 baseline 改动
    （Rev 194 的备注里也写明了这一点，一字未改）。
  - 本次提交动的是基线敏感文件 `app-shell.tsx` **本身**，按同一条规则必须再登记
    一次，所以补此条。**193 = 提前落地的登记，195 = 代码落地**，两者描述同一个改动。

## Revision 194 — 2026-09-14

- PROFILE-QR-002：个人二维码常规能力（`me.tsx` 个人qr页 + `friend-crm.tsx`
  邀请码 + `QrCard` 小卡）。有视觉改动：我的→我的二维码（点码放大 296 全屏
  黑底白卡、新增「分享二维码」按钮、链接文本可选）；邀请 sheet 二维码同口径。
  - **原状**：三处二维码全是裸 `proxy.app/...`（相机/浏览器/分享面板不认）、
    纠错等级 M、点不开大图；复制/分享出去的也是裸链接，很多 App 点不动。
  - **改后**：编码/复制/分享一律 `https://` 全量（`profile-qr.ts` 纯函数 +
    9 条单测，坏 handle fail-closed 不画坏码）；ecl M→H；白底卡片留足
    quiet zone；分享走 view-shot 截白底卡经系统分享（面板自带存相册，
    无需新权限）。
  - **备注**：本提交同批带上他人已写好的 Rev 193 原文（一字未改），因门禁
    要求基线登记必须同提交；Rev 193 对应的 app-shell 改动不在本提交内。

## Revision 193 — 2026-09-14

- PROFILE-FROM-ANY-TAB-001：动态页点「访问个人主页」修好。
  **无视觉改动**（只把分支位置从 tab 分支里面挪到上面），但 `app-shell.tsx` 是
  基线敏感文件，故仍记一条。
  - **原状**：动态 → 帖文 → 点头像 → 菜单「访问个人主页」，点了没反应。
  - **根因**：`openHumanProfile` 的**写入方在 FEED**（feed.tsx 点头像 →
    `onOpenProfile` → app-shell 的 `setOpenHumanProfile`），但读它的渲染分支
    此前只写在 `tab === "HOME"` 里面。链子是
    `realitySceneOpen → tab === "HOME" → tab === "MARKET" → tab === "FEED" → …`，
    在动态页 `tab === "FEED"` 就先返回了 —— 状态被设了却**没有任何分支去读它**，
    菜单一关，屏幕纹丝不动。
  - **同一洞的第二份**：`openAIProfile` 同样只在 HOME 分支里，而动态页可以
    → 现实场景图 → 点 AI 账号（`onOpenRealityScene` 就在 FeedSurface 上），
    此时 tab 仍是 FEED，一样进不去。两条一起修。
  - **修法**：把两个个人主页分支提到与 `realitySceneOpen` 同级（覆盖整个 body
    的目的地，不属于任何一个 tab），并从 HOME 分支里移除。同时把
    `!openHumanProfile` 加进 `isNavVisible` —— 与 AI 主页一致：全屏、收掉导航
    chrome、用返回键退出；否则从动态进入后底栏还在，切个 tab 会被留在一个
    没人负责关闭的主页上。
  - 回归钉 PROFILE-FROM-ANY-TAB-001 钉的是**顺序**而不是「存在」：
    `<OtherProfileSurface` 一直都在文件里，只断言它存在的话，把它挪回 HOME
    分支测试依然全绿 —— 那正是当初漏掉这个 bug 的原因。已做反向注入验证
    （把分支挪回 HOME 分支 → 测试与门禁同时变红，字节级还原）。

## Revision 192 — 2026-09-14

- STORE-REC-007：新增「我推荐的店」，推荐人能看见自己那条推荐的进展。
  有视觉改动：我的 → 企业 / 店铺 → 我推荐的店。
  - **原状**：运营队列 `ListStoreRecommendations` 是 operator-only，普通用户
    调不动 —— 推荐人提交完就再无回音，永远不知道自己推荐的那家店被采纳了没有。
  - **为什么是缺口**：采纳只代表运营批准接入，**不等于店铺已存在**；而能完成
    入驻的人通常就是推荐人本人。他看不到「该去建店了」，
    「已采纳 · 待接入」那一列就永远等不到人 —— 队列看起来办结了，事情却没发生。
  - 服务端新增 `ListMyStoreRecommendations`（非 operator 命令），作用域由服务端
    强制收敛到 `e.Actor.ID`，调用方传参无法放大。
  - 采纳态明确写成「已采纳 · 等你建店」，并说明批准不等于店铺已存在。

## Revision 191 — 2026-09-14

- BENEFIT-WIRE-001：把写好了但从没接线的权益链路接进 App。
  有视觉改动：我的 → 我的市场 → 我的权益；我的（企业身份）→ 商家 · 我的 → 权益核销。
  - **原状**：`BenefitClaimScreen` / `BenefitRedeemScreen` / `benefit-home-card`
    三个组件都写好了，`benefit-client` 方法齐全，服务端命令也在契约里 ——
    但**没有任何界面渲染它们**，`listCampaigns` / `getClaim` / `checkEligibility`
    一个都没人调。命令、客户端、UI 三者之间缺一段接线，用户永远看不到入口。
    这是第六次「通道建好了，没有调用方」。
  - 补的是最上游那一段：新增 `benefit-hub.tsx` 列出 ACTIVE 活动，点进去才进
    `BenefitClaimScreen` —— 后者需要 `campaignId`，所以「列活动」这步省不掉，
    不能凭空跳进去。只列 ACTIVE：DRAFT / ENDED 的活动列出来只会让人点进去
    发现领不了。
  - 商家侧核销必须绑定店铺主体：**没有主体时说清楚**，而不是塞一个空
    `merchantId` 让它静默失败 —— 那样运营只会看到「扫了没反应」，
    根本不知道是主体没绑。

## Revision 190 — 2026-09-14

- 推荐评估队列（STORE-REC-002/004）对 **BUSINESS 身份**开放入口。
  有视觉改动：我的（企业身份）→ 商家 · 我的 → 推荐评估队列。
  - 此前入口只挂在 REQUESTER 身份的「企业 / 店铺」组里，而运营更可能挂在
    BUSINESS 身份（"Business Principal · 当前你有经营权限"）下 —— 功能建好了，
    但它的使用者进不去。
  - 队列本身仍是 operator-only（服务端 `PROXY_OPERATOR_PRINCIPALS` 白名单）。
    没有运营权限的商家点进去看到的是明确的「这个账号没有运营权限」，
    **不是一个空列表** —— 空列表会被读成「没人推荐这家店」。

## Revision 189 — 2026-09-14

- STORE-REC-003：让小美（AI）推荐真正产生数据。有视觉改动：我的→推荐商铺进体系，
  新增「让小美帮你整理」。
  - **原状：origin="AI" 是一条从来没跑过数据的通道。** schema、服务、运营队列的
    「小美推荐」筛选与徽章全都支持 AI 来源，但 `RecommendStore` 唯一的调用点写死
    `origin="USER"` —— 队列里那个筛选器永远筛不出任何东西，是死 UI。而 Master PRD
    §15 里，AI（小美）本是体系增长的一半推荐来源。又是同一类坑：**通道建好了，
    没有调用方**。
  - 新增 `SuggestStoreRecommendation`（**只读**）：小美把用户随口说的话整理成
    {店名, 城市, 品类, 理由} 草稿；用户确认后才由 `RecommendStore` 落库并记
    `origin="AI"`。小美不直接写库，因此绕不过服务端那套 fail-closed 校验。
  - **不许编造**：用户没提到的字段留空，由用户自己补 —— 一旦服务端替他填个默认
    城市，运营就会照着一条假推荐去做评估。
  - **fail-closed**：模型底座未配置时用 `AI_NOT_CONFIGURED` 明确拒绝，App 据此把
    「让小美整理」入口**整个藏起来**。弹红字是误导（重试也没用），留一个点了没
    反应的按钮更糟。模型故障与输出非法是两个错误码（可重试 vs 不可重试）。
  - **顺带修掉一个同类的隐性降级**：`main.go` 里 `SetModelStack` 原先在 PG 替换
    **之前**注入，而 `NewWithRepository` 不携带 modelstack —— 配了 `DATABASE_URL`
    时适配器被静默丢弃，AI 能力退化成「永远 AI_NOT_CONFIGURED」，客户端又据此隐藏
    入口，从外部看这个功能就像从来没做过。marketplace 的 OPP-SUGGEST-001 正是踩在
    这个坑上。已加顺序 pin 钉住（负向注入验证会变红）。

## Revision 188 — 2026-09-14

- STORE-REC-002（App 侧运营队列）：新增 `apps/mobile/src/surfaces/store-recommendation-queue.tsx`，
  并在「我的 → 企业 / 店铺」下挂「推荐评估队列」入口，运营可在 App 内查看用户与小美
  推荐进体系的商铺。有视觉改动：我的→企业 / 店铺→推荐评估队列 子页。
  - **「没有权限」和「没有数据」必须长得不一样**：命中 `OPERATOR_PRIVILEGE_REQUIRED`
    时给出明确的权限说明，而不是渲染一个空列表 —— 空列表会让运营以为「系统里没有
    待评估的推荐」，而真相只是当前账号不在运营白名单里。
  - 城市 / 来源筛选走 `ListStoreRecommendations`；来源为 ALL 时不传 origin，
    避免用一个空字符串把结果筛没了。
- 二维码真实化收尾：`QrCard`（`me-profile-components.tsx`）支持 `qrValue`，个人主页卡
  与商家身份卡都渲染真实可扫描码，不再是 FakeQr 假图。商家码指向
  `proxy.app/store/{merchantId}`，merchantId 取「显式选中的商家或第一个 ACTIVE 店铺」，
  没有店铺才回落个人主页 —— 否则会出现名字显示店铺、扫出来却是个人主页的错位。
- 好友邀请 sheet 收尾：补全复制邀请链接（expo-clipboard）与复制成功提示，
  此前 `Clipboard` 已 import 但没有任何调用点，复制按钮点了没反应。

## Revision 187 — 2026-09-14

- PROFILE-QR-001：个人二维码真实化（react-native-qrcode-svg 编码
  proxy.app/@handle，替换 FakeQr 假码）+ 复制链接（expo-clipboard）+
  系统分享。有视觉改动：我的→我的二维码 子页。

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
