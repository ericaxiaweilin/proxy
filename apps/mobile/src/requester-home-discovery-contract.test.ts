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
    expect(source).not.toContain("toggleAIFollow(account.accountId)");
    expect(source).not.toContain("onMessageAI?.(account)");
    expect(scene).toContain('testID="human-scene-binding"');
    expect(scene).toContain("onOpenHumanProfile?.(featuredHuman)");
    expect(scene).toContain("尚未代表本人到场或接受邀请");
    expect(shell).toContain("setRealitySceneSelection(sceneId)");
  });

  it("keeps relationship and messaging actions inside the profile", () => {
    expect(profile).toContain("toggleFollow()");
    expect(profile).toContain("onMessage(account)");
    expect(shell).toContain('setPageOverride("MSG_CHAT")');
    expect(shell).toContain("<OtherProfileSurface");
    expect(shell).toContain("avatarUri: person.photoUri");
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
