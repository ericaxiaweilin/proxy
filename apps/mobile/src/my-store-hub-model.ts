// STORE-HUB-001：我的店铺 hub 纯函数（封面配色 / 满意率 / 营业时间 / 筛选）。
// 有评价才算满意率 —— 没评价显示"暂无评价"，不拿 0% 或 100% 冒充。

export type StoreCover = { from: string; to: string; ink: string };

const COVERS: readonly StoreCover[] = [
  { from: "#E6F5A0", to: "#C7DF4E", ink: "#3A4A00" },
  { from: "#F8D4DA", to: "#E08D9A", ink: "#5C1F28" },
  { from: "#D6E5F8", to: "#79A5DC", ink: "#1A3A66" },
  { from: "#F5DA92", to: "#D4AF37", ink: "#4A3900" },
];

/** 品类定封面（纯装饰）：同品类同色，无品类按店名哈希，保证稳定不跳变。 */
export function coverForStore(seed: string): StoreCover {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COVERS[hash % COVERS.length]!;
}

/** 满意率 = FULL / (FULL + PARTIAL)。没有评价返回 undefined（调用方显示"暂无评价"）。 */
export function satisfactionRate(fullCount: number, partialCount: number): number | undefined {
  const rated = fullCount + partialCount;
  if (rated <= 0) return undefined;
  return Math.round((fullCount / rated) * 100);
}

export function satisfactionRateText(fullCount: number, partialCount: number): string {
  const rate = satisfactionRate(fullCount, partialCount);
  return rate === undefined ? "暂无评价" : `满意 ${rate}%`;
}

/** 需求方主观满意 → 人话。NONE 是明确的不满意，不叫"待评价"。 */
export function satisfactionText(resolved: string): string {
  if (resolved === "FULL") return "满意";
  if (resolved === "PARTIAL") return "还行";
  if (resolved === "NONE") return "不满意";
  return "待评价";
}

/** ISO 时间 → MM-DD（列表末单行用）。解析失败返回空串（整行不画）。 */
export function formatMonthDay(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 时间 → YYYY-MM-DD（入驻时间行用）。解析失败返回空串（整行不画）。 */
export function formatFullDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** hoursJson 自由 blob → 行列表。不是对象/空对象返回 []（整段不画）。 */
export function formatHoursLines(hoursJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(hoursJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim() !== "") lines.push(`${key} ${value.trim()}`);
  }
  return lines;
}

export type HubShopFilter = {
  id: string;
  name: string;
  address: string;
  category: string;
  orderCount: number;
  fullCount: number;
  partialCount: number;
  lastOrderAt?: string;
};

/** 搜索（名/地址/品类）+ 品类 chip；recent 按末单倒序（无单沉底），rate 按满意率降序（无评价沉底）。 */
export function filterHubShops(
  shops: readonly HubShopFilter[],
  query: string,
  category: string,
  sort: "none" | "recent" | "rate",
): HubShopFilter[] {
  const q = query.trim().toLowerCase();
  const list = shops.filter((s) => {
    if (category !== "" && s.category !== category) return false;
    if (q === "") return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });
  if (sort === "none") return [...list];
  if (sort === "recent") {
    const timeOf = (s: HubShopFilter): number => {
      const t = s.lastOrderAt ? Date.parse(s.lastOrderAt) : NaN;
      return Number.isFinite(t) ? t : -1;
    };
    return [...list].sort((a, b) => timeOf(b) - timeOf(a) || b.orderCount - a.orderCount);
  }
  const rateOf = (s: HubShopFilter): number => satisfactionRate(s.fullCount, s.partialCount) ?? -1;
  return [...list].sort((a, b) => rateOf(b) - rateOf(a) || b.orderCount - a.orderCount);
}
