// AI-MANAGE-007（2026-09-23，用户：「价格 logo 数字…肯定加载专门的文件 别写在代码里 token 的费用属于
// 高度变化的 后期运营了 直接对接 自动更新就好了」）：出图厂商、模型、价格、logo、免费额度都从服务端
// GET /v1/ai/catalog 读（来源是运营维护的 config/ai-catalog/ 文件，改了自动生效），App 里不写死。

export type AiCatalogPrice = { label: string; currency?: string; min?: number; max?: number; unit: string };
export type AiCatalogModel = { name: string; price: AiCatalogPrice; tag?: string; subscription?: boolean };
export type AiCatalogVendor = {
  id: string;
  name: string;
  desc: string;
  logoSvg: string;
  logoBg: string;
  recommend: boolean;
  pinned: boolean;
  rank: { quality: number; price: number; popular: number };
  models: AiCatalogModel[];
};
export type AiCatalog = {
  version: string;
  imageBilling: { payer: string; freeImagesPerMonth: number; freeVendor: string; priceNotice: string };
  chatBilling: { payer: string; pricePer1kTokens: number | null };
  vendors: AiCatalogVendor[];
};

type Requester = { request(path: string, init: { method: "GET" }): Promise<{ status: number; json(): Promise<unknown> }> };

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

// 解析失败的条目直接丢掉（不猜）；一个厂商都没有就当目录读失败。
export function parseAiCatalog(raw: unknown): AiCatalog {
  if (!raw || typeof raw !== "object") throw new Error("AI 目录格式不对");
  const body = raw as Record<string, unknown>;
  const image = (body.imageBilling ?? {}) as Record<string, unknown>;
  const chat = (body.chatBilling ?? {}) as Record<string, unknown>;
  const vendors: AiCatalogVendor[] = [];
  for (const item of Array.isArray(body.vendors) ? body.vendors : []) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const id = str(v.id);
    const name = str(v.name);
    const logoSvg = str(v.logoSvg);
    if (!id || !name || !logoSvg.includes("<svg")) continue;
    const rank = (v.rank ?? {}) as Record<string, unknown>;
    const models: AiCatalogModel[] = [];
    for (const m of Array.isArray(v.models) ? v.models : []) {
      if (!m || typeof m !== "object") continue;
      const model = m as Record<string, unknown>;
      const price = (model.price ?? {}) as Record<string, unknown>;
      if (!str(model.name) || !str(price.label)) continue;
      const parsed: AiCatalogModel = { name: str(model.name), price: { label: str(price.label), unit: str(price.unit, "metered") } };
      if (typeof price.currency === "string") parsed.price.currency = price.currency;
      if (typeof price.min === "number") parsed.price.min = price.min;
      if (typeof price.max === "number") parsed.price.max = price.max;
      if (typeof model.tag === "string" && model.tag) parsed.tag = model.tag;
      if (model.subscription === true) parsed.subscription = true;
      models.push(parsed);
    }
    vendors.push({
      id,
      name,
      desc: str(v.desc),
      logoSvg,
      logoBg: str(v.logoBg, "#1a1a1a"),
      recommend: v.recommend === true,
      pinned: v.pinned === true,
      rank: { quality: num(rank.quality), price: num(rank.price), popular: num(rank.popular) },
      models,
    });
  }
  if (vendors.length === 0) throw new Error("AI 目录里没有可用的厂商");
  return {
    version: str(body.version),
    imageBilling: {
      payer: str(image.payer, "user"),
      freeImagesPerMonth: Math.max(0, Math.floor(num(image.freeImagesPerMonth))),
      freeVendor: str(image.freeVendor, vendors[0]!.id),
      priceNotice: str(image.priceNotice),
    },
    chatBilling: { payer: str(chat.payer, "platform"), pricePer1kTokens: typeof chat.pricePer1kTokens === "number" ? chat.pricePer1kTokens : null },
    vendors,
  };
}

export async function fetchAiCatalog(client: Requester): Promise<AiCatalog> {
  const response = await client.request("/v1/ai/catalog", { method: "GET" });
  if (response.status !== 200) throw new Error("AI 目录暂时读不到");
  return parseAiCatalog(await response.json());
}

// 置顶的（平台默认）在前，其余按选中的维度排：质量 / 热门 降序，价格 升序。
export function sortCatalogVendors(vendors: ReadonlyArray<AiCatalogVendor>, sort: "quality" | "price" | "popular"): AiCatalogVendor[] {
  const pinned = vendors.filter((vendor) => vendor.pinned);
  const rest = vendors.filter((vendor) => !vendor.pinned).sort((a, b) =>
    sort === "quality" ? b.rank.quality - a.rank.quality : sort === "price" ? a.rank.price - b.rank.price : b.rank.popular - a.rank.popular);
  return [...pinned, ...rest];
}
