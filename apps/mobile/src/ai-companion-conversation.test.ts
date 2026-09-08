import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messages = readFileSync(new URL("./surfaces/messages.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./shell/app-shell.tsx", import.meta.url), "utf8");
const conversation = readFileSync(new URL("./surfaces/conversation.tsx", import.meta.url), "utf8");

describe("AI companion conversation identity", () => {
  it("restores the bundled persona when reopening an inbox conversation", () => {
    expect(messages).toContain("BUNDLED_AI_COMPANIONS.find");
    expect(messages).toContain("^ai_account_0*(\\d+)$");
    expect(messages).toContain("aiAccount?.displayName || snapshotName");
    expect(messages).toContain("d.aiAccount");
    expect(shell).toContain("conversationId, aiAccount");
  });

  it("uses the companion's real profile photo asset when requested", () => {
    expect(conversation).toContain("aiAccountPhoto(aiAccount)");
    expect(conversation).toMatch(/照片\|自拍\|相片\|photo\|selfie/);
    expect(conversation).toContain("这是我现在的主页照片。");
  });
});
