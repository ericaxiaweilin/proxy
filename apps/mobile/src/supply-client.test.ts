import { describe, expect, it } from "vitest";
import { parseSupplierCandidates } from "./supply-client";

describe("merchant creator recommendations", () => {
  it("MERCHANT-CREATOR-001 keeps real photo, availability and eligibility evidence", () => {
    expect(parseSupplierCandidates([{ agentId: "creator_1", name: "Linh", photos: ["https://cdn.proxy.test/linh.jpg"], languages: ["VI", "ZH"], serviceType: "CITY_COMPANION", referencePrice: 1200000, currency: "VND", availability: { startAt: "2026-09-06T02:00:00Z", endAt: "2026-09-06T10:00:00Z", marketId: "hn" }, eligibility: { eligible: true, capabilitiesOk: true, availabilityOk: true, marketOk: true } }])).toEqual([expect.objectContaining({ agentId: "creator_1", photos: ["https://cdn.proxy.test/linh.jpg"], availability: expect.objectContaining({ marketId: "hn" }), eligibility: expect.objectContaining({ eligible: true }) })]);
  });

  it("drops malformed records instead of inventing creators", () => {
    expect(parseSupplierCandidates([{ name: "fake" }, null, "creator"])).toEqual([]);
  });
});
