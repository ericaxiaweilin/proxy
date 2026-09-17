import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-NAV-001: 场景有实体标记、点标记进主页，但缺“导航去这里”。
// 决定（A 方案）：tap 进主页的习惯不动，导航是主页操作行第三颗按钮，
// 走 MEETUP-NAV-001 同一套系统地图深链 —— 不手拼 URL，不自写导航引擎。
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
    expect(mapCode).toContain("导航去这里 ›");
  });

  it("keeps tap-to-homepage untouched", () => {
    // 导航是加法：点标记进主页这条老链路一字不许动，动了就是 B 方案。
    expect(mapCode).toContain("onPress={() => { setSelectedId(scene.id); }}");
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
});
