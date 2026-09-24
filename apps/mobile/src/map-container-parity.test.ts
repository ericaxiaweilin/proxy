import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MAP-CONTAINER-PARITY-001: Home（场景全屏页）/ Market（内联卡）/ 发布器
// （map-canvas + picker wrapper）三处地图容器曾经各说各话 —— Market 高 330
// 圆角 19、场景页 flex:1 无保底高度、发布器正方形 280/圆角 12/紫钮，
// 同一张地图在三个入口三种尺寸三种语言。统一到内联 330 + 圆角 22
//（foundation.radius.lg）+ 边框 color.line + 底 color.offWhite；
// 全屏页保留 flex:1 但 minHeight:330 保底。
describe("MAP-CONTAINER-PARITY-001", () => {
  const market = readFileSync(fileURLToPath(new URL("./surfaces/market.tsx", import.meta.url)), "utf8");
  const scene = readFileSync(
    fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)),
    "utf8"
  );
  const canvas = readFileSync(
    fileURLToPath(new URL("./components/map-canvas.tsx", import.meta.url)),
    "utf8"
  );
  const picker = readFileSync(
    fileURLToPath(new URL("./components/location-picker-sheet.tsx", import.meta.url)),
    "utf8"
  );

  it("market inline card keeps height 330 and radius 22", () => {
    expect(market).toMatch(/geoMap:\s*\{[^}]*height:\s*330[^}]*\}/);
    expect(market).toMatch(/geoMap:\s*\{[^}]*borderRadius:\s*22[^}]*\}/);
    expect(market).toContain("MAP-CONTAINER-PARITY-001");
  });

  it("scene fullscreen page shares the container language with a 330 floor", () => {
    expect(scene).toMatch(/mapWrap:\s*\{[^}]*borderRadius:\s*22[^}]*\}/);
    expect(scene).toMatch(/mapWrap:\s*\{[^}]*minHeight:\s*330[^}]*\}/);
    expect(scene).toContain("MAP-CONTAINER-PARITY-001");
  });

  it("composer canvas drops the square aspect and matches 330/22/line", () => {
    expect(canvas).toMatch(/canvas:\s*\{[^}]*height:\s*330[^}]*\}/);
    expect(canvas).toMatch(/canvas:\s*\{[^}]*borderRadius:\s*22[^}]*\}/);
    expect(canvas).not.toMatch(/canvas:\s*\{[^}]*aspectRatio:\s*1[^}]*\}/);
    expect(canvas).toContain("MAP-CONTAINER-PARITY-001");
  });

  it("picker wrapper matches 330/22", () => {
    expect(picker).toMatch(/mapWrapper:\s*\{[^}]*height:\s*330[^}]*\}/);
    expect(picker).toMatch(/mapWrapper:\s*\{[^}]*borderRadius:\s*22[^}]*\}/);
    expect(picker).toContain("MAP-CONTAINER-PARITY-001");
  });

  it("market map toggle uses the 折叠地图 logo, map canvas keeps generic route", () => {
    // MAP-FOOTPRINT-LOGO-001：市场头部去地图的切换按钮用原型折叠地图，
    // 不再用通用 route；定位按钮（map-canvas 内）保持 route 不动。
    expect(market).toContain('name={view === "MAP" ? "storeLines" : "mapFold"}');
    // 48 栅格原画显小一圈：mapFold 用 26，比旁边的 + 号（18）大一圈。
    expect(market).toContain('size={view === "MAP" ? 18 : 26}');
    expect(canvas).toContain('name="route"');
    const icon = readFileSync(
      fileURLToPath(new URL("./components/proxy-icon.tsx", import.meta.url)),
      "utf8",
    );
    // 原型 deepseek_html_20260923_5c4a22.html 几何原样移植：三折外轮廓 +
    // 两条折痕 + 右上苹果绿状态点；场景足迹：镜头圈 + 轨迹 + 起终点。
    expect(icon).toContain('case "mapFold"');
    expect(icon).toContain("M14 18 L22 12 L30 18 L36 15 L36 32 L28 38 L20 32 L14 35 Z");
    expect(icon).toContain("#34C759");
    expect(icon).toContain('case "footprint"');
    expect(icon).toContain("M11 26C16 19 24 33 37 22");
  });

  it("locate buttons are icon-only with no explanatory text", () => {
    const locateBtn = market.match(/testID="market-map-locate"[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    expect(locateBtn).toContain("ProxyIcon");
    expect(locateBtn).not.toContain("<Text");
    expect(canvas).toContain('name="route"');
    expect(canvas).not.toMatch(/<Text style=\{styles\.locButtonText\}>/);
  });

  it("granted locate state stays visible (no white-on-white)", () => {
    // 白字只许出现在 ink 底上：白底按钮 + 白字/白图标就是之前的隐形 bug。
    expect(market).not.toContain("geoLocateBtnTextOn");
    expect(market).toMatch(/geoLocateBtnOn:\s*\{[^}]*backgroundColor:\s*color\.ink[^}]*\}/);
  });

  it("market map shows the map only, no explanatory card below", () => {
    expect(market).not.toContain("geoPrivacy");
    expect(market).not.toContain("地址粒度");
  });

  it("market pins cluster and spread on tap", () => {
    // 图钉多了重叠点不了：订单钉 + 探索点统一进 clusterPins，簇点放大散开；
    // 活动 tab 仍不渲染订单钉（点开串详情，沿用旧语义）。
    expect(market).toContain("clusterPins(pinInputs");
    expect(market).toContain('testID="market-map-cluster"');
    expect(market).toContain("zoomToCluster");
    expect(market).toContain("onRegionChangeComplete");
    expect(market).toContain('tab === "OPPORTUNITY"');
  });

  it("opportunity pins prefer server lat/lng over grid projection", () => {
    // OPP-REAL-COORDS-001: 服务端下发真坐标（种子是真实 venue 点），地图之前
    // 只认从没人写的 o.coord，订单钉一个都渲染不出来。真坐标优先 + 有限值守卫，
    // grid 投影只留兼容。
    expect(market).toContain("OPP-REAL-COORDS-001");
    expect(market).toMatch(/typeof o\.lat === "number" && typeof o\.lng === "number"/);
    expect(market).toContain("Number.isFinite(o.lat) && Number.isFinite(o.lng)");
  });

  it("market map supports fullscreen with a single shared map instance", () => {
    // MAP-FULLSCREEN-001: 右上全屏入口 + 全屏 Modal（标题 + 收起）；
    // mapBody 单实例在内联/全屏二选一挂载，定位态不断。
    expect(market).toContain('testID="market-map-expand"');
    expect(market).toContain('testID="market-map-collapse"');
    expect(market).toContain("MAP-FULLSCREEN-001");
    expect(market).toContain("{fullscreen ? null : mapBody}");
    expect(market).toMatch(/mapFsBody:\s*\{[^}]*flex:\s*1[^}]*\}/);
    const fsBody = market.match(/mapFsBody:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(fsBody).not.toContain("height: 330");
    // 全屏/收起钮只留图标，不挂解释性文字。
    expect(market).not.toContain("⛶ 全屏");
    expect(market).not.toContain("✕ 收起");
  });

  it("market map view is full-bleed on both tabs (no side gap)", () => {
    // 根因：contentFlat（横向 padding 清零）只给订单 tab，活动 tab 缩进 18。
    expect(market).toContain('view === "MAP" || pageTab === "OPPORTUNITY" ? styles.contentFlat : null');
  });

  it("no map container carries a side gap", () => {
    const marketWrap = market.match(/mapWrap:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(marketWrap).not.toContain("marginHorizontal");
    expect(marketWrap).not.toContain("paddingHorizontal");
    const sceneWrap = scene.match(/mapWrap:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(sceneWrap).not.toContain("marginHorizontal");
    const geoMap = market.match(/geoMap:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(geoMap).not.toContain("marginHorizontal");
    const pickerWrap = picker.match(/mapWrapper:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(pickerWrap).not.toContain("marginHorizontal");
    const canvasBlock = canvas.match(/canvas:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(canvasBlock).not.toContain("marginHorizontal");
  });

  it("demand wizard embeds the unified place picker", () => {
    // OPP-REAL-COORDS-001: 发布器地点下嵌地图，点选带真坐标发布。
    const wizard = readFileSync(fileURLToPath(new URL("./surfaces/demand-wizard.tsx", import.meta.url)), "utf8");
    expect(wizard).toContain('testID="demand-place-map"');
    expect(wizard).toContain("MapCanvas");
    expect(wizard).toMatch(/mapWrapper:\s*\{[^}]*height:\s*330[^}]*\}/);
    expect(wizard).toMatch(/mapWrapper:\s*\{[^}]*borderRadius:\s*22[^}]*\}/);
  });

  it("scene map renders supply heat from real aggregates", () => {
    // 供热：服务端真聚合（收藏/去过去/计划/在场）按分画圈，0 分不渲染；
    // 开关纯图标，不过多解释。
    expect(scene).toContain('testID="scene-map-heat"');
    expect(scene).toContain("sceneHeatScore(scene)");
    expect(scene).toContain("if (score <= 0) return null;");
  });

  it("market map renders demand heat from real applicant counts", () => {
    // 需热：报名数 >0 的订单按量画圈，点圈进详情；只在订单 tab 生效。
    expect(market).toContain('testID="market-map-heat"');
    expect(market).toContain("heat && isOpportunity ? heatCircles");
    expect(market).toContain(".filter((p) => p.responses > 0)");
  });

  it("scene detail auto-marks footprint within 300m", () => {
    // SCENE-FOOTPRINT-AUTO-001: 当面打开详情 + 设备在 300m 内 + 已登录，
    // 自动记私人足迹（走同一审计链，每场景一次）；远了不动手。
    expect(scene).toContain("autoFootprintDone");
    expect(scene).toContain("metersBetween(origin, selected) > 300");
    expect(scene).toContain("persistVisited(selected.id)");
  });

  it("scene detail overlays without unmounting the map", () => {
    // SCENE-MAP-GESTURE-001: 详情曾是 early-return 整页替换，地图每次进出
    // 重装原生 MapView，iOS 手势死亡。现在详情走盖层，地图常驻。
    expect(scene).toContain("SCENE-MAP-GESTURE-001");
    expect(scene).toContain("const detailBody = selected ? (");
    expect(scene).toContain("style={styles.detailOverlay}");
    expect(scene).not.toContain("if (selected) {");
  });
});
