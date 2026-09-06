import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");
const profile = readFileSync(fileURLToPath(new URL("./surfaces/ai-account-profile.tsx", import.meta.url)), "utf8");
const shell = readFileSync(fileURLToPath(new URL("./shell/app-shell.tsx", import.meta.url)), "utf8");

describe("UI-HOME-DISCOVERY-001 requester home baseline", () => {
  it("keeps the labeled human section before the labeled AI section", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    expect(human).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain(">真人<");
    expect(source).toContain(">AI 生成<");
  });

  it("keeps human discovery as circle-and-name nodes with details revealed only after selection", () => {
    expect(source).toContain('setSelectedPersonId((current) => current === p.id ? undefined : p.id)');
    expect(source).toContain('testID="human-node-reveal"');
    expect(source).toContain("可用状态");
    expect(source).toContain("Scene Fit");
    expect(source).toContain("匹配理由");
    expect(source).not.toContain("styles.recCard");
    expect(source).not.toContain("styles.storyHint");
  });

  it("keeps AI discovery as plain circular profile links", () => {
    expect(source).toMatch(/aiCard:\s*\{\s*alignItems:\s*"center",\s*width:\s*104\s*\}/);
    expect(source).toMatch(/aiAvatar:\s*\{[^}]*borderRadius:\s*999[^}]*height:\s*88[^}]*width:\s*88/);
    expect(source).not.toMatch(/aiCard:\s*\{[^}]*(backgroundColor|borderRadius|borderWidth|shadow)/);
    expect(source).toContain("onPress={() => onOpenAIProfile?.(account)}");
    expect(source).not.toContain("toggleAIFollow(account.accountId)");
    expect(source).not.toContain("onMessageAI?.(account)");
  });

  it("keeps relationship and messaging actions inside the profile", () => {
    expect(profile).toContain("toggleFollow()");
    expect(profile).toContain("onMessage(account)");
    expect(shell).toContain('setPageOverride("MSG_CHAT")');
  });
});
