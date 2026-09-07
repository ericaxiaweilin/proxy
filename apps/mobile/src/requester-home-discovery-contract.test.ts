import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");
const profile = readFileSync(fileURLToPath(new URL("./surfaces/ai-account-profile.tsx", import.meta.url)), "utf8");
const shell = readFileSync(fileURLToPath(new URL("./shell/app-shell.tsx", import.meta.url)), "utf8");
const fixtures = readFileSync(fileURLToPath(new URL("./recommend-fixtures.ts", import.meta.url)), "utf8");

describe("UI-HOME-DISCOVERY-001 requester home baseline", () => {
  it("keeps the labeled human section before the labeled AI section", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    expect(human).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain(">真人<");
    expect(source).toContain(">AI 生成<");
  });

  it("keeps human discovery as circle-and-name nodes that open the full profile", () => {
    expect(source).toContain("onPress={() => onOpenHumanProfile?.(p)}");
    expect(source).not.toContain('testID="human-node-reveal"');
    expect(source).not.toContain("styles.recCard");
    expect(source).not.toContain("styles.storyHint");
    expect(source).toContain("p.photoUri ? <Image");
    expect(source).toContain("styles.avatarPhoto");
    expect(fixtures).toContain("R34_HUMAN_PORTRAITS");
    expect(fixtures).toContain("withR34Portraits");
  });

  it("keeps AI discovery circular but preserves Scene context before profile navigation", () => {
    expect(source).toMatch(/aiCard:\s*\{\s*alignItems:\s*"center",\s*width:\s*104\s*\}/);
    expect(source).toMatch(/aiAvatar:\s*\{[^}]*borderRadius:\s*999[^}]*height:\s*88[^}]*width:\s*88/);
    expect(source).not.toMatch(/aiCard:\s*\{[^}]*(backgroundColor|borderRadius|borderWidth|shadow)/);
    expect(source).toContain('testID="ai-scene-preview"');
    expect(source).toContain("setSelectedAIAccount");
    expect(source).toContain("onOpenAIProfile?.(selectedAIAccount)");
    expect(source).not.toContain("onPress={() => onOpenAIProfile?.(account)}");
    expect(source).not.toContain("toggleAIFollow(account.accountId)");
    expect(source).not.toContain("onMessageAI?.(account)");
    expect(source).toContain("不接单、不报名活动");
  });

  it("keeps relationship and messaging actions inside the profile", () => {
    expect(profile).toContain("toggleFollow()");
    expect(profile).toContain("onMessage(account)");
    expect(shell).toContain('setPageOverride("MSG_CHAT")');
    expect(shell).toContain("<OtherProfileSurface");
    expect(shell).toContain("avatarUri: person.photoUri");
  });
});
