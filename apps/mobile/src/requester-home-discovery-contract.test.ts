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

describe("UI-HOME-DISCOVERY-001 requester home baseline", () => {
  it("puts the unified search and model conversation before discovery sections", () => {
    const intent = source.indexOf('accessibilityLabel="搜索或询问 Proxy"');
    expect(intent).toBeGreaterThan(-1);
    expect(intent).toBeLessThan(source.indexOf(">真人推荐<"));
    expect(source).toContain("搜索场景、地点，或问 Proxy");
  });
  it("keeps the labeled human section before the labeled AI section", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    expect(human).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain(">真人<");
    expect(source).toContain(">AI 生成<");
  });

  it("keeps human discovery as circle-and-name nodes that preserve the real Scene context", () => {
    expect(source).toContain("onPress={() => onOpenHumanScene?.(p, recommendFeed.boundSceneId)}");
    expect(source).not.toContain('testID="human-node-reveal"');
    expect(source).not.toContain("styles.recCard");
    expect(source).not.toContain("styles.storyHint");
    expect(source).toContain("p.photoUri ? <Image");
    expect(source).toContain("styles.avatarPhoto");
    // 真人头像右下 + 徽标一键加好友，点头像本身仍走 Scene（下一条不断言的路由不变）。
    expect(source).toContain("toggleHomeFollow(p.id, p.name)");
    expect(source).toContain("styles.addBadge");
    expect(fixtures).toContain("R34_HUMAN_PORTRAITS");
    expect(fixtures).toContain("withR34Portraits");
  });

  it("keeps AI discovery circular and opens the non-physical AI profile directly", () => {
    expect(source).toMatch(/aiCard:\s*\{\s*alignItems:\s*"center",\s*width:\s*104\s*\}/);
    expect(source).toMatch(/aiAvatar:\s*\{[^}]*borderRadius:\s*999[^}]*height:\s*88[^}]*width:\s*88/);
    expect(source).not.toMatch(/aiCard:\s*\{[^}]*(backgroundColor|borderRadius|borderWidth|shadow)/);
    expect(source).toContain("onPress={() => onOpenAIProfile?.(account)}");
    expect(source).not.toContain('testID="ai-scene-preview"');
    expect(source).not.toContain("setSelectedAIAccount");
    expect(source).not.toContain("onPress={() => onOpenAIScene?.(account)}");
    // Owner 决议：一键加好友可以在首页做（+ 徽标直调 follow），发消息仍只能进主页。
    expect(source).toContain("toggleHomeFollow");
    expect(source).toContain("engagement.followProfile");
    expect(source).toContain("加好友 ${");
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
});
