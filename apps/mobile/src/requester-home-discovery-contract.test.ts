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
    expect(dockUse).toBeLessThan(source.indexOf(">真人推荐<"));
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
  it("keeps the labeled human section before the labeled AI section", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    expect(human).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain(">真人<");
    expect(source).toContain(">AI 生成<");
  });

  // AI-ROW-DUPE-001: 首页曾经同时渲染两条 AI 行 —— 上面一条「小美们」
  // (AIAssistantsRow)、下面一条「AI 推荐」，两者都来自同一个服务端目录
  // /v1/ai/assistants，视觉上是两条一模一样的 AI 生成横滑行。用户看到的是
  // "两行一样的 AI 生成"。删掉上面那条，只留「AI 推荐」。
  it("renders exactly one AI row on home instead of two identical AI rows", () => {
    expect(source).not.toMatch(/<AIAssistantsRow[\s/>]/);
    expect(source).not.toContain('from "../ai-assistants-row"');
    expect(source).not.toContain("小美们");
    expect((source.match(/>AI 推荐</g) ?? [])).toHaveLength(1);
    expect((source.match(/styles\.aiRail\b/g) ?? [])).toHaveLength(1);
    expect((source.match(/styles\.aiSection\b/g) ?? [])).toHaveLength(1);
    // 「AI 生成」只作为徽标 / 卡片副标题出现，不再是一条独立行的标题。
    expect((source.match(/>AI 生成</g) ?? [])).toHaveLength(2);
    expect(source).toContain("<Text style={styles.aiTitle}>AI 推荐</Text>");
    expect(source).toContain("styles.aiBadgeText}>AI 生成");
    expect(source).toContain("styles.aiHandle}");
  });

  it("keeps matchmaking above nearby scenes because Scene is a meeting tool, not inventory", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    const composition = source.indexOf(">为你组合<");
    const activeWork = source.indexOf(">继续进行<");
    const sceneInspiration = source.indexOf(">附近场景<");
    expect(sceneInspiration).toBeGreaterThan(activeWork);
    expect(activeWork).toBeGreaterThan(composition);
    expect(composition).toBeGreaterThan(ai);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain("打开附近场景地图");
    expect((source.match(/<SceneActivityDiscovery/g) ?? [])).toHaveLength(1);
  });

  it("keeps human discovery as circle-and-name nodes that preserve the real Scene context", () => {
    expect(source).toContain("setHumanScenePreview({ person: p, sceneId: recommendFeed.boundSceneId })");
    expect(source).toContain('accessibilityLabel="查看完整场景"');
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
    // IDENTITY-ID-001: 头像不再是客户端自带的原型肖像（按下标轮转，与身份无关），
    // 而是按 id 取账号的媒体资产 —— 同一个人在任何页面都是同一张图。
    expect(fixtures).not.toContain("R34_HUMAN_PORTRAITS");
    expect(fixtures).not.toContain("images.unsplash.com");
    expect(fixtures).toContain("ACCOUNT_AVATAR_ASSET");
    expect(fixtures).toContain("/v1/media/thumb/");
    expect(fixtures).toContain("withR34Portraits");
  });

  it("keeps the linked human Scene preview connected to friendship, profile and messaging workflows", () => {
    expect(source).toContain("handleHomeFriend(humanScenePreview.person.id");
    expect(source).toContain('"添加中"');
    expect(source).toContain('accessibilityLabel="查看主页"');
    expect(source).toContain('accessibilityLabel="发消息"');
    expect(source).toContain("onOpenHumanProfile?.(person)");
    expect(source).toContain("onMessageHuman?.(person)");
    expect(source).toContain("person.availabilityText");
    expect(source).toContain("person.rating");
    expect(source).toContain("person.completedActivities");
    expect(source).toContain(">当前主题<");
    expect(source).toContain(">当前可一起去<");
    expect(source).toContain("previewSceneOptions.map");
    expect(fixtures).toContain("availabilityText");
    expect(source).toContain('style={styles.humanScenePage}');
    expect(source).toContain('style={styles.humanSceneActionsTop}');
    expect(source).toContain(">她可以做什么<");
    expect(source).toContain(">历史信誉与评价<");
    expect(source).not.toContain("位共同好友");
    expect(fixtures).not.toContain('{ id: "mutual", label: "共同好友" }');
    expect(fixtures).toContain('sceneNames: person.id === "u_linh"');
    expect(source).toContain('accessibilityLabel="返回Home"');
    expect(source).toContain("safeArea.top");
    expect(source).toContain('accessibilityLabel="查看公开历史活动"');
    expect(source).toContain("publicActivityHistory?.length");
    expect(source).toContain("非公开记录不展示");
  });

  it("reuses the approved Scene action logo registry in the compact Home action rail", () => {
    expect(source).toContain("SCENE_ACTIONS.find");
    expect(source).toContain('modeId === "PHOTO" ? "photo"');
    expect(source).toContain('modeId === "COMPANION" ? "city-walk"');
    expect(source).not.toContain('modeId === "PHOTO" ? "camera"');
  });

  it("keeps AI discovery circular and opens the non-physical AI profile directly", () => {
    expect(source).toMatch(/aiCard:\s*\{\s*alignItems:\s*"center",\s*width:\s*104\s*\}/);
    expect(source).toMatch(/aiAvatar:\s*\{[^}]*borderRadius:\s*999[^}]*height:\s*88[^}]*width:\s*88/);
    expect(source).not.toMatch(/aiCard:\s*\{[^}]*(backgroundColor|borderRadius|borderWidth|shadow)/);
    expect(source).toContain("onPress={() => onOpenAIProfile?.(account)}");
    expect(source).not.toContain('testID="ai-scene-preview"');
    expect(source).not.toContain("setSelectedAIAccount");
    expect(source).not.toContain("onPress={() => onOpenAIScene?.(account)}");
    // Owner 决议：AI 也是可寻址账户，使用同一套好友关系；发消息仍从主页进入。
    expect(source).toContain("relationship.sendFriendRequest(id)");
    expect(source).toContain("relationship.acceptFriendRequest(id)");
    expect(source).toContain("relationship.listMyFriendships()");
    expect(source).toContain("好友申请已发送");
    expect(source).not.toContain("engagement.followProfile");
    expect(source).not.toContain("onMessageAI?.(account)");
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
    const forYou = source.indexOf("为你组合");
    expect(forYou).toBeGreaterThan(-1);
    expect(source).toContain("For You");
    // 主题头在 4 宫格之前，真人在 AI 之前的大顺序不变。
    expect(forYou).toBeLessThan(source.indexOf("styles.grid4"));
  });

  it("uses the four-grid center diamond to remix the whole selection", () => {
    expect(source).toContain('accessibilityLabel="整组换一组"');
    expect(source).toContain("onPress={remixAll}");
    expect(source).toContain("(current + 1) % filteredPeople.length");
    expect(source).toContain("(current + 1) % distinctTimes.length");
    expect(source).toContain("(current + 1) % storeActivities.length");
    expect(source).toContain("(current + 1) % sceneBriefs.length");
    expect(source).toContain("borderWidth: 2");
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
    // 4 宫格按钮曾经挂"邀请 →"实际调 join（自己报名）。名实不符已修正：
    // 报名就是报名，发布需求是另一条链路（进市场机会 Tab）。
    expect(source).toContain("报名 →");
    expect(source).toContain("joinSelected(gridActivity?.activityId)");
    expect(source).toContain("发布需求");
    expect(source).toContain('onOpenMarket?.("OPPORTUNITY")');
    expect(source).toContain("直接约她");
    expect(source).not.toContain('"邀请 →"');
    expect(source).not.toContain("inviteSelected");
  });

  it("reports join failures by cause instead of blaming login", () => {
    // 登录着点报名失败，曾一律报"登录后重试"。现在按服务端错误码说人话。
    expect(source).toContain("joinErrorMessage");
    expect(source).toContain("ACTIVITY_ALREADY_JOINED");
    expect(source).toContain("你已报过名");
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
