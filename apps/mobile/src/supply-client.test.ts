import { describe, expect, it } from "vitest";
import { parseCollabInvitations, parsePromoBenefit, parsePromoCode, parsePromoQuote, parsePromoStats, parseSupplierCandidates, parseSupplyBody, SupplyProtocolError } from "./supply-client";

describe("merchant creator recommendations", () => {
  it("MERCHANT-CREATOR-001 keeps real photo, availability and eligibility evidence", () => {
    expect(parseSupplierCandidates([{ agentId: "creator_1", name: "Linh", photos: ["https://cdn.proxy.test/linh.jpg"], languages: ["VI", "ZH"], serviceType: "CITY_COMPANION", referencePrice: 1200000, currency: "VND", availability: { startAt: "2026-09-06T02:00:00Z", endAt: "2026-09-06T10:00:00Z", marketId: "hn" }, eligibility: { eligible: true, capabilitiesOk: true, availabilityOk: true, marketOk: true } }])).toEqual([expect.objectContaining({ agentId: "creator_1", photos: ["https://cdn.proxy.test/linh.jpg"], availability: expect.objectContaining({ marketId: "hn" }), eligibility: expect.objectContaining({ eligible: true }) })]);
  });

  it("drops malformed records instead of inventing creators", () => {
    expect(parseSupplierCandidates([{ name: "fake" }, null, "creator"])).toEqual([]);
  });

  it("MERCHANT-CREATOR-TAGS-001 keeps verified capabilities, drops junk", () => {
    const withCaps = parseSupplierCandidates([{ agentId: "c1", name: "A", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, verifiedCapabilities: ["ZH", "PHOTOGRAPHY", 42, ""] }]);
    expect(withCaps).toHaveLength(1);
    expect(withCaps[0]?.verifiedCapabilities).toEqual(["ZH", "PHOTOGRAPHY"]);
    const withoutCaps = parseSupplierCandidates([{ agentId: "c2", name: "B", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {} }]);
    expect(withoutCaps).toHaveLength(1);
    expect(withoutCaps[0]?.verifiedCapabilities).toEqual([]);
  });
  it("MERCHANT-CREATOR-TAGS-001 keeps socials, drops malformed entries", () => {
    const parsed = parseSupplierCandidates([{ agentId: "c3", name: "C", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, socials: [{ platform: "tiktok", handle: "linh_hanoi" }, { platform: "x" }, null, "s"] }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.socials).toEqual([{ platform: "tiktok", handle: "linh_hanoi", followerCount: 0 }]);
    const absent = parseSupplierCandidates([{ agentId: "c4", name: "D", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {} }]);
    expect(absent[0]?.socials).toEqual([]);
  });
  it("MERCHANT-CREATOR-TAGS-001 社媒粉丝数字段必有，缺失记 0", () => {
    const socials = parseSupplierCandidates([{ agentId: "c6", name: "F", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, socials: [{ platform: "tiktok", handle: "linh_hanoi", followerCount: 24000 }, { platform: "zalo", handle: "x" }] }]);
    expect(socials[0]?.socials).toEqual([
      { platform: "tiktok", handle: "linh_hanoi", followerCount: 24000 },
      { platform: "zalo", handle: "x", followerCount: 0 },
    ]);
  });

  it("MERCHANT-CREATOR-TAGS-001 评价分透出服务端 Total，非数不编", () => {
    const parsed = parseSupplierCandidates([{ agentId: "c7", name: "G", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, rating: { total: 87.5, hasTrackRecord: true, satisfactionRate: 0.9, fulfillmentRate: 1, completedOrders: 12 } }]);
    expect(parsed[0]?.rating).toEqual({ total: 87.5, hasTrackRecord: true, satisfactionRate: 0.9, fulfillmentRate: 1, completedOrders: 12 });
    const legacy = parseSupplierCandidates([{ agentId: "c8", name: "H", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {} }]);
    expect(legacy[0]?.rating).toBeUndefined();
  });
  it("MERCHANT-CREATOR-INVITE-001 邀约解析：区间+目的+可谈，缺件/坏状态直接丢掉", () => {
    const parsed = parseCollabInvitations([
      { id: "ci_1", merchantId: "m1", agentId: "a1", serviceType: "CITY_COMPANION", status: "PENDING", priceMinVnd: 800000, priceMaxVnd: 1500000, negotiable: true, purpose: "UGC", startAt: "2026-10-12T00:00:00+07:00", durationH: 8, createdAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-07T00:00:00Z" },
      { id: "ci_2", merchantId: "m1", agentId: "a1", serviceType: "CITY_COMPANION", status: "COUNTERED", priceMinVnd: 1000000, priceMaxVnd: 1000000, negotiable: false, purpose: "SALES", termsVersion: 2, counterBy: "a1", createdAt: "2026-10-04T00:00:00Z", expiresAt: "2026-10-07T00:00:00Z" },
      { id: "", merchantId: "m1", agentId: "a1", status: "PENDING", createdAt: "x", expiresAt: "y" },
      { id: "ci_3", merchantId: "m1", agentId: "a1", status: "WEIRD", createdAt: "x", expiresAt: "y" },
      null,
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.priceMinVnd).toBe(800000);
    expect(parsed[0]?.priceMaxVnd).toBe(1500000);
    expect(parsed[0]?.purpose).toBe("UGC");
    expect(parsed[0]?.startAt).toBe("2026-10-12T00:00:00+07:00");
    expect(parsed[0]?.durationH).toBe(8);
    expect(parsed[1]?.status).toBe("COUNTERED");
    expect(parsed[1]?.negotiable).toBe(false);
    expect(parsed[1]?.termsVersion).toBe(2);
    expect(parseCollabInvitations(undefined)).toEqual([]);
  });
  it("MERCHANT-CREATOR-TAGS-001 keeps vertical tags raw, drops junk", () => {
    const parsed = parseSupplierCandidates([{ agentId: "c5", name: "E", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, verticalTags: ["RESTAURANT", "KTV", 7, ""] }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.verticalTags).toEqual(["RESTAURANT", "KTV"]);
  });
  it("MERCHANT-CREATOR-TAGS-001 keeps verified capabilities, drops junk", () => {
    const withCaps = parseSupplierCandidates([{ agentId: "c1", name: "A", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {}, verifiedCapabilities: ["ZH", "PHOTOGRAPHY", 42, ""] }]);
    expect(withCaps).toHaveLength(1);
    expect(withCaps[0]?.verifiedCapabilities).toEqual(["ZH", "PHOTOGRAPHY"]);
    const withoutCaps = parseSupplierCandidates([{ agentId: "c2", name: "B", photos: [], languages: [], serviceType: "", referencePrice: 0, currency: "VND", eligibility: {} }]);
    expect(withoutCaps).toHaveLength(1);
    expect(withoutCaps[0]?.verifiedCapabilities).toEqual([]);
  });
});

// SUPPLY-BODY-001: 服务端 payload 解析失败必须**抛**，不能返回空对象 ——
// 空对象跟"成功但没有数据"完全一样，供给列表会显示 0 个人而不是显示失败。
describe("parseSupplyBody (server payload decoding)", () => {
  it("returns an empty body when the command carried no payload at all", () => {
    expect(parseSupplyBody(undefined)).toEqual({});
    expect(parseSupplyBody("")).toEqual({});
  });

  it("throws instead of returning {} when the payload is not valid JSON", () => {
    expect(() => parseSupplyBody("{oops")).toThrow(SupplyProtocolError);
  });

  it("throws when the payload parses but is not an object", () => {
    expect(() => parseSupplyBody("42")).toThrow(SupplyProtocolError);
    expect(() => parseSupplyBody("null")).toThrow(SupplyProtocolError);
    expect(() => parseSupplyBody('"just a string"')).toThrow(SupplyProtocolError);
  });

  it("returns the decoded object for a well-formed payload", () => {
    expect(parseSupplyBody('{"suppliers":[]}')).toEqual({ suppliers: [] });
  });
});

describe("merchant promo codes (MERCHANT-CREATOR-PROMO-001)", () => {
  it("parses code/benefit/quote, drops malformed entries", () => {
    expect(parsePromoCode({ code: "LINH88", agentId: "a1", status: "ACTIVE", createdAt: "x" })?.code).toBe("LINH88");
    expect(parsePromoCode({ code: "", agentId: "a1", createdAt: "x" })).toBeUndefined();
    expect(parsePromoBenefit({ merchantId: "m1", code: "LINH88", faceValueVnd: 50000, scopeName: "全场" })?.faceValueVnd).toBe(50000);
    expect(parsePromoBenefit({ merchantId: "m1", code: "" })).toBeUndefined();
    expect(parsePromoQuote({ id: "pq_1", merchantId: "m1", code: "LINH88", quotedAt: "x", firstVisit: true })?.firstVisit).toBe(true);
    expect(parsePromoQuote({ id: "", merchantId: "m1", code: "X", quotedAt: "x" })).toBeUndefined();
  });
  it("parses stats, unknown shape falls back to zeros", () => {
    const stats = parsePromoStats({ byCode: { LINH88: { quotes: 2, firstVisits: 1, attributedVnd: 300000, discountGivenVnd: 100000 } }, quotes: 2, firstVisits: 1, attributedVnd: 300000, discountGivenVnd: 100000 });
    expect(stats.quotes).toBe(2);
    expect(stats.byCode.LINH88?.attributedVnd).toBe(300000);
    expect(parsePromoStats(undefined)).toEqual({ byCode: {}, quotes: 0, firstVisits: 0, attributedVnd: 0, discountGivenVnd: 0 });
  });
});
