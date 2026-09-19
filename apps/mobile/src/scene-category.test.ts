import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-CATEGORY-001: 场景顶类封闭三态（商家/景点/其他），前端只认这三个。
// 之前 type 是自由文本（"咖啡""公园"随便填），词表无界 —— 后期按分类做的
// 标记颜色、徽标、筛选全都无从 key。细分（咖啡店/湖/海滩…）继续走 type，
// 由后端定，前端不碰。注释先剥掉再断言，只认代码。
const map = readFileSync(fileURLToPath(new URL("./surfaces/reality-scene-map.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const mapCode = stripComments(map);

describe("SCENE-CATEGORY-001 scene top-level category is a closed set", () => {
  it("declares the three categories and guards them fail-closed", () => {
    expect(mapCode).toContain('type SceneCategory = "商家" | "景点" | "其他"');
    expect(mapCode).toContain('scene.category === "商家" || scene.category === "景点" || scene.category === "其他"');
    // 提案校验（isSceneProposal）随提交 UI 整段撤下，顶类封闭由类型声明 +
    // isRealityScene 校验继续守 —— 后端词表没动，新 UI 回来照样只能三选一。
  });

  it("has no free-text category box while submission UI is withdrawn", () => {
    // 提交表单暂撤（commander 重做设计中）：自由文本框（"类型，例如 咖啡 / 公园"）
    // 不能借机回来，无界词表一回来按分类做的东西全断。新 UI 带三选一 picker 回来。
    expect(mapCode).not.toContain("类型，例如 咖啡 / 公园");
    expect(mapCode).toContain('type SceneCategory = "商家" | "景点" | "其他"');
  });

  it("paints markers and badges by category, dimming only the unvisited/inactive", () => {
    // 2026-09-18 反转（commander 决定）：之前去过置灰、没去过高亮，用户实测
    // 反直觉 —— 去过的地方灰了像"没了"。现在去过点亮（分类本色）、没去过和
    // 未开放置灰。徽标只报身份，不因置灰消失。
    expect(mapCode).toContain('visited.has(scene.id) ? (scene.category === "商家" ? color.magenta : scene.category === "景点" ? color.violet : color.muted) : color.muted');
    expect(mapCode).toContain('(!scene.active || !visited) && styles.sceneDotMuted');
    expect(mapCode).toContain("{selected.category}");
    expect(mapCode).toContain("styles.categoryBadge");
  });

  it("keeps tap-to-homepage and search working across the change", () => {
    // SCENE-NAV-PIN-001 反转：点图钉先弹快打卡，看详情才进主页（setSelectedId
    // 只许出现在看详情那一行）。分类三态、搜索语料不断。
    expect(mapCode).toContain("onPress={() => { setPinSheetId(scene.id); }}");
    expect(mapCode).toContain("setPinSheetId(undefined); setSelectedId(pinScene.id)");
    expect(mapCode).toContain("${scene.name} ${scene.area} ${scene.type} ${scene.category}");
    // 社区提交 UI 整段撤下（commander 重做设计中）：提案列表不在地图页了，
    // 后端管线不动。来源后缀显示保留 —— 社区来源的店行照样标出来。
    expect(mapCode).not.toContain("{proposal.area} · {proposal.category}");
    expect(mapCode).toContain("{sceneSourceSuffix(scene.source)}");
  });
});
