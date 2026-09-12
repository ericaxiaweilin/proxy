import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messages = readFileSync(new URL("./surfaces/messages.tsx", import.meta.url), "utf8");
const conversation = readFileSync(new URL("./surfaces/conversation.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./shell/app-shell.tsx", import.meta.url), "utf8");

describe("conversation avatar pipeline", () => {
  it("hydrates human avatars and passes them through every conversation layer", () => {
    expect(messages).toContain("profileClient.getProfile(item.counterpartyId)");
    expect(messages).toContain("counterpartySnapshot?.avatarRef");
    expect(messages).toContain("d.avatarSource");
    expect(shell).toContain("peerAvatarSource: messageChat.avatarSource");
    expect(conversation).toContain("if (peerAvatarSource)");
  });

  it("renders real image sources in inbox rows and the conversation header", () => {
    expect(messages).toMatch(/d\.avatarSource \? <Image/);
    expect(conversation).toContain("aiAccount || peerAvatarSource");
  });
});
