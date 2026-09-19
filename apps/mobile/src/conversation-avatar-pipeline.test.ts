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
    expect(conversation).toContain("if (peerAvatarSource && !brokenPeerAvatar)");
  });

  it("renders real image sources in inbox rows and the conversation header", () => {
    expect(messages).toMatch(/d\.avatarSource && !brokenAvatarIds\.has\(d\.id\) \? <Image/);
    expect(conversation).toContain("aiAccount || peerAvatarSource");
  });

  it("broken avatar URLs fall back to initials instead of rendering blank", () => {
    // 幽灵 id 拼出来的 user_ thumb、不可见头像都会 404 —— expo Image 只会画
    // 空白，所以坏图必须回落首字母，行头像/联系人/对话窗三处都要有。
    expect(messages).toContain("markAvatarBroken");
    expect(messages).toContain("brokenAvatarIds.has(d.id)");
    expect(conversation).toContain("brokenPeerAvatar");
    expect(conversation).toContain("topAvatarFallback");
  });

  it("resolves server asset refs to thumb URLs and never fabricates user_ URLs", () => {
    // enrich 回来的 avatarPath 是裸 assets/<id>，直接当 URL 必 404 ——
    // resolveAvatarSource 统一转 thumb 真地址；认不出的不拼，直接首字母。
    expect(messages).toContain("resolveAvatarSource(avatarRef");
    expect(messages).toContain("/v1/media/thumb/${encodeURIComponent(assetId)}");
    expect(messages).not.toContain("user_\" + item.counterpartyId");
  });
});
