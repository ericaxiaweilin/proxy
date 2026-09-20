// local-snapshot.ts — 本机 JSON 快照纯解析层（SYNC-FS-001）。
//
// File.json() 是异步的：所有对 .json() 的同步消费拿到的都是 Promise，
// Array.isArray 恒为 false——之前五个读盘点全部静默回退（删掉的会话
// 重进就回来、偏好/频道/草稿永不恢复）。解析逻辑收归此处做单测，
// 异步读取留在各归属模块（await 后调这里）。
/** 本机隐藏会话 id 列表（v1 形状，时间戳由调用方补升级时刻）。 */
export function parseHiddenChatIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** 本机隐藏会话 → 藏起时刻（v2 形状 `{id: atMs}`，兼容 v1 的 string[]，这时
 * 时刻记 0，调用方迁移时填升级时刻 —— 见 messages.tsx 注释。坏形状一律丢弃，
 * 绝不把脏数据当成"藏过"（fail-closed 反过来会吞会话）。 */
export function parseHiddenChatTimes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item) out[item] = 0;
      else if (typeof item === "object" && item !== null) {
        const id = (item as { id?: unknown }).id;
        const at = (item as { at?: unknown }).at;
        if (typeof id === "string" && id && typeof at === "number" && Number.isFinite(at) && at >= 0) out[id] = at;
      }
    }
    return out;
  }
  if (typeof raw === "object" && raw !== null) {
    for (const [id, at] of Object.entries(raw)) {
      if (id && typeof at === "number" && Number.isFinite(at) && at >= 0) out[id] = at;
    }
  }
  return out;
}

/** 滑删语义：dismiss 当前视图，来新动态即回（block 才彻底）。
 * 隐藏时刻之后有动态（lastActivityMs > hiddenAt）就不再藏。 */
export function shouldResurfaceHidden(hiddenAt: number | undefined, lastActivityMs: number): boolean {
  return hiddenAt !== undefined && lastActivityMs > hiddenAt;
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
