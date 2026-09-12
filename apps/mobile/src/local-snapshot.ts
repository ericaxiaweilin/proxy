// local-snapshot.ts — 本机 JSON 快照纯解析层（SYNC-FS-001）。
//
// File.json() 是异步的：所有对 .json() 的同步消费拿到的都是 Promise，
// Array.isArray 恒为 false——之前五个读盘点全部静默回退（删掉的会话
// 重进就回来、偏好/频道/草稿永不恢复）。解析逻辑收归此处做单测，
// 异步读取留在各归属模块（await 后调这里）。
import type { FolderV1 } from "./components/folder-manager";

/** 本机隐藏会话 id 列表。 */
export function parseHiddenChatIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** 自建文件夹。 */
export function parseFolders(raw: unknown): FolderV1[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is FolderV1 =>
    typeof x === "object" && x !== null &&
    typeof (x as { id?: unknown }).id === "string" &&
    typeof (x as { name?: unknown }).name === "string" &&
    Array.isArray((x as { dialogIds?: unknown }).dialogIds)).map((x) => ({
    id: x.id as string,
    name: x.name as string,
    dialogIds: (x.dialogIds as unknown[]).filter((d): d is string => typeof d === "string"),
  }));
}

export type CreatorSnapshot = {
  accepted: boolean;
  categories: string[];
  primaryCategory: string;
  city: string;
  channels: Record<string, string>;
  collaborations: string[];
  collabNote: string;
  rates: Record<string, string>;
  rateVisibility: "公开起步价" | "价格区间" | "询价";
};

/** 创作者入驻草稿快照。 */
export function parseCreatorSnapshot(raw: unknown): CreatorSnapshot | undefined {
  const snapshot = raw as Partial<CreatorSnapshot> | null;
  try {
    if (!snapshot || typeof snapshot !== "object") return undefined;
    return {
      accepted: snapshot.accepted === true,
      categories: Array.isArray(snapshot.categories) ? snapshot.categories.filter((c): c is string => typeof c === "string") : ["Beauty", "Lifestyle"],
      primaryCategory: typeof snapshot.primaryCategory === "string" ? snapshot.primaryCategory : "Beauty",
      city: typeof snapshot.city === "string" ? snapshot.city : "Ho Chi Minh City",
      channels: snapshot.channels && typeof snapshot.channels === "object" ? snapshot.channels as Record<string, string> : { TikTok: "@huyen.life", Instagram: "@huyen.frames" },
      collaborations: Array.isArray(snapshot.collaborations) ? snapshot.collaborations.filter((c): c is string => typeof c === "string") : [],
      collabNote: typeof snapshot.collabNote === "string" ? snapshot.collabNote : "",
      rates: snapshot.rates && typeof snapshot.rates === "object" ? snapshot.rates as Record<string, string> : {},
      rateVisibility: snapshot.rateVisibility === "价格区间" || snapshot.rateVisibility === "询价" ? snapshot.rateVisibility : "公开起步价",
    };
  } catch {
    return undefined;
  }
}
