import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FEED-SHARE-TO-USER-001（2026-09-25，用户：「分享我看了 功能没做什么 需要
// 分享给平台的用户 弹出用户头像 没有做」）：分享以前只弹系统原生分享面板。
// 现在弹一个站内联系人列表（真实收件箱头像），选中直接发私信；系统原生
// 分享退居列表最后一行的"更多分享方式"，不砍掉这条已有能力。
const source = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");

describe("FEED-SHARE-TO-USER-001 the share icon opens a real contact picker", () => {
  it("no longer fires the system share sheet directly from the row icon", () => {
    expect(source).toContain('onPress={() => openSharePanel(post)}');
    expect(source).not.toContain('onPress={() => void Share.share({ message: `${post.body}');
  });

  it("candidates are the real inbox (same honest source as group-create), not a fabricated list", () => {
    expect(source).toContain("conversationClient.listConversations()");
    expect(source).toContain("dedupeInboxDialogs(items)");
  });

  it("excludes AI accounts, the assistant, and groups — DM to a real human only", () => {
    expect(source).toContain('item.conversation.conversationType === "DM"');
    expect(source).toContain('item.counterpartyId !== "proxy_ai"');
    expect(source).toContain('item.counterpartyId !== "user_proxy_ai"');
    expect(source).toContain("!/^ai_account_/.test(item.counterpartyId)");
  });

  it("never shows a raw counterpartyId as the contact's name (NO-RAW-ID-001)", () => {
    expect(source).toContain('item.counterpartySnapshot?.displayName?.trim() || "用户"');
  });
});

describe("FEED-SHARE-TO-USER-001 picking a contact sends a real DM, no confirmation screen", () => {
  it("delivers via the existing conversation command with originType POST (no new backend needed)", () => {
    expect(source).toContain('originType: "POST"');
    expect(source).toContain("originId: post.postId");
    expect(source).toContain('conversationType: "DM"');
    expect(source).toContain("conversationClient.startConversation(");
  });

  it("is single-select and disables the row it already sent to, not the whole list forever", () => {
    expect(source).toContain("disabled={sendingTo !== null}");
    expect(source).toContain('busy ? <Text selectable style={sharePostStyles.sending}>发送中…</Text>');
  });
});

describe("FEED-SHARE-TO-USER-001 native share stays available as a fallback, not deleted", () => {
  it("keeps a '更多分享方式' row that still calls Share.share", () => {
    expect(source).toContain(">更多分享方式<");
    expect(source).toContain("function shareViaSystemSheet(post: FeedPost, authorName: string): void {");
    expect(source).toContain("void Share.share({ message: `${post.body}\\n\\nProxy · ${authorName}` });");
  });
});
