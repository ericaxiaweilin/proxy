import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SWIPE-RAIL-001 —— 页面级左右滑切页会抢走照片/头像横滑，看起来像 bug。
// 照片/头像类横滑轨一律包 HorizontalSwipeRail（PanResponder 隔离），
// 有可点子项的一律 preserveChildPresses + threshold 3（轻点不丢）。
// 注意写法：rail 紧跟在三元分支 `(` 后面时注释必须用 `//` —— `{/* */}`
// 在 JS 表达式位会被当成 JS 块，直接把整文件编译炸掉。
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function expectRail(source: string, snippet: string): void {
  expect(source).toContain(snippet);
}

describe("SWIPE-RAIL-001 photo/avatar rails survive page-swipe", () => {
  it("AI 分身三处横滑全部隔离（头像 rail + 图库双轨 + 选图）", () => {
    const card = read("./components/twin-insight-card.tsx");
    expectRail(card, "<HorizontalSwipeRail contentContainerStyle={styles.rail} preserveChildPresses threshold={3}>");
    expect(card).not.toContain("contentContainerStyle={styles.rail}\n    >");
    const gallery = read("./components/twin-gallery-section.tsx");
    expect(gallery.match(/<HorizontalSwipeRail preserveChildPresses style=\{styles\.track\} threshold=\{3\}>/g)).toHaveLength(2);
    const composer = read("./components/twin-post-composer-section.tsx");
    expectRail(composer, "<HorizontalSwipeRail preserveChildPresses style={styles.mediaPicker} threshold={3}>");
  });

  it("其它照片墙/头像轨同样隔离", () => {
    const threads = read("./components/threads-post-media.tsx");
    expectRail(threads, "<HorizontalSwipeRail contentContainerStyle={styles.rowContent} preserveChildPresses threshold={3}>");
    const room = read("./surfaces/room.tsx");
    expectRail(room, "<HorizontalSwipeRail contentContainerStyle={styles.membersStripContent} preserveChildPresses style={styles.membersStrip} threshold={3}>");
    const assistants = read("./ai-assistants-row.tsx");
    expectRail(assistants, "<HorizontalSwipeRail contentContainerStyle={styles.row} preserveChildPresses threshold={3}>");
    const scene = read("./surfaces/reality-scene-map.tsx");
    expectRail(scene, "<HorizontalSwipeRail contentContainerStyle={styles.humanRail} preserveChildPresses threshold={3}>");
    expectRail(scene, "<HorizontalSwipeRail contentContainerStyle={styles.menuRail} preserveChildPresses threshold={3}>");
    const merchant = read("./surfaces/merchant-creator-recommendations.tsx");
    expectRail(merchant, "<HorizontalSwipeRail contentContainerStyle={styles.rail} preserveChildPresses threshold={3}>");
    const business = read("./surfaces/business-home.tsx");
    expectRail(business, "<HorizontalSwipeRail contentContainerStyle={styles.menuRail} preserveChildPresses threshold={3}>");
  });

  it("被替换掉的裸横滑 ScrollView 不许回来", () => {
    const card = read("./components/twin-insight-card.tsx");
    expect(card).not.toMatch(/<ScrollView[^>]*contentContainerStyle=\{styles\.rail\}/);
    const gallery = read("./components/twin-gallery-section.tsx");
    expect(gallery).not.toMatch(/<ScrollView[^>]*style=\{styles\.track\}/);
  });
});
