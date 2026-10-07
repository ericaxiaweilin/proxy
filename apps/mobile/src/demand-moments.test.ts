import { describe, expect, it } from "vitest";
import { PublishMarketOpportunityInputSchema } from "@proxy/contracts";
import type { SupplierCandidate } from "./supply-client";
import { buildDemandPublishInput, DEFAULT_DURATION, DEFAULT_HEADCOUNT, DEFAULT_TIME_SLOT, defaultSpecsFor, DURATION_MAX_HOURS, DURATION_MIN_HOURS, DURATION_OPTIONS, HEADCOUNT_OPTIONS, MAX_HEADCOUNT, MOMENT_TEMPLATES, normalizeDuration, normalizeHeadcount, normalizeTimeSlot, TIME_SLOT_MAX_HOUR, TIME_SLOT_MIN_HOUR, TIME_SLOT_OPTIONS } from "./demand-moments";

describe("R58 demand wizard mapping", () => {
  it("ships moment templates with defaults", () => {
    // 2026-10-06 用户：「唱歌不要搞 😂」—— KTV 那条模板撤掉了，roster 跟着收窄。
    // 同日「说错 加运动」—— 补回打球 / 骑行两条支撑 rail 第四档「运动」。
    // 这条钉是**逐条列 id**的（不是数字），撤/加模板必须在这里显形。
    expect(MOMENT_TEMPLATES.map((template) => template.id)).toEqual(
      ["coffee", "meal", "photo", "citywalk", "exhibition", "ballgame", "ride", "pro"]
    );
    for (const template of MOMENT_TEMPLATES) {
      expect(template.title.trim()).not.toBe("");
      expect(template.ratios).toContain(template.defaultRatio);
      expect(template.priceRef.trim()).not.toBe("");
    }
  });

  it("maps specs to a schema-valid publish input", () => {
    const template = MOMENT_TEMPLATES[0]!;
    const input = buildDemandPublishInput(template, {
      ...defaultSpecsFor(template),
      ratio: "2",
      time: "19:00",
      duration: "2 小时",
      place: "西湖",
      prefs: ["公共场所见面", "中文"],
      price: "200,000₫"
    });
    expect(input.title).toBe("喝咖啡");
    expect(input.moneyFlow).toBe("EARN");
    expect(input.time).toContain("19:00");
    expect(input.skills).toContain("公共场所见面");
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
  });

  // DEMAND-HEADCOUNT-002（2026-10-07，用户：「你们几人是输入框 改为选择 默认1人
  // 最大上限为6人」）：人数是 1–6 的选择，默认 1 人。发布行恒带「N 人」；
  // 老草稿的自由文本经归一收敛（前导数字截断夹到 1–6），没数字回默认。
  it("selects headcount 1-6, defaults to 1", () => {
    const template = MOMENT_TEMPLATES[0]!;
    expect(HEADCOUNT_OPTIONS).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(MAX_HEADCOUNT).toBe(6);
    expect(DEFAULT_HEADCOUNT).toBe("1");
    expect(defaultSpecsFor(template).ratio).toBe("1");
    const two = buildDemandPublishInput(template, { ...defaultSpecsFor(template), ratio: "2", time: "19:00", duration: "2 小时" });
    expect(two.time).toBe("19:00 · 2 小时 · 2 人");
    const six = buildDemandPublishInput(template, { ...defaultSpecsFor(template), ratio: "6", time: "19:00", duration: "2 小时" });
    expect(six.time).toBe("19:00 · 2 小时 · 6 人");
    const def = buildDemandPublishInput(template, defaultSpecsFor(template));
    expect(def.time).toContain("1 人");
    // 老草稿迁移：前导数字截断夹到 1–6，没数字回默认。
    expect(normalizeHeadcount("2 大 1 小")).toBe("2");
    expect(normalizeHeadcount("10")).toBe("6");
    expect(normalizeHeadcount("  ")).toBe("1");
    expect(normalizeHeadcount(undefined)).toBe("1");
    const legacy = buildDemandPublishInput(template, { ...defaultSpecsFor(template), ratio: "2 大 1 小", time: "19:00", duration: "2 小时" });
    expect(legacy.time).toBe("19:00 · 2 小时 · 2 人");
    const empty = buildDemandPublishInput(template, { ...defaultSpecsFor(template), ratio: "  ", time: "19:00", duration: "2 小时" });
    expect(empty.time).toBe("19:00 · 2 小时 · 1 人");
    expect(PublishMarketOpportunityInputSchema.safeParse(two).success).toBe(true);
  });

  // DEMAND-TIMESLOT-001（2026-10-07，用户：「不要写今晚 … 时间下拉就可以
  // 06:00-22:00，支持 m 精度」）：时间段是 06:00–22:00 半小时一档的下拉（33 档）。
  // 模板的「今晚 19:00」「下午」…只当默认值的来源；发布行恒为 HH:MM，「今晚」到此为止。
  it("selects time 06:00-22:00 in half-hour slots", () => {
    expect(TIME_SLOT_MIN_HOUR).toBe(6);
    expect(TIME_SLOT_MAX_HOUR).toBe(22);
    expect(DEFAULT_TIME_SLOT).toBe("19:00");
    expect(TIME_SLOT_OPTIONS).toHaveLength(33);
    expect(TIME_SLOT_OPTIONS[0]).toBe("06:00");
    expect(TIME_SLOT_OPTIONS[TIME_SLOT_OPTIONS.length - 1]).toBe("22:00");
    expect(TIME_SLOT_OPTIONS).toContain("19:00");
    // 模板默认值收敛：时刻原样留，中文词按早晚给，空回默认。
    const byId = (id: string): string => defaultSpecsFor(MOMENT_TEMPLATES.find((t) => t.id === id)!).time;
    expect(byId("coffee")).toBe("19:00");
    expect(byId("meal")).toBe("18:30");
    expect(byId("photo")).toBe("15:00");
    expect(byId("ballgame")).toBe("15:00");
    expect(byId("ride")).toBe("09:00");
    expect(byId("pro")).toBe("19:00");
    // 归一：夹小时、分钟贴档、关键词、默认。
    expect(normalizeTimeSlot("今晚 19:00")).toBe("19:00");
    expect(normalizeTimeSlot("周末 15:00")).toBe("15:00");
    expect(normalizeTimeSlot("19:47")).toBe("20:00");
    expect(normalizeTimeSlot("05:10")).toBe("06:00");
    expect(normalizeTimeSlot("25:00")).toBe("22:00");
    expect(normalizeTimeSlot("下午")).toBe("15:00");
    expect(normalizeTimeSlot("  ")).toBe("19:00");
    // 发布行恒为 HH:MM，老自由文本不再透传。
    const template = MOMENT_TEMPLATES[0]!;
    const legacy = buildDemandPublishInput(template, { ...defaultSpecsFor(template), time: "今晚 19:00" });
    expect(legacy.time).toContain("19:00");
    expect(legacy.time).not.toContain("今晚");
    expect(legacy.date).toBe("19:00");
    expect(PublishMarketOpportunityInputSchema.safeParse(legacy).success).toBe(true);
  });

  // DEMAND-DURATION-001（2026-10-07，用户：「时长也用滚轮 1H-8H就可以」）：
  // 时长是 1–8 小时的滚轮（8 档，默认 2 小时）。模板的「半天 / 全天」只当
  // 默认值的来源（半天→4 小时）；发布行恒为「N 小时」。
  it("selects duration 1-8 hours, defaults to 2", () => {
    expect(DURATION_MIN_HOURS).toBe(1);
    expect(DURATION_MAX_HOURS).toBe(8);
    expect(DEFAULT_DURATION).toBe("2 小时");
    expect(DURATION_OPTIONS).toEqual(["1 小时", "2 小时", "3 小时", "4 小时", "5 小时", "6 小时", "7 小时", "8 小时"]);
    const byId = (id: string): string => defaultSpecsFor(MOMENT_TEMPLATES.find((t) => t.id === id)!).duration;
    expect(byId("coffee")).toBe("2 小时");
    expect(byId("citywalk")).toBe("4 小时");
    expect(byId("ride")).toBe("4 小时");
    // 归一：前导数字夹到 1–8，没数字的按词给，都没有回默认。
    expect(normalizeDuration("10 小时")).toBe("8 小时");
    expect(normalizeDuration("0")).toBe("1 小时");
    expect(normalizeDuration("半天")).toBe("4 小时");
    expect(normalizeDuration("全天")).toBe("8 小时");
    expect(normalizeDuration("  ")).toBe("2 小时");
    // 发布行恒为「N 小时」。
    const template = MOMENT_TEMPLATES[0]!;
    const legacy = buildDemandPublishInput(template, { ...defaultSpecsFor(template), duration: "半天" });
    expect(legacy.time).toBe("19:00 · 4 小时 · 1 人");
    expect(PublishMarketOpportunityInputSchema.safeParse(legacy).success).toBe(true);
  });

  it("falls back without ever emitting empty required fields", () => {
    const template = MOMENT_TEMPLATES[3]!;
    const input = buildDemandPublishInput(template, {
      ratio: "", time: "", duration: "", place: "", prefs: [], price: "0₫", notes: ""
    });
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
    expect(input.location).toBe(template.venue);
    // DEMAND-TIMESLOT-001：空时间也收敛到默认档，不再甩「近期」。
    expect(input.date).toBe("19:00");
    expect(input.time).toContain("19:00");
  });

  it("carries notes to desc only when present", () => {
    const template = MOMENT_TEMPLATES[0]!;
    const withNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "需要会说中文" });
    expect(withNotes.desc).toBe("需要会说中文");
    const withoutNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "   " });
    expect(withoutNotes.desc).toBeUndefined();
    expect(PublishMarketOpportunityInputSchema.safeParse(withNotes).success).toBe(true);
  });

  it("carries picked coordinates to lat/lng only when present", () => {
    // OPP-REAL-COORDS-001: 有选点带真坐标发布，无选点保持纯文字（两种都过契约）。
    const template = MOMENT_TEMPLATES[0]!;
    const withPin = buildDemandPublishInput(template, { ...defaultSpecsFor(template), lat: 21.05, lng: 105.8197 });
    expect(withPin.lat).toBe(21.05);
    expect(withPin.lng).toBe(105.8197);
    expect(PublishMarketOpportunityInputSchema.safeParse(withPin).success).toBe(true);
    const withoutPin = buildDemandPublishInput(template, defaultSpecsFor(template));
    expect(withoutPin.lat).toBeUndefined();
    expect(withoutPin.lng).toBeUndefined();
    expect(PublishMarketOpportunityInputSchema.safeParse(withoutPin).success).toBe(true);
  });
});

describe("R58 people filtering", () => {
  const person = (overrides: Partial<SupplierCandidate> = {}): SupplierCandidate => ({
    agentId: "a1",
    name: "Linh",
    photos: [],
    languages: ["中文"],
    serviceType: "CITY_COMPANION",
    referencePrice: 250000,
    currency: "₫",
    availability: { startAt: "2026-09-12T19:00:00+07:00", endAt: "2026-09-12T22:00:00+07:00", marketId: "hn" },
    eligibility: { eligible: true, capabilitiesOk: true, availabilityOk: true, marketOk: true },
    ...overrides
  });

  it("combines quick chips and sheet filters", async () => {
    const { filterSuppliers, DEFAULT_PEOPLE_FILTERS } = await import("./demand-moments");
    const people = [person(), person({ agentId: "a2", languages: ["English"], referencePrice: 600000 })];
    expect(filterSuppliers(people, [], DEFAULT_PEOPLE_FILTERS)).toHaveLength(2);
    expect(filterSuppliers(people, [], { ...DEFAULT_PEOPLE_FILTERS, language: "中文" })).toHaveLength(1);
    expect(filterSuppliers(people, [], { ...DEFAULT_PEOPLE_FILTERS, maxBudget: 300000 })).toHaveLength(1);
    expect(filterSuppliers(people, ["已认证"], DEFAULT_PEOPLE_FILTERS)).toHaveLength(2);
  });

  it("matches availability windows against day filters", async () => {
    const { filterSuppliers, DEFAULT_PEOPLE_FILTERS } = await import("./demand-moments");
    const fridayNoon = new Date("2026-09-11T12:00:00+07:00").getTime();
    const fridayNight = {
      availability: { startAt: "2026-09-11T19:00:00+07:00", endAt: "2026-09-11T22:00:00+07:00", marketId: "hn" }
    };
    expect(filterSuppliers(
      [person(fridayNight)], [], { ...DEFAULT_PEOPLE_FILTERS, day: "今晚" }, fridayNoon
    )).toHaveLength(1);
    expect(filterSuppliers(
      [person({ availability: { startAt: "2026-09-20T19:00:00+07:00", endAt: "2026-09-20T22:00:00+07:00", marketId: "hn" } })],
      [], { ...DEFAULT_PEOPLE_FILTERS, day: "今晚" }, fridayNoon
    )).toHaveLength(0);
    expect(filterSuppliers(
      [person({ availability: { startAt: "2026-09-12T19:00:00+07:00", endAt: "2026-09-12T22:00:00+07:00", marketId: "hn" } })],
      [], { ...DEFAULT_PEOPLE_FILTERS, day: "周末" }, fridayNoon
    )).toHaveLength(1);
  });
});

describe("ORDER-SCENARIO-001 publish carries the consumption scenario", () => {
  it("marks pro moments assistance and ordinary moments ordinary", () => {
    const pro = MOMENT_TEMPLATES.find((t) => t.id === "pro")!;
    const proInput = buildDemandPublishInput(pro, defaultSpecsFor(pro));
    expect(proInput.scenario).toBe("assistance");
    expect(PublishMarketOpportunityInputSchema.safeParse(proInput).success).toBe(true);
    const coffee = MOMENT_TEMPLATES.find((t) => t.id === "coffee")!;
    const coffeeInput = buildDemandPublishInput(coffee, defaultSpecsFor(coffee));
    expect(coffeeInput.scenario).toBe("ordinary");
    expect(PublishMarketOpportunityInputSchema.safeParse(coffeeInput).success).toBe(true);
  });
});
