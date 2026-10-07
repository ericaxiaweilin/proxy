import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-SCENE-HEADER-001（2026-10-07，用户：「附近的咖啡馆 7 家 / 推荐 / 附近 /
// 筛选 代替那些废话」）：内嵌选场景（发布向导）头部只留标题 + 计数 + 三颗。
// 定位说明行和收藏 / 去过两颗不进内嵌（浏览页 home 照旧）；筛选挂现成的区域过滤，
// 点开平铺，不套第二层滚动。
//
// 这条钉守的是「内嵌头部别长回说明行和四颗排序」：谁把浏览那套搬回内嵌，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-SCENE-HEADER-001 内嵌选场景头部只有标题计数和三颗", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./scene-shop-directory.tsx", import.meta.url)),
    "utf8"
  );

  it("三颗在：推荐 / 附近 / 筛选", () => {
    expect(src).toContain("排序 推荐");
    expect(src).toContain("排序 附近");
    expect(src).toContain("按区域筛选");
  });

  it("定位说明行只在浏览分支（被 !embedded 守着），内嵌分支里没有", () => {
    // 全文件只有一个渲染点，且紧跟在守卫后面 —— 内嵌分支（"{embedded ? (" 那段）
    // 里没有第二个，数出来就是 1。
    expect((src.match(/styles\.listLocation/g) ?? []).length).toBe(1);
    expect(src).toContain("{!embedded ? (\n              <Text selectable style={styles.listLocation}>");
  });

  it("筛选点开是现成的区域过滤，平铺不套滚", () => {
    expect(src).toContain("filterOpen");
    expect(src).toContain("pickFilterAreas");
    expect(src).toContain("toggleArea(area)");
  });

  it("浏览分支不动：说明行和四颗排序还在", () => {
    expect(src).toContain("styles.listLocation");
    expect(src).toContain("sorts.map");
  });
});
