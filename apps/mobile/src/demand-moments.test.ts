import { describe, expect, it } from "vitest";
import { PublishMarketOpportunityInputSchema } from "@proxy/contracts";
import type { SupplierCandidate } from "./supply-client";
import { buildDemandPublishInput, defaultSpecsFor, MOMENT_TEMPLATES } from "./demand-moments";

describe("R58 demand wizard mapping", () => {
  it("ships moment templates with defaults", () => {
    expect(MOMENT_TEMPLATES.map((template) => template.id)).toEqual(
      ["coffee", "meal", "ktv", "photo", "citywalk", "exhibition", "pro"]
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
      ratio: "1:1",
      time: "今晚 19:00",
      duration: "2 小时",
      place: "西湖",
      prefs: ["公共场所见面", "中文"],
      price: "200,000₫"
    });
    expect(input.title).toBe("喝咖啡");
    expect(input.moneyFlow).toBe("EARN");
    expect(input.time).toContain("今晚 19:00");
    expect(input.skills).toContain("公共场所见面");
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
  });

  it("falls back without ever emitting empty required fields", () => {
    const template = MOMENT_TEMPLATES[3]!;
    const input = buildDemandPublishInput(template, {
      ratio: "", time: "", duration: "", place: "", prefs: [], price: "0₫", notes: ""
    });
    expect(PublishMarketOpportunityInputSchema.safeParse(input).success).toBe(true);
    expect(input.location).toBe(template.venue);
  });

  it("carries notes to desc only when present", () => {
    const template = MOMENT_TEMPLATES[0]!;
    const withNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "需要会说中文" });
    expect(withNotes.desc).toBe("需要会说中文");
    const withoutNotes = buildDemandPublishInput(template, { ...defaultSpecsFor(template), notes: "   " });
    expect(withoutNotes.desc).toBeUndefined();
    expect(PublishMarketOpportunityInputSchema.safeParse(withNotes).success).toBe(true);
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
