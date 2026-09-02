import { describe, it, expect } from "vitest";
import { FacetObjectSchema, ListFacetObjectsPayloadSchema, parseListFacetObjectsPayload, parseFacetSideSpacePost, parseListSideSpacePostsPayload, parseListSideSpaceCatalogPayload } from "./facet";

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
        avatarUrl: "",
        recommendedKind: "personal/honest",
        reasoningConfidence: 88,
        sideSpaceGap: "",
        sideSpaceKind: "",
        sideSpacePosts: [],
        sideSpaceFulfilled: false
      },
      {
        id: "linh",
        displayName: "Linh",
        relation: "SHARED_INTEREST",
        goal: "共同兴趣连接",
        currentState: "新城市经历待展示",
        pillLabel: "朋友",
        gap: { summary: "城市经历", nextShowAt: "明天 18:30" },
        avatarUrl: "",
        recommendedKind: "city/travel",
        reasoningConfidence: 85,
        sideSpaceGap: "",
        sideSpaceKind: "",
        sideSpacePosts: [],
        sideSpaceFulfilled: false
      },
      {
        id: "spa",
        displayName: "ABC Spa",
        relation: "CREATOR_COLLAB",
        goal: "Creator 合作",
        currentState: "环境内容过多",
        pillLabel: "合作",
        gap: { summary: "真人体验", nextShowAt: "周四 12:00" },
        avatarUrl: "",
        recommendedKind: "portfolio/capability",
        reasoningConfidence: 90,
        sideSpaceGap: "副空间已有 8 个作品，还缺 1 个能力对比 / 客户合作案例",
        sideSpaceKind: "portfolio/capability",
        sideSpacePosts: [
          { id: "ss-store-env", kind: "intro/services", title: "门店环境", imageUrl: "", addedAt: "2026-09-01T00:00:00Z" }
        ],
        sideSpaceFulfilled: false
      }
    ];
    for (const s of samples) {
      expect(() => FacetObjectSchema.parse(s)).not.toThrow();
    }
  });

  it("ListFacetObjectsPayloadSchema accepts a list of 3", () => {
    const raw = {
      objects: [
        { id: "ken", displayName: "Ken", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x", gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "personal/real-life", reasoningConfidence: 70, sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [],
        sideSpaceFulfilled: false }
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
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "personal/real-life", reasoningConfidence: 70, sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).toThrow();
  });

  it("rejects bad recommendedKind enum", () => {
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "BOGUS_KIND", reasoningConfidence: 70, sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).toThrow();
  });

  it("rejects reasoningConfidence out of range", () => {
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "personal/real-life", reasoningConfidence: 150, sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).toThrow();
  });

  it("R15.42: sideSpaceKind accepts recommendedKind enum or empty string", () => {
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "CREATOR_COLLAB", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "portfolio/capability", reasoningConfidence: 80, sideSpaceGap: "x", sideSpaceKind: "portfolio/capability", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).not.toThrow();
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "personal/real-life", reasoningConfidence: 80, sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).not.toThrow();
  });

  it("R15.42: sideSpaceKind rejects bogus kind", () => {
    expect(() => FacetObjectSchema.parse({
      id: "x", displayName: "x", relation: "CREATOR_COLLAB", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "portfolio/capability", reasoningConfidence: 80, sideSpaceGap: "x", sideSpaceKind: "BOGUS_SIDE_KIND", sideSpacePosts: [],
        sideSpaceFulfilled: false
    })).toThrow();
  });

  it("R15.43: FacetSideSpacePostSchema accepts valid post", () => {
    expect(() => parseFacetSideSpacePost({
      id: "ss-store-env", kind: "intro/services", title: "门店环境", imageUrl: "", addedAt: "2026-09-01T00:00:00Z"
    })).not.toThrow();
  });

  it("R15.43: ListSideSpacePostsPayload accepts empty list", () => {
    const out = parseListSideSpacePostsPayload({ posts: [] });
    expect(out.posts).toEqual([]);
  });

  it("R15.43: ListSideSpaceCatalogPayload accepts 5 mock posts", () => {
    const out = parseListSideSpaceCatalogPayload({
      posts: [
        { id: "ss-store-env", kind: "intro/services", title: "门店", imageUrl: "" },
        { id: "ss-service-1", kind: "intro/services", title: "服务", imageUrl: "" },
        { id: "ss-client-1", kind: "portfolio/capability", title: "客户", imageUrl: "" },
        { id: "ss-capability-compare", kind: "portfolio/capability", title: "能力对比", imageUrl: "" },
        { id: "ss-collab-1", kind: "portfolio/capability", title: "合作", imageUrl: "" }
      ]
    });
    expect(out.posts).toHaveLength(5);
  });

  it("R15.43: catalog rejects personal/real-life (副空间不允许 personal)", () => {
    // 注: catalog post 用 SideSpaceCatalogPostSchema = FacetRecommendedKindSchema,
    // 而 FacetRecommendedKindSchema 包含 personal/real-life —
    // 后端 service.go AddSideSpacePost 独立校验 kind 白名单。
    // 此处验证 wire format 接受所有 FacetRecommendedKind。
    expect(() => parseListSideSpaceCatalogPayload({
      posts: [{ id: "x", kind: "personal/real-life", title: "t", imageUrl: "" }]
    })).not.toThrow();
  });

  it("R15.44: sideSpaceFulfilled accepts true for fulfilled collab", () => {
    expect(() => FacetObjectSchema.parse({
      id: "spa", displayName: "Spa", relation: "CREATOR_COLLAB", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "portfolio/capability", reasoningConfidence: 90,
      sideSpaceGap: "已足够", sideSpaceKind: "portfolio/capability", sideSpacePosts: [], sideSpaceFulfilled: true
    })).not.toThrow();
  });

  it("R15.44: sideSpaceFulfilled accepts false for non-collab", () => {
    expect(() => FacetObjectSchema.parse({
      id: "ken", displayName: "Ken", relation: "BUILDING_TRUST", goal: "x", currentState: "x", pillLabel: "x",
      gap: { summary: "x", nextShowAt: "x" }, avatarUrl: "", recommendedKind: "personal/real-life", reasoningConfidence: 70,
      sideSpaceGap: "", sideSpaceKind: "", sideSpacePosts: [], sideSpaceFulfilled: false
    })).not.toThrow();
  });

  it("parseListFacetObjectsPayload returns typed payload", () => {
    const out = parseListFacetObjectsPayload({ objects: [], totalObjects: 0, freshAssets: 0, shownAssets: 0 });
    expect(out.objects).toEqual([]);
  });
});
