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
    expect(mapCode).toContain('item.category === "商家" || item.category === "景点" || item.category === "其他"');
  });

  it("submits through a three-choice picker, not a free-text box", () => {
    // 自由文本框（"类型，例如 咖啡 / 公园"）已撤：填什么词都是无界词表。
    // 不预设选项 —— 预设等于替用户选，错了就是我们编的。
    expect(mapCode).toContain('(["商家", "景点", "其他"] as const)');
    expect(mapCode).toContain("请先选择分类：商家 / 景点 / 其他。");
    expect(mapCode).not.toContain("类型，例如 咖啡 / 公园");
  });

  it("paints markers and badges by category, dimming only for visited/inactive", () => {
    // 去过/未开放置灰（老规矩保留），其他一律按分类本色：商家品红、景点紫、
    // 其他灰（本来就不强调）。徽标只报身份，不因置灰消失。
    expect(mapCode).toContain('scene.category === "商家" ? color.magenta : scene.category === "景点" ? color.violet : color.muted');
    expect(mapCode).toContain("{selected.category}");
    expect(mapCode).toContain("styles.categoryBadge");
  });

  it("keeps tap-to-homepage and search working across the change", () => {
    expect(mapCode).toContain("onPress={() => { setSelectedId(scene.id); }}");
    expect(mapCode).toContain("${scene.name} ${scene.area} ${scene.type} ${scene.category}");
    expect(mapCode).toContain("{proposal.area} · {proposal.category}");
  });
});
