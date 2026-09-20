import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// MEDIA-ROW-HARDEN-001: 2+ 张图跟主 Feed（AdaptiveMediaCollection）同一套
// 固定尺寸横滑规则——不再是不滑动的 flex:1 等分单行（旧行为在真机上传的
// 真实套图上会把 3/4 张图挤成又窄又长、不可读的条状）。单张图不变。
// 注释先剥掉再断言，只认代码。
const source = readFileSync(fileURLToPath(new URL("./threads-post-media.tsx", import.meta.url)), "utf8");
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(source);

describe("MEDIA-ROW-HARDEN-001 profile post photos use the fixed-size golden-ratio row", () => {
  it("has no leftover single-row flex:1-equal-division branch or +N truncation", () => {
    // 旧实现：shown = items.slice(0, 4)，每格 flex:1 等分，最后一格挂 moreCount。
    // 新实现横滑展示全部 items，不再裁到 4 张、不再有"+N"角标。
    expect(code).not.toContain("items.slice(0, 4)");
    expect(code).not.toContain("moreCount");
    // 旧的 flex:1 等分单行样式键（不是新的 postMediaRowWrap/rowContent）。
    expect(code).not.toMatch(/\brow: \{/);
  });

  it("renders 2+ photos in a horizontal ScrollView, all items, none dropped", () => {
    expect(code).toContain("<ScrollView horizontal");
    expect(code).toContain("items.map((item, i) =>");
  });

  it("sizes every card the same — half the measured row width, golden-ratio tall", () => {
    // 卡片宽度固定 = (rowWidth - ROW_GAP) / 2，高度 = 宽度 × 黄金比例——
    // 跟每张照片自己的 sourceAspect 完全无关，这是这次要堵死的那类 bug
    // （真机真实照片比例撑爆格子）的核心断言。
    expect(code).toContain("const cardWidth = rowWidth > 0 ? (rowWidth - ROW_GAP) / 2 : 0;");
    expect(code).toContain("const cardHeight = cardWidth * GOLDEN_RATIO;");
    expect(code).toContain("const GOLDEN_RATIO = 1.618;");
  });

  it("keeps the single-photo variant untouched — still the big flex:1 cell, no horizontal scroll", () => {
    expect(code).toContain('if (items.length === 1) {');
    expect(code).toContain("<MediaCell big item={only}");
    expect(code).toContain("mediaCellBig: { flex: 1, minHeight: 210 }");
  });
});
