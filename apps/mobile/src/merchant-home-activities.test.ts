import { describe, expect, it } from "vitest";
import { loadOwnMerchantActivities, ownMerchantActivities, primaryStoreScene } from "./merchant-home-activities";

const a = (activityId: string, venueName: string, extra: Record<string, string> = {}) => ({ activityId, venueName, ...extra });

describe("MERCHANT-HOME-OWN-ACTIVITIES-001 商家首页只看本店活动", () => {
  const stores = [{ name: "Three Beans Coffee", realitySceneId: "threebeans" }];
  it("别家店的活动不出现（咖啡店首页不再出现餐厅的尝鲜晚餐）", () => {
    const list = [a("lt_dinner", "岚庭", { realitySceneId: "lanting" }), a("tb_coffee", "Three Beans", { realitySceneId: "threebeans" })];
    expect(ownMerchantActivities(list, stores).map((x) => x.activityId)).toEqual(["tb_coffee"]);
  });
  it("场景没挂上时按门店名认；已取消的不算", () => {
    const list = [a("by_name", "Three Beans Coffee"), a("gone", "Three Beans Coffee", { status: "CANCELLED" })];
    expect(ownMerchantActivities(list, stores).map((x) => x.activityId)).toEqual(["by_name"]);
  });
  it("有封面的排前面，其余新的在前", () => {
    const list = [
      a("old_cover", "x", { realitySceneId: "threebeans", coverMediaAssetId: "m1" }),
      a("no_cover", "x", { realitySceneId: "threebeans" }),
      a("new_cover", "x", { realitySceneId: "threebeans", coverMediaAssetId: "m2" }),
    ];
    expect(ownMerchantActivities(list, stores).map((x) => x.activityId)).toEqual(["new_cover", "old_cover", "no_cover"]);
  });
  it("本账号没有门店 → 空，不拿全平台的凑数", () => {
    expect(ownMerchantActivities([a("x", "y", { realitySceneId: "s" })], [])).toEqual([]);
  });
});

describe("MERCHANT-HOME-OWN-ACTIVITIES-001 首页 / 我的共用一个取数入口", () => {
  it("loader 按当前账号门店过滤；没门店不请求、返回空", async () => {
    let calls = 0;
    const client = { listActivities: async () => { calls += 1; return [a("mine", "x", { realitySceneId: "threebeans" }), a("other", "y", { realitySceneId: "lanting" })]; } };
    expect((await loadOwnMerchantActivities(client, [{ name: "TB", realitySceneId: "threebeans" }])).map((x) => x.activityId)).toEqual(["mine"]);
    expect(await loadOwnMerchantActivities(client, [])).toEqual([]);
    expect(calls).toBe(1);
  });
  it("场景运营读门店认领的场景，没认领就是 undefined（不写死 threebeans）", () => {
    expect(primaryStoreScene([{ name: "BN" }, { name: "CG", realitySceneId: "threebeans" }])).toEqual({ sceneId: "threebeans", storeName: "CG" });
    expect(primaryStoreScene([{ name: "BN", realitySceneId: "" }])).toBeUndefined();
  });
});
