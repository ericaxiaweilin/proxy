import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");
const profile = readFileSync(fileURLToPath(new URL("./surfaces/ai-account-profile.tsx", import.meta.url)), "utf8");
const shell = readFileSync(fileURLToPath(new URL("./shell/app-shell.tsx", import.meta.url)), "utf8");
const scene = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const fixtures = readFileSync(fileURLToPath(new URL("./recommend-fixtures.ts", import.meta.url)), "utf8");
const locationPicker = readFileSync(fileURLToPath(new URL("./components/location-picker-sheet.tsx", import.meta.url)), "utf8");
const mapCanvas = readFileSync(fileURLToPath(new URL("./components/map-canvas.tsx", import.meta.url)), "utf8");
const searchDock = readFileSync(fileURLToPath(new URL("./components/home-search-dock.tsx", import.meta.url)), "utf8");
const homeAssistant = readFileSync(fileURLToPath(new URL("./surfaces/home-assistant.tsx", import.meta.url)), "utf8");
const i18n = readFileSync(fileURLToPath(new URL("./i18n.ts", import.meta.url)), "utf8");

describe("UI-HOME-DISCOVERY-001 requester home baseline", () => {
  it("puts the unified search and model conversation before discovery sections", () => {
    // Home Search/Conversation v3：常驻搜索 dock，AI 标识另进持久会话。
    expect(searchDock).toContain('accessibilityLabel="搜索人、活动、地点或时间"');
    expect(searchDock).toContain('accessibilityLabel="打开 Proxy AI 对话"');
    expect(searchDock).toContain("onPress={onOpenConversation}");
    expect(searchDock).toContain("想找谁、去哪、做什么？");
    expect(searchDock).toContain('accessibilityLabel="添加照片"');
    expect(searchDock).toContain('"语音输入"');
    expect(searchDock).toContain('accessibilityLabel="发送"');
    const dockUse = source.indexOf("<HomeSearchDock");
    expect(dockUse).toBeGreaterThan(-1);
    expect(dockUse).toBeLessThan(source.indexOf('t("title")'));
    expect((searchDock.match(/<TextInput\s/g) ?? [])).toHaveLength(1);
    expect(searchDock).toContain("<View style={styles.searchShell}>");
    expect(searchDock).toContain('name="camera" size={24}');
    expect(searchDock).toContain('name="microphone" size={24}');
    expect(searchDock).toContain('name="spark" size={25}');
    expect(shell).not.toContain("externalComposer");
    expect(shell).toContain("onOpenAssistantConversation={openProxyAIConversation}");
    expect(shell).toContain('setHomeAssistant({ text: "" })');
    expect(source).not.toContain("threadTurns");
    expect(source).toContain("模型对话只能由左侧 AI 标识显式进入");
    expect(source).not.toContain("自由自然语言 -> 走现有模型对话");
    expect(homeAssistant).toContain('originType: "HOME"');
    expect(homeAssistant).toContain('participantId: "proxy_ai"');
    expect(homeAssistant).toContain('originId: "proxy_ai_home"');
    expect(homeAssistant).toContain("!externalComposer ? <View style={styles.composer}>");
  });
  it("keeps the labeled human section before the hot-scene rail", () => {
    const human = source.indexOf('t("title")');
    const hot = source.indexOf('t("hotScenes")');
    expect(human).toBeGreaterThan(-1);
    expect(hot).toBeGreaterThan(human);
    expect(source).toContain('t("humanBadge")');
  });

  // AI-ROW-DUPE-001: 首页曾经同时渲染两条 AI 行 —— 上面一条「小美们」
  // (AIAssistantsRow)、下面一条「AI 推荐」，两者都来自同一个服务端目录
  // /v1/ai/assistants。2026-09-27 产品决定（commander）：AI 推荐行**整条
  // 下架**，换成 SCENE-HOME-HOT-RAIL-001 的热门场景横滑。本用例现在守
  // 「首页一条 AI 目录行都没有」：AIAssistantsRow 不许回来，AI 推荐的
  // JSX / 样式 / i18n 键不许残留。
  it("AI-ROW-DUPE-001: renders no AI row on home at all (AI rail taken down 2026-09-27)", () => {
    expect(source).not.toMatch(/<AIAssistantsRow[\s/>]/);
    expect(source).not.toContain('from "../ai-assistants-row"');
    expect(source).not.toContain("小美们");
    expect((source.match(/t\("aiRecommend"\)/g) ?? [])).toHaveLength(0);
    expect((source.match(/t\("aiGenerated"\)/g) ?? [])).toHaveLength(0);
    expect(source).not.toContain("styles.aiRail");
    expect(source).not.toContain("styles.aiSection");
    // 目录 prop 及其唯一消费者（listRecommended 拉取）已从首页摘除：
    // 组件不收 prop，shell 也不再传。
    expect(source).not.toContain("aiAccounts");
    expect(shell).not.toContain("onMessageAI={");
    expect(shell).not.toContain("aiAccounts={aiAccounts}");
    // 热门场景横滑在原 AI 行的位置接棒。
    expect((source.match(/t\("hotScenes"\)/g) ?? [])).toHaveLength(1);
    expect(source).toContain('styles.peopleTitle}>{t("hotScenes")}</Text>');
  });

  it("keeps matchmaking above nearby scenes because Scene is a meeting tool, not inventory", () => {
    const human = source.indexOf('t("title")');
    const hot = source.indexOf('t("hotScenes")');
    const composition = source.indexOf('t("combo")');
    const activeWork = source.indexOf('t("continueSection")');
    const sceneInspiration = source.indexOf('t("nearbyScenes")');
    // HOME-LAYOUT-002（2026-09-28，原型 deepseek_html_20260928_7d0503「新版首页」，
    // 用户：「新设计把for you放在真人推荐的位置」）：为你组合从"真人推荐 → 热门场景
    // → 为你组合"之后挪到最前——搜索 dock 之后、真人推荐之前。下面这条断言链
    // 因此从"combo 在 hot 之后"翻成"combo 在 human 之前"；combo 仍然排在
    // continueSection / nearbyScenes 之前的这条"匹配优先于库存罗列"精神不变。
    expect(sceneInspiration).toBeGreaterThan(activeWork);
    expect(activeWork).toBeGreaterThan(hot);
    expect(hot).toBeGreaterThan(human);
    expect(human).toBeGreaterThan(composition);
    expect(source).toContain("onOpenSceneMap?.()");
    expect((source.match(/<SceneActivityDiscovery/g) ?? [])).toHaveLength(1);
  });

  // SCENE-HOME-HOT-RAIL-001（原型 deepseek_html_20260927_d56fab「热门场景」）：
  // 横滑卡 = 封面 + 白字标题 + TOP N 角标 + 分类/区域 + 「N 人去过」。
  // 数据纪律：排序只按真实 visitedCount 降序、0 去过不进榜；原型里的
  // 「本周热榜」「实时更新」、头像栈和 ★ 评分没有数据生产者，一律不画。
  it("SCENE-HOME-HOT-RAIL-001: ranks the hot rail by real visitedCount only and badges only real visits", () => {
    // commander 2026-09-27：多做几个卡片 → slice 放宽到 9；0 去过的照进
    // （真实数字照写），但 TOP N 角标只给真的有去过人数的前 3。
    expect(source).toContain(".filter((s) => s.active)");
    expect(source).not.toContain(".filter((s) => s.active && s.visitedCount > 0)");
    expect(source).toContain("b.visitedCount - a.visitedCount");
    expect(source).toContain(".slice(0, 9)");
    expect(source).toContain("index < 3 && scene.visitedCount > 0");
    // 卡片直接进场景详情；「更多」进 HOT-SCENES-PAGE-001 整页（真实目的地，
    // 不是死按钮）——onOpenHotScenes 没接才退回旧的 onOpenSceneMap。
    expect(source).toContain("onPress={() => onOpenSceneMap?.(scene.id)}");
    expect(source).toContain("onPress={() => (onOpenHotScenes ?? onOpenSceneMap)?.()} style={styles.hotMore}");
    // 对齐真人推荐（2026-09-27 commander 反馈）：标题直接复用 peopleTitle /
    // peopleSub（同字号同左边距），头部容器不许自带 paddingHorizontal
    // （页面已有 16 缩进，加了就是双重缩进没对齐）。
    expect(source).toContain('styles.peopleTitle}>{t("hotScenes")}</Text>');
    expect(source).toContain('styles.peopleSub}>{t("hotScenesSub")}</Text>');
    expect(source).not.toContain("hotTitle:");
    expect(source).not.toContain("hotSub:");
    expect(source).not.toContain("paddingHorizontal: 16, paddingVertical: 10");
    // 「更多」= 灰字 + › 的可点链接（同 filterTrigger 的灰），不是黑药丸。
    expect(source).toContain('hotMoreText: { color: color.muted, fontSize: 13, fontWeight: "600" }');
    expect(source).toContain("hotMoreChevron");
    expect(source).not.toContain('hotMore: { alignItems: "center", backgroundColor: color.ink');
    // 文案诚实性钉在真正会被渲染的 i18n 字典上：没有周榜聚合，不许宣称
    // 「本周热榜 / 实时更新」；角标只能说清排序口径。
    expect(i18n).toContain('hotScenesTag: "按去过人数排"');
    expect(i18n).not.toContain("本周热榜");
    expect(i18n).not.toContain("实时更新");
    // 没有生产者的演示元素不许出现在卡片里：评分、头像栈。
    expect(source).not.toContain("hotStar");
    expect(source).not.toContain("hotAvatar");
  });

  it("FORYOU-LOGO-001: the For You header uses the new solid-rect glyph from the logo prototype", () => {
    // 新版主 Logo（commander 2026-09-27 晚，原型 deepseek_html_20260927_c89beb）：
    // 4 个实心矩形 + 中心大圆带白描边环（圆压在矩形交点上，白环分隔）。纯 View
    // 摆放，几何等比 100 viewBox 的 28px 变体（pad 4 / rect 42 / x=54 / 圆角 12；
    // 圆外径 36 + 白边 4 → 墨芯 r=14 对齐 SVG 描边内沿）。
    expect(source).toContain("function ForYouGlyph");
    expect(source).toContain("<ForYouGlyph size={28} />");
    // 矩形实心：backgroundColor 墨色 + 新版圆角 12/100。
    expect(source).toMatch(/function ForYouGlyph[\s\S]{0,900}?backgroundColor: color\.ink, borderRadius: size \* 12 \/ 100/);
    // 中心圆白环：钉使用形态（白描边 + 外径 36）。
    expect(source).toMatch(/function ForYouGlyph[\s\S]{0,900}?borderColor: color\.white, borderRadius: dot \/ 2, borderWidth: ring/);
    // 无底板外壳（v1 的 tone 底板 / 外框圆角）不许回来。
    expect(source).not.toMatch(/function ForYouGlyph[\s\S]{0,900}?backgroundColor: tone/);
    expect(source).not.toMatch(/function ForYouGlyph[\s\S]{0,900}?borderRadius: size \* 20 \/ 64/);
    // 旧方案 C 的空心描边矩形不许回来。
    expect(source).not.toMatch(/function ForYouGlyph[\s\S]{0,900}?borderColor: color\.ink, borderRadius: size \* 4 \/ 64/);
    // 头部结构 = glyph + 标题 + 黑底白字 For You 药丸（原型 .pill）。
    expect(source).toContain('forYouBadge: { backgroundColor: color.ink, borderRadius: 6');
    expect(source).toContain("forYouBadgeText: { color: color.white");
    // 旧紫色药丸不许残留。
    expect(source).not.toContain("forYouBadge: { backgroundColor: color.proxyPurpleSoft");
  });

  it("keeps human discovery as circle-and-name nodes that preserve the real Scene context", () => {
    expect(source).toContain("setHumanScenePreview({ person: p, sceneId: recommendFeed.boundSceneId })");
    expect(source).toContain('accessibilityLabel={t("viewFullScene")}');
    expect(source).not.toContain('testID="human-node-reveal"');
    expect(source).not.toContain("styles.recCard");
    expect(source).not.toContain("styles.storyHint");
    expect(source).toContain("p.photoUri && !brokenAvatarIds.has(p.id) ? <Image");
    // HOME-AVATAR-FALLBACK-001: 头像图挂了（404/断网）回落首字母，不留白圈。
    // stories/选人窗/真人主页三处同规，与 ai-assistants-row 的 broken 集同 pattern。
    expect(source).toContain("brokenAvatarIds");
    expect(source).toContain("markAvatarBroken");
    expect(source).toContain("onError={() => markAvatarBroken(p.id)}");
    expect(source).toContain("onError={() => markAvatarBroken(humanScenePreview.person.id)}");
    expect(source).not.toContain("p.photoUri ? <Image");
    expect(source).toContain("styles.avatarPhoto");
    // 真人头像右下 + 徽标走真实好友申请，点头像本身仍走 Scene。
    expect(source).toContain("handleHomeFriend(p.id, p.name)");
    expect(source).toContain("styles.addBadge");
    // HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）取代了 OVERRIDE-UNSplash-001。
    //
    // 旧的放宽是「没账号的人按 id 哈希落 unsplash 原型图，mock 期不许灰头像」。
    // 它有两个问题：① 前提是假的 —— 那 5 张里只有 1 张是人脸，另外 4 张是下龙湾
    // 风景 / 咖啡店室内 / 城市天际线 / 一盘炒河粉，正被当成「真人」的头像渲染；
    // ② 适用条件已经消失 —— rail 上 28 个人现在全部有服务端账号和写真资产。
    //
    // 新约定三条：① 头像只有一个来源：账号的媒体资产 thumb；② 不许再有 stock /
    // 外链占位图（拿风景照冒充人脸比灰头像更糟）；③ 缺图回落首字母
    //（HOME-AVATAR-FALLBACK-001 的 onError 分支）。
    expect(fixtures).not.toContain("images.unsplash.com");
    expect(fixtures).not.toContain("R34_HUMAN_PORTRAITS");
    expect(fixtures).not.toContain("portraitIndexForPerson");
    expect(fixtures).not.toContain("OVERRIDE-UNSplash-001");
    expect(fixtures).toContain("ACCOUNT_AVATAR_ASSET");
    expect(fixtures).toContain("/v1/media/thumb/");
    expect(fixtures).toContain("withAccountPortraits");
    // 账号表必须覆盖 fixture 里出现的每一个人。少一个 = rail 上出现一个「没有账号
    // 的真人」：卡片顶着「真人」徽标，点 + 却只会说「还没有账号」。
    const tableKeys = [...fixtures.matchAll(/^\s{2}(u_[a-z_]+): "ma_creator_/gm)].map((m) => m[1]);
    const railIds = [...fixtures.matchAll(/id: "(u_[a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(tableKeys).size).toBe(28);
    expect([...new Set(railIds)].sort()).toEqual([...new Set(tableKeys)].sort());
  });

  it("keeps the linked human Scene preview connected to friendship, profile and messaging workflows", () => {
    expect(source).toContain("handleHomeFriend(humanScenePreview.person.id");
    expect(source).toContain('t("adding")');
    expect(source).toContain('accessibilityLabel={t("viewProfile")}');
    expect(source).toContain('accessibilityLabel={t("messageAction")}');
    expect(source).toContain("onOpenHumanProfile?.(person)");
    expect(source).toContain("onMessageHuman?.(person)");
    expect(source).toContain("person.availabilityText");
    expect(source).toContain("person.rating");
    expect(source).toContain("person.completedActivities");
    expect(source).toContain('t("currentTheme")');
    expect(source).toContain('t("canGoTogether")');
    expect(source).toContain("previewSceneOptions.map");
    expect(fixtures).toContain("availabilityText");
    expect(source).toContain('style={styles.humanScenePage}');
    expect(source).toContain('style={styles.humanSceneActionsTop}');
    expect(source).toContain('t("whatSheCanDo")');
    expect(source).toContain('t("reputation")');
    expect(source).not.toContain("位共同好友");
    expect(fixtures).not.toContain('{ id: "mutual", label: "共同好友" }');
    expect(fixtures).toContain('sceneNames: person.id === "u_linh"');
    expect(source).toContain('accessibilityLabel={t("backHome")}');
    expect(source).toContain("safeArea.top");
    expect(source).toContain('accessibilityLabel={t("viewPublicHistory")}');
    expect(source).toContain("publicActivityHistory?.length");
    expect(source).toContain('t("privateHidden")');
  });

  it("reuses the approved Scene action logo registry in the compact Home action rail", () => {
    expect(source).toContain("SCENE_ACTIONS.find");
    expect(source).toContain('modeId === "PHOTO" ? "photo"');
    expect(source).toContain('modeId === "COMPANION" ? "city-walk"');
    expect(source).not.toContain('modeId === "PHOTO" ? "camera"');
  });

  it("keeps the AI profile entry off home and alive from the scene map", () => {
    // SCENE-HOME-HOT-RAIL-001（2026-09-27）：AI 推荐卡整体下架后，首页不再
    // 有任何 AI 目录入口（ prop 也不许残留半截声明）。AI 档案的写入方只剩
    // 场景地图那条链（shell 的 onOpenAIProfile 回调）。
    expect(source).not.toContain("onOpenAIProfile?.(");
    expect(source).not.toContain("onMessageAI?.(");
    expect(shell).toContain('onOpenAIProfile={(account) =>');
    // AI-FRIEND-DEAD-PENDING-001 的结论保持有效：AI 走完整对话链，不造
    // 永远 PENDING 的好友申请记录。那条链现在从场景地图 / AI 档案进，
    // 不再从首页卡片进。
    expect(source).not.toContain("AI-FRIEND-DEAD-PENDING-001");
    expect(source).not.toContain('testID="ai-scene-preview"');
    expect(source).not.toContain("setSelectedAIAccount");
    // 真人关系链不受影响：同一套好友 API、成功回执走 i18n 键。
    expect(source).toContain("relationship.sendFriendRequest(key)");
    expect(source).toContain("relationship.acceptFriendRequest(key)");
    expect(source).toContain("relationship.listMyFriendships()");
    expect(source).toContain('t("friendRequestSent"');
    expect(source).not.toContain("engagement.followProfile");
    expect(scene).toContain('testID="human-scene-binding"');
    expect(scene).toContain("onOpenHumanProfile?.(featuredHuman)");
    expect(scene).toContain("尚未代表本人到场或接受邀请");
    expect(shell).toContain("setRealitySceneSelection(sceneId)");
  });

  it("lets the recommend filter sheet open as a real modal and drops the dead counter", () => {
    // 筛选曾经是 ScrollView 内的 absolute 定位，打开后落在屏外点不了。
    expect(source).toContain("visible={filterSheetOpen}");
    expect(source).not.toContain("继续刷");
    expect(source).not.toContain("styles.loadMoreRow");
  });

  it("gives the 4-grid composer its own For You theme header", () => {
    const forYou = source.indexOf('t("combo")');
    expect(forYou).toBeGreaterThan(-1);
    expect(source).toContain("For You");
    // 主题头在 4 宫格之前，真人在 AI 之前的大顺序不变。
    expect(forYou).toBeLessThan(source.indexOf("styles.grid4"));
  });

  it("uses the four-grid center diamond to remix the whole selection", () => {
    expect(source).toContain('accessibilityLabel={t("changeAllLabel")}');
    expect(source).toContain("onPress={remixAll}");
    // HOME-FORYOU-POOL-001（2026-09-26）：这里原来钉的是四个轴各 `(current + 1) % len`
    // —— 固定序列轮转。用户明确要求「随机根据用户的 location 推荐可用资源组合池」，
    // 所以改成真随机重掷；钉跟着改口径（不是把钉删掉，旧口径走下面的反向臂）。
    expect(source).toContain("setPersonIndex(Math.floor(Math.random() * filteredPeople.length))");
    // HOME-FORYOU-REFRESH-001（2026-09-29，用户「点击圆圈就是刷新全部可用插槽」）：
    // 活动轴不再在本地旧列表上全量随机 —— 先重新拉活动，再只在可用插槽里换
    //（有名额、我没下过单、和锁定的地点/时间不冲突，优先换一个不同的，
    // for-you-slots.ts 有行为测试）。时间 / 地点跟着选中的活动对齐。
    expect(source).toContain("function remixForYou(): void {\n    void refreshAvailableSlots();\n  }");
    expect(source).toContain("fresh = (await activities.listActivities()).map(toStoreActivityBrief);");
    expect(source).toContain("const pick = pickRefreshedActivity(");
    // 反向臂：在未过滤的全量列表上随机抽活动 = 会抽到已满 / 已下单 / 与锁冲突的活动。
    expect(source).not.toContain("setActivityIndex(Math.floor(Math.random() * sceneActivities.length))");
    expect(source).not.toContain("setTimeIndex(Math.floor(Math.random() * distinctTimes.length))");
    expect(source).not.toContain("setPlaceIndex(Math.floor(Math.random() * sceneBriefs.length))");
    // 反向臂：固定轮转不许再回来（它的序列可预测，和「随机」直接矛盾）。
    expect(source).not.toContain("(current + 1) % filteredPeople.length");
    expect(source).not.toContain("(current + 1) % sceneBriefs.length");
    expect(source).toContain("borderWidth: 2");
  });

  it("HOME-FORYOU-POOL-001：四宫格配出的组合必须成立（活动决定场地和时间）", () => {
    // 用户：「这属于 n*n 维度覆盖…推荐**可用**资源组合池」。
    // 原实现 place / time 是另外两条独立轴各自取模，于是能配出两种不可能的组合：
    // ① 活动不在那个场地办；② 时间不是那场活动的时间。现在活动是主轴。
    expect(source).toContain("sceneIdOfActivity");
    expect(source).toContain("const gridActivitySceneId = gridActivity ? sceneIdOfActivity(gridActivity, sceneBriefs) : undefined;");
    expect(source).toContain("const gridTime = gridActivity?.time ||");
    // 反向臂：time 那条独立取模不许回来（它就是「时间不是那场活动的时间」的来源）。
    expect(source).not.toContain("const gridTime = distinctTimes.length > 0 ? distinctTimes[timeIndex % distinctTimes.length] : undefined;");
  });

  it("HOME-FORYOU-POOL-001：首屏随机起手，不再所有人都看到第 0 组", () => {
    // 四个 index 原来全 `useState(0)` ⇒ 所有人首屏组合一模一样。
    expect(source).toContain("const [forYouSeed] = useState(() => Math.floor(Math.random() * 0x7fffffff) + 1);");
    expect(source).toContain("useState(() => forYouSeed)");
    expect(source).not.toContain("const [personIndex, setPersonIndex] = useState(0);");
    expect(source).not.toContain("const [placeIndex, setPlaceIndex] = useState(0);");
  });

  it("chooses people from a horizontal photo rail instead of a name-only list", () => {
    expect(source).toContain("styles.personChooserRail");
    expect(source).toContain("styles.personChooserPhoto");
    expect(source).toContain("<HorizontalSwipeRail contentContainerStyle={styles.personChooserRail}>");
    expect(source).toContain("p.photoUri");
    expect(source).toContain("p.bio");
  });

  it("chooses activities and places from photo rails and time from horizontal cards", () => {
    expect(source).toContain("styles.photoChooserRail");
    expect(source).toContain("a.coverImageUrl || scene?.imageUrl");
    expect(source).toContain("styles.photoChooserImage");
    expect(source).toContain("styles.timeChooserRail");
    expect(source).toContain("styles.timeChooserCard");
    expect(source).not.toContain("styles.chooserItem");
    expect(source).toContain("<HorizontalSwipeRail contentContainerStyle={styles.photoChooserRail}>");
    expect(source).toContain("<HorizontalSwipeRail contentContainerStyle={styles.timeChooserRail}>");
  });

  it("hard-disables root page swiping for the whole chooser lifetime", () => {
    expect(source).toContain("onChooserVisibilityChange?.(chooser !== null)");
    expect(source).toContain("onChooserVisibilityChange?.(false)");
    expect(shell).toContain("if (rootSwipeBlockedRef.current) return false");
    expect(shell).toContain("const canSwipeRoot = !rootSwipeBlockedRef.current");
    expect(shell).toContain("onChooserVisibilityChange={setRootSwipeBlocked}");
  });

  it("keeps relationship and messaging actions inside the profile", () => {
    expect(profile).toContain("toggleFollow()");
    expect(profile).toContain("onMessage(account)");
    expect(shell).toContain('setPageOverride("MSG_CHAT")');
    expect(shell).toContain("<OtherProfileSurface");
    expect(shell).toContain("avatarUri: person.photoUri");
  });

  it("names the two order chains honestly: join is join, publish-demand is the other chain", () => {
    // 4 宫格按钮曾经挂"邀请 →"实际调 join（自己报名）。名实不符已修正：报名
    // 就是报名。2026-09-27（commander，原型 548d6b「可换可锁」）：格下三个
    // 入口收成一个 —— 只留报名这条和原型「选择 → 确认支付」对应的交易链；
    // 出图 / 发布需求从四宫格摘除（发布需求在附近场景区仍有入口）。
    expect(source).toContain('t("joinCta")');
    expect(source).toContain("joinSelected(gridActivity?.activityId)");
    expect(source).toContain('t("chainHint")');
    expect(source).not.toContain('"邀请 →"');
    expect(source).not.toContain("inviteSelected");
    // 四宫格只挂一颗 CTA：旧的半宽行（出图/发布需求）不许回来。
    expect(source).not.toContain("styles.gridCtaHalf");
    expect(source).not.toContain('t("publishDemand")');
    expect(source).not.toContain("setMomentOpen(true)");
    // SEARCH-REPLY-BUDGET-001：搜索回复条撑大就把 For You 的「选择」CTA 顶
    // 到玻璃 dock 后面、点不动（2026-09-28 模拟器实测）。两侧共同预算 ~30pt：
    // - responseBar 不能用回 minHeight 32 / paddingVertical 7（会撑成 46pt）
    // - gridCtaFlush 必须配合 responseText 一起收掉 CTA 上边距
    expect(searchDock).toContain("paddingVertical: 4");
    expect(searchDock).not.toContain("minHeight: 32");
    expect(source).toContain("responseText && styles.gridCtaFlush");
  });

  // HOME-FORYOU-LOCK-001（原型 deepseek_html_20260927_548d6b「可换可锁」）：
  // 每格右上角锁钮（锁态金底深字）+ 锁定格子金框 + 锁状态提示行；remix 与
  // chooser 都必须尊重锁 —— 锁定的轴不重掷、锁定的格子拒开选择器。
  it("HOME-FORYOU-LOCK-001: locks a For You slot against both the remix and the chooser", () => {
    expect(source).toContain("lockedSlots");
    expect(source).toContain("function toggleSlotLock");
    // remix 跳过锁定的轴（remixForYou 与中心键同一条链）。
    expect(source).toContain('!lockedSlots.has("person") && filteredPeople.length > 1');
    // HOME-FORYOU-REFRESH-001：锁定的活动原样保留（仍可用时），锁定的地点 / 时间作为
    // 筛选条件交给 pickRefreshedActivity，没锁的时间 / 地点才跟着活动对齐。
    expect(source).toContain('{ activityId: lockedSlots.has("activity") ? current?.activityId : undefined, placeSceneId: lockedPlace?.id, time: lockedTime }');
    expect(source).toContain('if (!lockedSlots.has("time")) {');
    expect(source).toContain('if (!lockedSlots.has("place")) {');
    // 锁定的格子拒开 chooser（点格子与搜索换项同一口径）。
    expect(source).toContain('if (lockedSlots.has(tile.slot)) { showResponse(t("lockedBlock"), t("lockedBlockSub")); return; }');
    expect(source).toContain("if (lockedSlots.has(slot)) {");
    // 锁状态提示行 + 锁钮/金框样式存在。
    expect(source).toContain('t("lockedHint", { n: lockedSlots.size })');
    expect(source).toContain("gridTileLocked: { borderColor: \"#F5B400\", borderWidth: 2.5 }");
    // FORYOU-LOCK-A-001（2026-09-28，原型 c004b0 方案A「玻璃质感」）：28px 圆角 9，
    // 半透明黑底 + 白描边；锁定金底 + 白描边 + 金光晕。锁形开合区分见下不断言。
    expect(source).toContain('gridLock: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.42)", borderColor: "rgba(255,255,255,0.15)", borderRadius: 9');
    expect(source).toContain('gridLockOn: { backgroundColor: "#F5B400", borderColor: "rgba(255,255,255,0.3)"');
    expect(source).toContain('shadowColor: "#F5B400"');
    // 锁钮必须是格子外壳（View）的**兄弟**，不许嵌回 Pressable 里 —— 嵌套时
    // 外层吞触摸，锁永远切不动（2026-09-27 用户实测踩坑）。
    expect(source).toContain("<View key={tile.key} style={[styles.gridTile");
    expect(source).not.toContain("<Pressable key={tile.key}");
    // 开锁 / 关锁图形必须有差别：锁环抬起悬空（off）vs 腿压进锁体（on）。
    // FORYOU-LOCK-A-001：锁体是空心描边（transparent 底 + 白边），不是实心块。
    expect(source).toContain("gridLockShackleOff: { marginBottom: 1.5, transform: [{ translateX: 1.5 }] }");
    expect(source).toContain('gridLockBody: { backgroundColor: "transparent", borderColor: color.white');
    expect(source).toContain('lockedSlots.has(tile.slot) ? styles.gridLockShackleOn : styles.gridLockShackleOff');
  });

  it("reports join failures by cause instead of blaming login", () => {
    // 登录着点报名失败，曾一律报"登录后重试"。现在按服务端错误码说人话。
    expect(source).toContain("joinErrorMessage");
    expect(source).toContain("ACTIVITY_ALREADY_JOINED");
    expect(source).toContain('t("joinAlready")');
    expect(source).toContain("ACTIVITY_FULL");
    expect(source).toContain("ACTIVITY_NOT_FOUND");
    expect(source).not.toContain("报名失败，登录后重试");
  });

  it("keeps coordinates in the location data layer, not beside the address UI", () => {
    expect(locationPicker).toContain('label="地图选点"');
    expect(locationPicker).not.toMatch(/坐标 \$\{lat\.toFixed/);
    expect(locationPicker).not.toMatch(/\(\{eLat\.toFixed/);
    expect(locationPicker).not.toContain("自定义坐标</Text>");
    expect(shell).toContain("地图选点 · 覆盖范围");
    expect(shell).not.toMatch(/lat\.toFixed\(4\).*lng\.toFixed\(4\)/);
    expect(mapCanvas).not.toContain("当前 grid 坐标");
  });

  it("MSG-LOCATION-DUPE-001: the location entry lives only on home, not on messages", () => {
    // 顶栏本地范围入口（城市 + 切换 + 地图）曾在 HOME 与 MESSAGES 各挂一份。
    // 消息页不需要地址入口 —— Home 留一个，重复即红。
    expect(shell).toContain("MSG-LOCATION-DUPE-001");
    expect(shell).toContain('{isNavVisible && tab === "HOME" ? (');
    expect(shell).not.toContain('(tab === "HOME" || tab === "MESSAGES")');
    expect(shell).toContain("<LocationContext");
    expect(shell).toContain("<LocationPickerSheet");
  });

  it("HOME-PEOPLE-SEARCH-001: home person search reaches the server user table", () => {
    // 本地 people 索引只是推荐预览——新注册用户搜名字永远搜不到，只能走
    // ProfileClient.searchProfiles。断线三处任一即红：触发判定、调用、透传。
    expect(source).toContain("shouldSearchServerPeople");
    expect(source).toContain("profileClient.searchProfiles");
    expect(source).toContain("全站真人");
    expect(source).toContain("profileWireToPerson");
    expect(source).toContain("onOpenHumanProfile?.(profileWireToPerson(person))");
    // 壳必须把 client 透传给首页（与 Feed/Market/Me 同 pattern），否则
    // shouldSearchServerPeople 永远收到 hasClient=false。
    const homeUse = shell.indexOf("<RequesterHome");
    expect(homeUse).toBeGreaterThan(-1);
    const profilePass = shell.indexOf("profileClient={profile}", homeUse);
    expect(profilePass).toBeGreaterThan(homeUse);
    expect(profilePass).toBeLessThan(shell.indexOf("onOpenHumanProfile={(person) => setOpenHumanProfile", homeUse));
    // 旧谎言不许回来：注释曾明写"不是全站用户，这里还没接"。
    expect(source).not.toContain("这里还没接");
  });

  it("DEVICE-LOCATION-002: the follow toggle survives restarts", () => {
    // 开关曾只活内存、手动地点存在 keychain —— 每次冷启动恢复流程都把开关
    // 打回 false，用户点了"开启"杀掉重进就回去。不断线三处任一即红：
    // 恢复读开关、开关透传落盘、手动选择落盘关闭。
    expect(shell).toContain("loadFollowDevice");
    expect(shell).toContain("saveFollowDevice");
    expect(shell).toContain("storedFollow !== undefined");
    expect(shell).toContain("saveFollowDevice(next)");
    expect(shell).toContain("saveFollowDevice(false)");
  });
});

// HOME-FORYOU-ORDER-003（2026-09-28，原型 docs/design/references/
// Proxy_MyTickets_20260928_d7fef9.html「我的票券」）：确认下单之后那一屏。
// 用户原话是"接着做完，记得增加订单编号"。
describe("HOME-FORYOU-ORDER-003 确认下单之后那一屏", () => {
  it("两步共用一个 Modal —— 不许写成两个兄弟 Modal", () => {
    // 报名成功那一批 state 里"关 A + 开 B"落在**同一次提交**，iOS 在 A 还在
    // dismiss 的时候会丢掉 B 的 present：点了确认下单什么都不出现、也不报错。
    // 仓库的规矩写在 surfaces/badminton-companion.tsx 文件头第 1 条
    //（整页只有一个 Modal，内部换屏只切 state），HOME-MORE-SHEET-004 踩过。
    const flow = source.indexOf("visible={joinConfirmOpen}");
    const chooser = source.indexOf('<Modal transparent animationType="fade"');
    expect(flow).toBeGreaterThan(-1);
    expect(chooser).toBeGreaterThan(flow);
    // 从这一屏自己的 <Modal 开标签量起 —— `visible={...}` 在 `<Modal` **后面**，
    // 从 flow 起量会漏掉它自己那颗开标签，钉就永远数不到东西（数到 0）。
    const flowTag = source.lastIndexOf("<Modal", flow);
    expect(flowTag).toBeGreaterThan(-1);
    const between = source.slice(flowTag, chooser);
    expect((between.match(/<Modal[\s>]/g) ?? [])).toHaveLength(1);
    expect(between).toContain("styles.orderTicket");
    expect(source).not.toContain("setOrderSheetOpen");
  });

  it("订单编号读真实标识，不编一个假号", () => {
    // HOME-FORYOU-ORDER-005（2026-09-29，用户「for you 的新订单编号没有用上」）：
    // JoinActivity 现在回这笔报名**自己的**全数字订单编号（participation.orderNo，
    // 与履约订单共用一个分配器）；之前下过单时服务端在 ACTIVITY_ALREADY_JOINED 里
    // 回传既有编号。以前这里显示的是活动展示码 PX-A-…——同一场活动所有人同一个
    // 号，那不是订单编号。拿不到编号（老服务端）就显示「—」，不拿活动码冒充。
    expect(source).toContain('<Text selectable style={styles.orderCodeText}>{placedOrderNo ?? "—"}</Text>');
    expect(source).toContain("setPlacedOrderNo(result.participation?.orderNo);");
    expect(source).toContain("setPlacedOrderNo(orderNoFromJoinRejection(e));");
    // 反向臂：活动展示码 / 活动 id 不许再当订单编号显示或复制。
    expect(source).not.toContain("gridActivity?.code || gridActivity?.activityId");
    expect(source).not.toContain("TK-");
    expect(source).toContain("订单编号 · 点击复制");
    expect(source).toContain("订单编号已复制");
  });

  it("原型里没有真能力的三样不许写进来（二维码 / 推送 / 日历）", () => {
    // CheckinActivity 只是个普通命令、不认码；仓库里没有 expo-notifications、
    // 没有 expo-calendar；activity.time 是活动自己写的自由文本、不是可解析的
    // 时间戳，编不出真倒计时也编不出真日历事件。写出来都是兑现不了的承诺
    //（placeholder-honest-actions 禁的就是这个）。
    // ⚠️ 这三条是**反向钉**，所以本文件里也不许出现这三句原话。
    expect(source).not.toContain("到场出示此票");
    expect(source).not.toContain("推送提醒");
    expect(source).not.toContain(">加入日历<");
  });

  it("撕票线的冲孔必须和页面底色同色，否则孔会变成两个白点", () => {
    // 孔是画在票券卡**里面**的实心圆，靠卡的 overflow:"hidden" 把外半圆裁掉
    // 才成为一道缺口。底色和孔色读同一个 token —— 改一个不改另一个就露馅。
    const pageBg = /orderPage: \{ backgroundColor: (\S+?),/.exec(source)?.[1] ?? "";
    const holeBg = /orderTearHole: \{ backgroundColor: (\S+?),/.exec(source)?.[1] ?? "";
    expect(pageBg).not.toBe("");
    expect(holeBg).toBe(pageBg);
    expect(source).toContain('borderRadius: 18, borderWidth: 1, marginTop: -14, overflow: "hidden" }');
    // 虚线**不能**用 dashed 边框画：RN(iOS) 只支持四边等宽的 dashed，单边
    //（borderTopWidth / borderBottomWidth）会打 "Unsupported dashed / dotted
    // border style" 并且**整条不画** —— 2026-09-28 模拟器像素级实测：撕票线和
    // meta 分隔线一起消失，那两段里一个非白像素都没有（第一版就是这么写的）。
    // 现在虚线是一排小方块（DashedRule）。这个文件里没有任何等宽 dashed 框，
    // 所以一旦出现 dashed 边框字面量，就是那条画不出来的单边虚线回来了。
    expect(source).toContain('<DashedRule ruleColor={color.line} style={styles.orderTearLine} />');
    expect(source).toContain('orderMetaRowRule: { bottom: 0, left: 0, position: "absolute", right: 0 }');
    expect((source.match(/style=\{styles\.orderMetaRowRule\}/g) ?? [])).toHaveLength(3);
    expect(source).not.toContain('borderStyle: "dashed"');
  });
});

describe("HOME-FORYOU-ORDER-004 确认下单总有下一步", () => {
  it("already-joined still opens the 已下单 page, honestly labelled as an existing order", () => {
    // HOME-FORYOU-ORDER-005：之前下过的单也要把**既有编号**带到票券页。
    expect(source).toMatch(/errorCode === "ACTIVITY_ALREADY_JOINED"\) \{\s+setPlacedOrderNo\(orderNoFromJoinRejection\(e\)\);\s+return "already";/);
    expect(source).toContain('if (outcome !== "failed") { setOrderExisting(outcome === "already"); setOrderCodeCopied(false); setOrderDone(true); }');
    expect(source).toContain('orderExisting ? "你之前已经下过这一单"');
  });
  it("real failures render above the footer, not buried at the bottom of the scroll", () => {
    expect(source).toContain('</ScrollView>\n                          {joinMsg && joinConfirmOpen ? <Text selectable style={styles.confirmJoinError}>{joinMsg}</Text> : null}');
  });
});
