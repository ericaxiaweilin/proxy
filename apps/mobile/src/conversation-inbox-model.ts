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

// 服务端头像引用归一：http(s)/file 原样用；/ 开头拼 base；assets/<id>
// （profile avatar_path、AI persona 写真）转 thumb 真地址；avatar- 开头是
// 本机副本文件名、空串及其他格式认不出 —— 返回 undefined 交给首字母回落，
// 绝不拼个 404 出来（之前裸 assets/ 直接当 URL，Linh/Minh 行永远空白）。
// FEED-SHARE-TO-USER-001: 原本只在 messages.tsx 里私有，动态页的"分享给"
// 头像列表要同一套归一逻辑，搬到这个共享的收件箱数据模块，两处 import。
export function resolveAvatarSource(ref: string, apiBaseUrl?: string): { uri: string } | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  if (/^(?:https?:|file:)/.test(trimmed)) return { uri: trimmed };
  if (trimmed.startsWith("/")) return { uri: `${apiBaseUrl ?? ""}${trimmed}` };
  const assetId = trimmed.startsWith("assets/") ? trimmed.slice("assets/".length).trim() : "";
  if (!assetId || assetId.startsWith("avatar-")) return undefined;
  return { uri: `${apiBaseUrl ?? ""}/v1/media/thumb/${encodeURIComponent(assetId)}` };
}
