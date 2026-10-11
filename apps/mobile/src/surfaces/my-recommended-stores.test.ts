import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StoreRecommendation } from "../storeonboarding-client";
import { acceptedRecs, recMetaLine } from "./store-recommendation-manage-model";

// STORE-REC-BUILDER-001（2026-10-11，用户：「我的店铺 是已经推荐入平台的 list，但是目前做成跟商家侧的
// 功能了，这个不是商家侧的功能」）：用户侧「我的店铺」= 我推荐、已被运营采纳的店。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const component = readFileSync(here("./my-recommended-stores.tsx"), "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = strip(component);

function rec(partial: Partial<StoreRecommendation>): StoreRecommendation {
  return {
    recommendationId: "rec_1", storeName: "静心茶馆", city: "河内", category: "茶馆", reason: "环境好",
    recommendedByAccountId: "user_1", origin: "USER", createdAt: "2026-10-01T02:00:00Z", ...partial
  };
}

describe("acceptedRecs：只留已采纳的，按采纳时间新到旧", () => {
  it("过滤掉待评估和未采纳", () => {
    const rows = [
      rec({ recommendationId: "a", decision: "ACCEPT", decidedAt: "2026-10-05T00:00:00Z" }),
      rec({ recommendationId: "b" }),
      rec({ recommendationId: "c", decision: "REJECT", decidedAt: "2026-10-06T00:00:00Z" })
    ];
    expect(acceptedRecs(rows).map((r) => r.recommendationId)).toEqual(["a"]);
  });

  it("按采纳时间倒序；没有采纳时间的排后面，再按推荐时间", () => {
    const rows = [
      rec({ recommendationId: "old", decision: "ACCEPT", decidedAt: "2026-10-02T00:00:00Z" }),
      rec({ recommendationId: "new", decision: "ACCEPT", decidedAt: "2026-10-09T00:00:00Z" }),
      rec({ recommendationId: "nodate-late", decision: "ACCEPT", createdAt: "2026-10-08T00:00:00Z" }),
      rec({ recommendationId: "nodate-early", decision: "ACCEPT", createdAt: "2026-10-03T00:00:00Z" })
    ];
    expect(acceptedRecs(rows).map((r) => r.recommendationId)).toEqual(["new", "old", "nodate-late", "nodate-early"]);
  });

  it("不改入参", () => {
    const rows = [rec({ recommendationId: "x", decision: "ACCEPT" })];
    acceptedRecs(rows);
    expect(rows).toHaveLength(1);
  });
});

describe("recMetaLine：缺哪个就不写哪个", () => {
  it("品类 · 城市", () => {
    expect(recMetaLine(rec({}))).toBe("茶馆 · 河内");
    expect(recMetaLine(rec({ category: "" }))).toBe("河内");
    expect(recMetaLine(rec({ category: "", city: "  " }))).toBe("");
  });
});

describe("STORE-REC-BUILDER-001 这一页不是商家侧：没有任何经营功能", () => {
  it("读的是推荐记录，不是商家名下的店", () => {
    expect(code).toContain("listMyRecommendations");
    expect(code).toContain("acceptedRecs");
    for (const merchantOnly of ["BusinessClient", "FulfillmentClient", "StoreOrderStats", "getStoreOrderStats", "MerchantStorefrontSurface", "StoreQrCard"]) {
      expect(code, `builder 的「我的店铺」不该出现商家侧的 ${merchantOnly}`).not.toContain(merchantOnly);
    }
  });

  it("没有订单统计 / 品类编辑 / 营业时间 / 打电话 / 二维码 / 建店入口", () => {
    for (const word of ["满意", "复购", "接单", "营业时间", "tel:", "品类", "二维码", "建店", "SetStoreCategory", "onOpenStoreCreate"]) {
      // 「品类」只允许作为推荐记录自带的 category 字段展示，不允许出现「编辑品类」这类动作文案。
      if (word === "品类") continue;
      expect(code, `出现了商家侧的「${word}」`).not.toContain(word);
    }
    expect(code).not.toContain("editCategory");
  });

  it("词汇守「采纳 ≠ 店铺已存在」：不写已签约 / 已入驻", () => {
    expect(code).not.toContain("已签约");
    expect(code).not.toContain("已入驻");
  });

  it("空态的唯一出口是去店铺推荐，而不是建店", () => {
    expect(code).toContain("onOpenRecommend");
    expect(code).toContain("去推荐一家");
  });
});
