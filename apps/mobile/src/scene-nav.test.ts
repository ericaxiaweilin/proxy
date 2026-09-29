import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-NAV-001: 场景有点可去 —— 导航走 MEETUP-NAV-001 同一套系统地图深链，
// 不手拼 URL，不自写导航引擎，坐标非法 fail-closed。
// SCENE-NAV-PIN-001（2026-09-19 反转旧决定）：导航原来只埋在详情第三颗按钮，
// 用户找不到 —— 点图钉改弹快打卡（导航去这里 / 看详情二选一），导航提到图钉层。
// 详情页里的导航按钮保留（同一条深链），看详情仍进 selectedId 老链。
// 本文件是源码级 tripwire：注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("SCENE-NAV-001 the scene homepage navigates there", () => {
  it("opens system-maps directions from the homepage action row", () => {
    // 坐标→深链→按端选边→调起，四步全在，少一步就是半截。
    expect(mapCode).toContain("meetupDirectionsUrls({ lat: scene.latitude, lng: scene.longitude })");
    expect(mapCode).toContain('Platform.OS === "ios" ? urls.apple : urls.google');
    expect(mapCode).toContain("Linking.openURL(url)");
    expect(mapCode).toContain('accessibilityLabel="导航去这里"');
    // SCENE-HOME-PROTOTYPE-001（2026-09-28）：可见文案收成「导航」—— 原型那颗就写
    // 「导航」，兄弟实现 scene-shop-directory 的 actNav 也早就是「导航」，只有这里
    // 多写了「去这里」。无障碍标签仍留「导航去这里」（上一行），读屏听完整一点更有用。
    expect(mapCode).toContain("style={styles.action3NavText}>导航<");
    // 反向针：尾部那颗文本字符 `›` 不许回来 —— 它现在是真字形 arrowUpRight。
    // 字符不是字形（BACK-GLYPH-001 同款）：形状和垂直基线随 fontSize 漂，
    // 跟别处的 chevron 也对不上粗细。
    expect(mapCode).not.toContain("导航去这里 ›");
  });

  it("fails closed with distinct messages instead of inventing a point", () => {
    // 坐标无效和调不起地图应用是两件事：前者是数据问题，后者重试可能好。
    // 合并成一句会让用户对着一个坏坐标反复点。
    expect(mapCode).toContain("这个场景没有可用坐标，打不开导航");
    expect(mapCode).toContain("打不开导航，请重试");
    // 反向钉：不许绕过 validated builder 手拼地图 URL —— 拼出来的 q= 只能看不能走，
    // 而且拼错坐标就是编点。
    expect(mapCode).not.toContain("maps.apple.com");
    expect(mapCode).not.toContain("google.com/maps");
  });

  it("treats null-island as missing coordinates, not a destination", () => {
    // (0,0) 在数值上“合法”（有限数、在 ±90/±180 内），但它在大西洋正中间 ——
    // 上游拿它当“没填”时，导航过去等于把人往海里导。必须和非法坐标同出口。
    expect(mapCode).toContain("scene.latitude === 0 && scene.longitude === 0");
  });
});

describe("SCENE-NAV-PIN-001 pin tap pops navigation-or-detail choices", () => {
  it("opens the quick sheet on pin tap instead of the detail", () => {
    // 点图钉只弹快打卡，不直通详情 —— 导航埋详情里太深用户找不到。
    expect(mapCode).toContain("onPress={() => { setPinSheetId(scene.id); }}");
    // 快打卡认当前视野的人，筛没了自动收卡，不留灵异卡片。
    expect(mapCode).toContain("filtered.find((scene) => scene.id === pinSheetId)");
  });

  it("navigates from the sheet over the same deep link, detail stays one tap away", () => {
    // 导航按钮和详情页第三颗按钮走同一条 openSceneNavigation 深链，不另起炉灶。
    expect(mapCode).toContain("onPress={() => openSceneNavigation(pinScene)}");
    // 看详情才进 selectedId 老链（自动足迹/打卡门禁照旧），进的同时收快打卡。
    expect(mapCode).toContain("setPinSheetId(undefined); setSelectedId(pinScene.id)");
    // 点地图空白、×、系统返回都能收卡 —— 卡赖着不走等于挡地图。
    expect(mapCode).toContain("onPress={() => setPinSheetId(undefined)}");
    expect(mapCode).toContain('accessibilityLabel="关闭快打卡"');
  });

  it("the sheet is actually reachable on iOS: the marker callout opens it too", () => {
    // 2026-09-28 模拟器实测：iOS 上带 title/description 的 Marker，点图钉只弹
    // **原生 callout**（地图自带的标题气泡），`Marker.onPress` 不触发 ⇒ 应用自己的
    // 快打卡弹层（导航去这里 / 看详情）**永远打不开** —— SCENE-NAV-PIN-001 名存实亡
    // （门禁那几条 grep 全绿，因为它只查源码里有没有 setPinSheetId(scene.id)）。
    // 挂上 onCalloutPress 之后，点 callout 才进得来。这条钉守的就是「这条可达路径还在」。
    expect(mapCode).toContain("onCalloutPress={() => { setPinSheetId(scene.id); }}");
    // 反向针：title / description 不能为了「只留一层气泡」删掉 —— 它们是图钉的
    // 无障碍标签（AXLabel = "名字, 地址"），删了读屏用户就只剩一堆无名图钉。
    // 想改成「一次点击直接开弹层」得先给 Marker 换个 accessibilityLabel，别顺手删。
    expect(mapCode).toContain("title={scene.name}");
    expect(mapCode).toContain("description={sceneAddressLine(scene)}");
  });
});
