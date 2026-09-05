import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

describe("UI-HOME-DISCOVERY-001 requester home baseline", () => {
  it("keeps the labeled human section before the labeled AI section", () => {
    const human = source.indexOf(">真人推荐<");
    const ai = source.indexOf(">AI 推荐<");
    expect(human).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(human);
    expect(source).toContain(">真人<");
    expect(source).toContain(">AI 生成<");
  });

  it("keeps AI discovery as plain circular profile links", () => {
    expect(source).toMatch(/aiCard:\s*\{\s*alignItems:\s*"center",\s*width:\s*104\s*\}/);
    expect(source).toMatch(/aiAvatar:\s*\{[^}]*borderRadius:\s*999[^}]*height:\s*88[^}]*width:\s*88/);
    expect(source).not.toMatch(/aiCard:\s*\{[^}]*(backgroundColor|borderRadius|borderWidth|shadow)/);
    expect(source).toContain("onPress={() => onOpenAIProfile?.(account)}");
    expect(source).not.toContain("toggleAIFollow(account.accountId)");
    expect(source).not.toContain("onMessageAI?.(account)");
  });
});
