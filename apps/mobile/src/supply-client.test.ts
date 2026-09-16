import { describe, expect, it } from "vitest";
import { parseSupplierCandidates, parseSupplyBody, SupplyProtocolError } from "./supply-client";

describe("merchant creator recommendations", () => {
  it("MERCHANT-CREATOR-001 keeps real photo, availability and eligibility evidence", () => {
    expect(parseSupplierCandidates([{ agentId: "creator_1", name: "Linh", photos: ["https://cdn.proxy.test/linh.jpg"], languages: ["VI", "ZH"], serviceType: "CITY_COMPANION", referencePrice: 1200000, currency: "VND", availability: { startAt: "2026-09-06T02:00:00Z", endAt: "2026-09-06T10:00:00Z", marketId: "hn" }, eligibility: { eligible: true, capabilitiesOk: true, availabilityOk: true, marketOk: true } }])).toEqual([expect.objectContaining({ agentId: "creator_1", photos: ["https://cdn.proxy.test/linh.jpg"], availability: expect.objectContaining({ marketId: "hn" }), eligibility: expect.objectContaining({ eligible: true }) })]);
  });

  it("drops malformed records instead of inventing creators", () => {
    expect(parseSupplierCandidates([{ name: "fake" }, null, "creator"])).toEqual([]);
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

