import type { ConversationInboxItem } from "./conversation-client";

export function dedupeInboxDialogs(items: ConversationInboxItem[]): ConversationInboxItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.conversation.conversationType !== "DM" || !item.counterpartyId) return true;
    if (seen.has(item.counterpartyId)) return false;
    seen.add(item.counterpartyId);
    return true;
  });
}
