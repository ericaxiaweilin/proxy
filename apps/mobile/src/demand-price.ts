// DEMAND-PRICE-ENGINE-001（2026-10-07，用户：「这个价格要怎么弄 给用户肯定不能输入
// 而是系统计算出来的 算法要做好统一的计算管线 不再搞用户自己输入 协商了」）：
// 发布需求第 4 段的价格从**用户手填**改成**系统算**。
//
// 这一份不是新造一套算法 —— 它是把 R58 那套**已经在跑**的动态定价引擎
// （服务端 catalog_engine.go 的 pricingRules → 契约下发 → market-template-price.ts
// 的 momentPriceQuote）接到发布需求这一屏。market.tsx 早就接了，向导一直没接：
// 价格是个自由文本输入框，而界面上那句「价格由场景基础价、时间、人数组成」
// 全仓只有它自己一处、零实现 —— 文案承诺了系统算价，实际是用户手填。
//
// ⚠️ 两个词表不通，所以这层适配是必须的，不是可选的美化：
//   · 模板 id：向导 meal/citywalk/ballgame/ride/pro vs 引擎 dining/walk/sport/cycling/translate
//   · 档位键：向导是裸数字/整点（"2"、"19:00"），引擎是档位串（"2 人"、"3–4 人"、"今晚 19:00"）
// 引擎的定价表**只有一份**，所以这里做解析，而不是另写一张价格表。
import type { QualityTierRule } from "@proxy/contracts";
import { quoteToVND } from "./market-template-price";

/**
 * 向导模板 id → 引擎模板 id。
 *
 * 只有这张表里的模板算得出价。不在表里的（自定义需求、签证/法律/商务）
 * 引擎没有规则 —— 那就**不编价**，落「由服务方报价」（见 isPriceComputable）。
 */
export const WIZARD_TO_ENGINE_TEMPLATE: Readonly<Record<string, string>> = {
  coffee: "coffee",
  meal: "dining",
  photo: "photo",
  citywalk: "walk",
  exhibition: "exhibition",
  ballgame: "sport",
  ride: "cycling",
  // 城市协助的主服务「现场翻译」在引擎里就是 translate（价 500K / 400–800K，
  // 与 PRO_SERVICES 里那条同值 —— 本来就是同一份数据的两个拷贝）。
  pro: "translate",
};

/** 引擎模板 id；没有对应关系时 undefined（= 引擎没有这档价）。 */
export function engineTemplateId(wizardTemplateId: string): string | undefined {
  return WIZARD_TO_ENGINE_TEMPLATE[wizardTemplateId];
}

/** 引擎目录里的基础价（"200K" → 200）。取不到就是 0。 */
export function baseKFromTemplatePrice(price: string): number {
  const match = /^(\d+(?:\.\d+)?)K$/.exec(price.trim());
  return match ? Math.round(Number.parseFloat(match[1]!)) : 0;
}

const NUMBERS = /\d+/g;

/** 档位解析结果：命中的档位串 + 是不是**精确**落在这一档里。 */
export type GroupBucket = { bucket: string; exact: boolean };

/**
 * 把向导的人数（裸数字）映射到引擎的档位串（"2 人" / "3–4 人"）。
 *
 * 超出所有档位时返回**最大档**且 exact=false —— 调用方必须把这件事说出来。
 * 静默按 0 处理会让「2 个人比 1 个人贵」到第 4 个人突然失效，用户看到的是
 * 一个不涨价的价，而没有任何解释。
 */
export function groupBucketFor(headcount: number, groups: readonly string[]): GroupBucket | undefined {
  let widest: string | undefined;
  let widestMax = -1;
  for (const group of groups) {
    const nums = [...group.matchAll(NUMBERS)].map((m) => Number.parseInt(m[0]!, 10));
    const lo = nums[0];
    if (lo === undefined) continue;
    const hi = nums.length > 1 ? nums[nums.length - 1]! : lo;
    if (headcount >= lo && headcount <= hi) return { bucket: group, exact: true };
    if (hi > widestMax) {
      widestMax = hi;
      widest = group;
    }
  }
  return widest === undefined ? undefined : { bucket: widest, exact: false };
}

const CLOCK = /(\d{1,2}):(\d{2})/g;

/**
 * 把向导的整点档（"19:00"）映射到引擎的时段串（"今晚 19:00" / "20:00–22:00"）。
 *
 * 引擎里那些**不带钟点**的时段键（"上午" / "下午" / "日落前" / "周末下午"）按钟点
 * 匹配不上 —— 那就不加价，也不猜。宁可少一项加价，也不替用户认领一个他没选的时段。
 */
export function timeBucketFor(slot: string, times: readonly string[]): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(slot.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  for (const label of times) {
    const clocks = [...label.matchAll(CLOCK)].map((c) => Number(c[1]) * 60 + Number(c[2]));
    const first = clocks[0];
    if (first === undefined) continue;
    if (clocks.length === 1) {
      if (first === minutes) return label;
      continue;
    }
    const last = clocks[clocks.length - 1]!;
    if (minutes >= first && minutes < last) return label;
  }
  return undefined;
}

/** 向导时长档（"2 小时"）在引擎的时长表里是否真有这一档。 */
export function durationKeyFor(duration: string, durations: readonly string[]): string | undefined {
  const trimmed = duration.trim();
  return durations.includes(trimmed) ? trimmed : undefined;
}

export type CreatorTier = { key: string; label: string; upliftPermille: number };

/**
 * 资历档 —— 「对努力干、愿意好好干的奖励」。
 *
 * 只用**原始质量信号**：履约率 / 满意度 / 真实成交单数。三条全达标才给档，
 * 首个命中生效（服务端的表已经按高到低排好）。
 *
 * ⚠️ 绝不读 matching.Score 的 Total（`rating.total`）。那个分的签名是
 * `Score(signals, price, budget)` —— **它的输入里含价格**，拿它反推价格就是
 * 价格 → 分 → 价格的循环。而且它是「适配分」，不是质量分。
 *
 * 无成交记录（hasTrackRecord=false）一律不给档：先验分不是她的成绩，
 * 跟卡片上印「新人」是同一条规矩。
 */
export function creatorTier(
  rating: { hasTrackRecord: boolean; fulfillmentRate: number; satisfactionRate: number; completedOrders: number } | undefined,
  tiers: readonly QualityTierRule[] | undefined
): CreatorTier | undefined {
  if (!rating || !rating.hasTrackRecord || !tiers) return undefined;
  for (const tier of tiers) {
    if (
      rating.fulfillmentRate >= tier.minFulfillment &&
      rating.satisfactionRate >= tier.minSatisfaction &&
      rating.completedOrders >= tier.minOrders
    ) {
      return { key: tier.key, label: tier.label, upliftPermille: tier.upliftPermille };
    }
  }
  return undefined;
}

export type DemandPriceLine = { label: string; amountK: number };

export type DemandPriceQuote = {
  baseK: number;
  lines: DemandPriceLine[];
  subtotalK: number;
  tier?: { label: string; upliftPermille: number; amountK: number };
  totalK: number;
  /** 需要说给用户听的话（人数超档…）。没话就 undefined。 */
  notice?: string;
};

/** 资历档上浮：千分比 × 小计，四舍五入到 K（钱不进小数）。 */
export function tierUpliftK(subtotalK: number, upliftPermille: number): number {
  return Math.round((subtotalK * upliftPermille) / 1000);
}

export type DemandPriceInput = {
  baseK: number;
  /** 向导的时长档（"2 小时"）。 */
  duration: string;
  /** 向导的整点档（"19:00"）。 */
  timeSlot: string;
  /** 向导的人数（1–6 的裸数字）。 */
  headcount: number;
  /** 引擎该模板的时长/时段/人数档位（来自 specs）。 */
  durations: readonly string[];
  times: readonly string[];
  groups: readonly string[];
  /** 引擎该模板的定价规则。 */
  pricing?: { duration?: Record<string, number>; time?: Record<string, number>; group?: Record<string, number> } | undefined;
  /** 选中的搭子的真实评分（只有「直接约」选过人时才有）。 */
  rating?: { hasTrackRecord: boolean; fulfillmentRate: number; satisfactionRate: number; completedOrders: number } | undefined;
  tiers?: readonly QualityTierRule[] | undefined;
};

/**
 * 统一价格管线：基础 + 时长 + 时段 + 人数 (+ 资历档上浮)。
 *
 * 只把**真的加了钱**的项列进 lines —— 跟 market.tsx 的动态报价分解同一口径
 * （零 delta 不占一行，免得用户以为「这项是 0 元」）。
 */
export function demandPriceQuote(input: DemandPriceInput): DemandPriceQuote {
  const lines: DemandPriceLine[] = [];

  const durationKey = durationKeyFor(input.duration, input.durations);
  const durationDelta = durationKey === undefined ? 0 : (input.pricing?.duration?.[durationKey] ?? 0);
  if (durationDelta !== 0) lines.push({ label: durationKey!, amountK: durationDelta });

  const timeKey = timeBucketFor(input.timeSlot, input.times);
  const timeDelta = timeKey === undefined ? 0 : (input.pricing?.time?.[timeKey] ?? 0);
  if (timeDelta !== 0) lines.push({ label: timeKey!, amountK: timeDelta });

  let notice: string | undefined;
  const bucket = groupBucketFor(input.headcount, input.groups);
  const groupDelta = bucket === undefined ? 0 : (input.pricing?.group?.[bucket.bucket] ?? 0);
  if (bucket !== undefined && !bucket.exact) {
    // 人数超出该场景声明的档位 ⇒ 按最大档计，并且**说出来**。
    notice = `该场景人数档到 ${bucket.bucket} 为止，${input.headcount} 人按最大档计价。`;
  }
  if (groupDelta !== 0) lines.push({ label: `${input.headcount} 人`, amountK: groupDelta });

  const subtotalK = input.baseK + lines.reduce((sum, line) => sum + line.amountK, 0);

  const tier = creatorTier(input.rating, input.tiers);
  const upliftK = tier === undefined ? 0 : tierUpliftK(subtotalK, tier.upliftPermille);

  return {
    baseK: input.baseK,
    lines,
    subtotalK,
    ...(tier === undefined ? {} : { tier: { label: tier.label, upliftPermille: tier.upliftPermille, amountK: upliftK } }),
    totalK: subtotalK + upliftK,
    ...(notice === undefined ? {} : { notice }),
  };
}

/** 算出来的价 → wire 上的价格串（跟 market.tsx 同一条 `quoteToVND`）。 */
export function demandPriceToWire(quote: DemandPriceQuote): string {
  return quoteToVND(quote.totalK);
}

/** 资历档上浮的人话（「资深 +25%」）。 */
export function tierUpliftLabel(tier: { label: string; upliftPermille: number }): string {
  return `${tier.label} +${Math.round(tier.upliftPermille / 10)}%`;
}
