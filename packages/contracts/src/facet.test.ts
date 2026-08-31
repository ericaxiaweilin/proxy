import { describe, it, expect } from "vitest";
import { FacetObjectSchema, ListFacetObjectsPayloadSchema, parseListFacetObjectsPayload } from "./facet";

describe("FACET contracts", () => {
  it("FacetObjectSchema accepts the 3 prototype rows", () => {
    const samples = [
      {
        id: "ken",
        displayName: "小帅 Ken",
        relation: "BUILDING_TRUST",
        goal: "加强熟悉感与信任",
        currentState: "进行中",
        pillLabel: "重点关系",
        gap: { summary: "真人互动", nextShowAt: "今晚 20:00" },
        avatarUrl: ""
      },
      {
        id: "linh",
        displayName: "Linh",
        relation: "SHARED_INTEREST",
        goal: "共同兴趣连接",
        currentState: "新城市经历待展示",
        pillLabel: "朋友",
        gap: { summary: "城市经历", nextShowAt: "明天 18:30" },
        avatarUrl: ""
      },
      {
        id: "spa",
        displayName: "ABC Spa",
        relation: "CREATOR_COLLAB",
        goal: "Creator 合作",
        currentState: "环境内容过多",
        pillLabel: "合作",
        gap: { summary: "真人体验", nextShowAt: "周四 12:00" },
        avatarUrl: ""
      }
    ];
    for (const s of samples) {
      expect(() => FacetObjectSchema.parse(s)).not.toThrow();
    }
  });

  it("ListFacetObjectsPayloadSchema accepts a list of 3", () => {
    const raw = {
      objects: [
        { id: "ken", displayName: "Ken", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x", gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "" }
      ],
      totalObjects: 1,
      freshAssets: 5,
      shownAssets: 16
    };
    expect(() => ListFacetObjectsPayloadSchema.parse(raw)).not.toThrow();
  });

  it("rejects bad relation enum", () => {
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "BAD", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: ""
    })).toThrow();
  });

  it("parseListFacetObjectsPayload returns typed payload", () => {
    const out = parseListFacetObjectsPayload({ objects: [], totalObjects: 0, freshAssets: 0, shownAssets: 0 });
    expect(out.objects).toEqual([]);
  });
});
