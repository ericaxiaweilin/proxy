import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  baseKFromTemplatePrice,
  creatorTier,
  demandPriceQuote,
  demandPriceToWire,
  durationKeyFor,
  engineTemplateId,
  groupBucketFor,
  tierUpliftK,
  tierUpliftLabel,
  timeBucketFor,
  WIZARD_TO_ENGINE_TEMPLATE,
} from "./demand-price";

// DEMAND-PRICE-ENGINE-001：价格由系统算，用户不再输入、不再协商。
// 这一份测的是**统一管线**本身：词表桥、档位解析、资历档、总价。
//
// ⚠️ 数字全部取服务端 catalog_engine.go 的真实表（dining 的 Group
// {"1 人":0,"2 人":70,"3 人":130}、photo 的 {"1 人":0,"2 人":60,"3–4 人":120}…），
// 不另编一套「测试专用价」—— 那样测的是我编的数，不是引擎的表。

describe("词表桥：向导模板 id → 引擎模板 id", () => {
  it("8 个 Moment 模板全部有对应，没有静默漏网的", () => {
    // 漏一个的后果不是报错，是**那一档永远不加价**（看着像引擎没生效）。
    for (const id of ["coffee", "meal", "photo", "citywalk", "exhibition", "ballgame", "ride", "pro"]) {
      expect(engineTemplateId(id), `模板 ${id} 没有引擎对应`).toBeDefined();
    }
  });

  it("映射落在真实存在的引擎 id 上，不是随手起的名字", () => {
    // 引擎目录（catalog_engine.go 的 opportunityTemplates）里的 16 个 id。
    const engineIds = new Set([
      "coffee", "dining", "ktv", "photo", "walk", "exhibition", "ao-bike-photo",
      "sunset-coffee", "film-walk", "night-ktv", "cycling", "shopping", "movie",
      "explore", "sport", "translate",
    ]);
    for (const [wizard, engine] of Object.entries(WIZARD_TO_ENGINE_TEMPLATE)) {
      expect(engineIds.has(engine), `${wizard} → ${engine} 不是引擎里的模板`).toBe(true);
    }
  });

  it("没有对应的模板返回 undefined —— 调用方据此落「由服务方报价」", () => {
    expect(engineTemplateId("custom")).toBeUndefined();
    expect(engineTemplateId("visa")).toBeUndefined();
    expect(engineTemplateId("legal")).toBeUndefined();
    expect(engineTemplateId("business")).toBeUndefined();
  });
});

describe("基础价解析", () => {
  it("引擎的 K 简写转成数字", () => {
    expect(baseKFromTemplatePrice("200K")).toBe(200);
    expect(baseKFromTemplatePrice("450K")).toBe(450);
    expect(baseKFromTemplatePrice(" 250K ")).toBe(250);
  });

  it("取不到就是 0，不猜", () => {
    expect(baseKFromTemplatePrice("面议")).toBe(0);
    expect(baseKFromTemplatePrice("")).toBe(0);
    expect(baseKFromTemplatePrice("200,000₫")).toBe(0);
  });
});

describe("档位解析：向导的裸数字/整点 → 引擎的档位串", () => {
  it("人数落在档位区间里就是精确命中", () => {
    const groups = ["1 人", "2 人", "3–4 人"];
    expect(groupBucketFor(1, groups)).toEqual({ bucket: "1 人", exact: true });
    expect(groupBucketFor(2, groups)).toEqual({ bucket: "2 人", exact: true });
    expect(groupBucketFor(3, groups)).toEqual({ bucket: "3–4 人", exact: true });
    expect(groupBucketFor(4, groups)).toEqual({ bucket: "3–4 人", exact: true });
  });

  it("超出所有档位时返回最大档，且 exact=false（调用方必须说出来）", () => {
    // 静默返回 0 会让「2 个人比 1 个人贵」到第 5 个人突然失效，而且没有解释。
    expect(groupBucketFor(6, ["1 人", "2 人", "3–4 人"])).toEqual({ bucket: "3–4 人", exact: false });
  });

  it("档位表为空返回 undefined", () => {
    expect(groupBucketFor(2, [])).toBeUndefined();
  });

  it("整点命中引擎的时段串", () => {
    expect(timeBucketFor("19:00", ["今晚 19:00", "明天 15:00", "周末下午"])).toBe("今晚 19:00");
    expect(timeBucketFor("15:00", ["今晚 19:00", "明天 15:00", "周末下午"])).toBe("明天 15:00");
  });

  it("落在区间时段里也算命中", () => {
    expect(timeBucketFor("21:00", ["20:00–22:00", "22:00 后"])).toBe("20:00–22:00");
    expect(timeBucketFor("22:00", ["20:00–22:00", "22:00 后"])).toBe("22:00 后");
  });

  it("不带钟点的时段键匹配不上就返回 undefined —— 不替用户认领他没选的时段", () => {
    expect(timeBucketFor("15:00", ["上午", "下午", "日落前"])).toBeUndefined();
    expect(timeBucketFor("", ["今晚 19:00"])).toBeUndefined();
  });

  it("时长档必须真在引擎的档位表里", () => {
    expect(durationKeyFor("2 小时", ["1 小时", "2 小时", "3 小时"])).toBe("2 小时");
    expect(durationKeyFor("5 小时", ["1 小时", "2 小时", "3 小时"])).toBeUndefined();
  });
});

describe("资历档：对努力干、愿意好好干的奖励", () => {
  const tiers = [
    { key: "veteran", label: "资深", minFulfillment: 0.95, minSatisfaction: 0.9, minOrders: 20, upliftPermille: 250 },
    { key: "skilled", label: "熟练", minFulfillment: 0.9, minSatisfaction: 0.85, minOrders: 5, upliftPermille: 100 },
  ];

  it("无成交记录一律不给档 —— 先验分不是她的成绩", () => {
    expect(creatorTier({ hasTrackRecord: false, fulfillmentRate: 1, satisfactionRate: 1, completedOrders: 99 }, tiers)).toBeUndefined();
  });

  it("三条全达标才给档（只达标两条不算）", () => {
    // 履约 1.0 + 满意 0.9 但只有 1 单 ⇒ 不够「熟练」的 5 单。
    expect(creatorTier({ hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 0.9, completedOrders: 1 }, tiers)).toBeUndefined();
    expect(creatorTier({ hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 0.9, completedOrders: 5 }, tiers)?.key).toBe("skilled");
    expect(creatorTier({ hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 0.95, completedOrders: 30 }, tiers)?.key).toBe("veteran");
  });

  it("首个命中生效 ⇒ 表必须从高到低（服务端那条钉同口径）", () => {
    const low = creatorTier({ hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 0.95, completedOrders: 30 }, tiers);
    expect(low?.label).toBe("资深");
    expect(low?.upliftPermille).toBe(250);
  });

  it("服务端没下发档位表时不加价（不自己编档）", () => {
    expect(creatorTier({ hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 1, completedOrders: 99 }, undefined)).toBeUndefined();
  });

  it("上浮是千分比，钱不进小数", () => {
    expect(tierUpliftK(320, 100)).toBe(32);
    expect(tierUpliftK(250, 250)).toBe(63); // 62.5 → 63
    expect(tierUpliftLabel({ label: "资深", upliftPermille: 250 })).toBe("资深 +25%");
    expect(tierUpliftLabel({ label: "熟练", upliftPermille: 100 })).toBe("熟练 +10%");
  });
});

describe("统一管线：基础 + 时长 + 时段 + 人数 (+ 资历档)", () => {
  // dining 的真实规则：Duration {"1.5 小时":-30,"2 小时":0,"3 小时":100}
  //                     Group {"1 人":0,"2 人":70,"3 人":130}
  const dining = {
    baseK: 250,
    durations: ["1.5 小时", "2 小时", "3 小时"],
    times: ["今晚 18:30", "明天 18:30", "周末晚餐"],
    groups: ["1 人", "2 人", "3 人"],
    pricing: {
      duration: { "1.5 小时": -30, "2 小时": 0, "3 小时": 100 },
      time: { "今晚 18:30": 20, "明天 18:30": 0, "周末晚餐": 40 },
      group: { "1 人": 0, "2 人": 70, "3 人": 130 },
    },
  };

  it("🔴 用户点名的那条：服务 2 个人比 1 个人贵", () => {
    const one = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "", headcount: 1 });
    const two = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "", headcount: 2 });
    expect(one.totalK).toBe(250);
    expect(two.totalK).toBe(320);
    expect(two.totalK).toBeGreaterThan(one.totalK);
  });

  it("时长、时段、人数各自进分解行，零 delta 不占行", () => {
    const q = demandPriceQuote({ ...dining, duration: "3 小时", timeSlot: "18:30", headcount: 2 });
    expect(q.lines).toEqual([
      { label: "3 小时", amountK: 100 },
      { label: "今晚 18:30", amountK: 20 },
      { label: "2 人", amountK: 70 },
    ]);
    expect(q.totalK).toBe(250 + 100 + 20 + 70);
  });

  it("2 小时 / 明天 18:30 / 1 人 全是 0 delta ⇒ 只剩基础价", () => {
    const q = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "18:30", headcount: 1 });
    // 18:30 同时命中「今晚 18:30」(+20) 和「明天 18:30」(0) —— 首个命中，加 20。
    expect(q.lines).toEqual([{ label: "今晚 18:30", amountK: 20 }]);
    expect(q.totalK).toBe(270);
  });

  it("引擎没有这档时长 ⇒ 不加价，也不编", () => {
    const q = demandPriceQuote({ ...dining, duration: "8 小时", timeSlot: "", headcount: 1 });
    expect(q.lines).toEqual([]);
    expect(q.totalK).toBe(250);
  });

  it("人数超档要**说出来**，不能静默按最大档算", () => {
    const q = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "", headcount: 6 });
    expect(q.notice).toBeDefined();
    expect(q.notice).toContain("3 人");
    expect(q.lines).toEqual([{ label: "6 人", amountK: 130 }]);
  });

  it("资历档上浮加在小计之后，并单独成行", () => {
    const q = demandPriceQuote({
      ...dining,
      duration: "2 小时",
      timeSlot: "",
      headcount: 2,
      rating: { hasTrackRecord: true, fulfillmentRate: 1, satisfactionRate: 0.9, completedOrders: 5 },
      tiers: [{ key: "skilled", label: "熟练", minFulfillment: 0.9, minSatisfaction: 0.85, minOrders: 5, upliftPermille: 100 }],
    });
    expect(q.subtotalK).toBe(320);
    expect(q.tier).toEqual({ label: "熟练", upliftPermille: 100, amountK: 32 });
    expect(q.totalK).toBe(352);
  });

  it("没选人（等接单）就没有资历档 —— 发布时还没有「接单的人」", () => {
    const q = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "", headcount: 2 });
    expect(q.tier).toBeUndefined();
    expect(q.totalK).toBe(320);
  });

  it("算出来的价走同一条 wire 格式化", () => {
    const q = demandPriceQuote({ ...dining, duration: "2 小时", timeSlot: "", headcount: 2 });
    expect(demandPriceToWire(q)).toBe("320,000₫");
  });
});

// ---------------------------------------------------------------------------
// 接线层：这一份测的是**源码形态**，不是运行时行为。
//
// 为什么必须放在这里而不是 shell 门禁里：这几条的反面断言要挡的词
// （`rating.total` / `styles.negoBtn`）**本仓的注释里就写着** —— 上面那两处解释
// 正是在说「绝不读 total」「旧开关已删」。shell 的 `grep -qF` 不剥注释，
// 裸查会被自己的注释喂绿（本仓前科：钉被自己的解释注释养活）。
// 所以这里先 stripComments 再断言，跟 scene-shop-directory / feed-post-clean 同款。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const read = (rel: string): string => stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const priceCode = read("./demand-price.ts");
const wizardCode = read("./surfaces/demand-wizard.tsx");
const momentsCode = read("./demand-moments.ts");

describe("统一管线不是第二张价格表，也不是循环依赖", () => {
  it("🔴 绝不读 matching.Score 的 Total —— 它的输入含价格，反推就是价格→分→价格", () => {
    // `Score(signals, price, budget)` 的签名里就有 price/budget。拿它的 Total 定价，
    // 改价会改分、改分又改价。而且它是「适配分」不是质量分，本来就不该决定报价。
    // ⚠️ 只查 `rating.total` / `rating?.total`，不查裸 `.total` —— 报价自己就有
    // `quote.totalK`（那是**算出来的**总价，跟 matching 那个 Total 无关）。
    expect(priceCode).not.toContain("rating.total");
    expect(priceCode).not.toContain("rating?.total");
    expect(priceCode).not.toContain("matching");
  });

  it("资历档只吃三个原始质量信号（履约 / 满意 / 真实成交单数）", () => {
    // 正向：只写反面断言的话，把 creatorTier 整个删掉也能过。
    for (const signal of ["rating.fulfillmentRate", "rating.satisfactionRate", "rating.completedOrders"]) {
      expect(priceCode, `资历档没读 ${signal}`).toContain(signal);
    }
    expect(priceCode).toContain("rating.hasTrackRecord");
  });

  it("钱走共享格式化，不另写一份 VND 印法", () => {
    // 同一份数据两套格式化 = 「同一个人两个价」的格式化版（CREATOR-LIST-CARD-001 口径）。
    expect(priceCode).toContain('from "./market-template-price"');
    expect(priceCode).toContain("quoteToVND(");
    // 反面：不许自己拼 ₫ / 手写千分位。
    expect(priceCode).not.toContain("toLocaleString");
    expect(priceCode).not.toContain("₫");
  });
});

describe("向导接线：价从管线来，不再有用户输入 / 协商", () => {
  it("价格输入框与「可协商」开关都下线了", () => {
    // 用户 2026-10-07：「给用户肯定不能输入 而是系统计算出来的…不再搞用户自己输入 协商了」。
    expect(wizardCode).not.toContain("value={specs.price}");
    expect(wizardCode).not.toContain("styles.negoBtn");
    // 正面：还有一个「价格」段在（别靠把整段删掉来让上面两条过）。
    expect(wizardCode).toContain('title="价格"');
  });

  it("价由 demand-price 那条管线算，向导不自己算钱", () => {
    expect(wizardCode).toContain("demandPriceQuote(");
    expect(wizardCode).toContain("demandPriceToWire(");
    // 反面：向导里不许出现第二张价格表 —— 引擎那份 `pricingRules` 只有服务端一处。
    // ⚠️ 这条**必须在 stripComments 之后**查：向导第 55 行的说明注释里就写着服务端那张表
    // 的类名（那是在解释这套价从哪来）。实测过一次：把它放 shell 的裸 `grep -qF` 里，
    // 整块钉被自己的注释喂成常红，后面 9 条反向注入臂全被同一个假红盖住 —— 看着像
    // 「臂都验过了」，其实一条都没验到。这正是本仓「钉被自己的解释注释养活」的反面。
    expect(wizardCode).not.toContain("pricingRules");
  });

  it("履约 / 评分接的是**选中那个人**的真实 rating，档位表来自服务端目录", () => {
    // 资历档只在「直接约 · 选中了人」那一支成立 —— 「等接单」发布时还没有接单的人。
    expect(wizardCode).toContain("targetAgent?.rating");
    expect(wizardCode).toContain("catalog?.qualityTiers");
    // 反面：档位表不许在客户端写死（写死就等于前端自己发奖励，服务端改表不生效）。
    expect(wizardCode).not.toContain("upliftPermille:");
  });

  it("算不出来就不编价：落 moneyFlow TBD + 空价", () => {
    // 契约里 TBD 不许带非零价（`{ price: "", moneyFlow: "TBD" }` 是唯一合法组合）。
    expect(wizardCode).toContain('{ price: "", moneyFlow: "TBD" }');
    expect(wizardCode).toContain("由服务方报价");
  });

  it("发布输入吃算出来的价（而不是草稿里的旧手填值）", () => {
    expect(momentsCode).toContain("computedPrice?.price ?? specs.price.trim()");
    expect(momentsCode).toContain('computedPrice?.moneyFlow ?? "EARN"');
  });
});
