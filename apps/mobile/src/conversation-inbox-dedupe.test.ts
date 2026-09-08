import { describe, expect, it } from "vitest";
import { dedupeInboxDialogs } from "./conversation-inbox-model";
import type { ConversationInboxItem } from "./conversation-client";

function row(id: string, counterpartyId: string, type = "DM"): ConversationInboxItem {
  return { conversation: { conversationId: id, conversationType: type, originType: "PROFILE", originId: counterpartyId, state: "ACTIVE", participants: ["me", counterpartyId], lastMessageAt: "2026-09-08T00:00:00Z" }, counterpartyId };
}

describe("conversation inbox account-pair uniqueness", () => {
  it("keeps only the newest server-ordered DM for each user id", () => {
    expect(dedupeInboxDialogs([row("new", "user_2"), row("old", "user_2"), row("other", "user_3")]).map((item) => item.conversation.conversationId)).toEqual(["new", "other"]);
  });

  it("does not merge non-DM business conversations", () => {
    expect(dedupeInboxDialogs([row("group_a", "user_2", "GROUP"), row("group_b", "user_2", "GROUP")])).toHaveLength(2);
  });
});
