import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) } }));
vi.mock("./post-impression", () => ({ endPostView: vi.fn() }));

const { visiblePostIds } = await import("./feed-impressions");

// CONTENT-ANALYTICS-001：信息流卡片可见 ≥ 50% 才算看到；比屏幕还高的卡按占屏 50% 算。
describe("feed impressions visibility", () => {
  const viewport = 800;
  it("counts a card only when at least half of it is on screen", () => {
    const cards = { a: { y: 0, height: 400 }, b: { y: 600, height: 400 }, c: { y: 900, height: 400 } };
    expect([...visiblePostIds(cards, 0, viewport)].sort()).toEqual(["a", "b"]);
    expect([...visiblePostIds(cards, 500, viewport)].sort()).toEqual(["b", "c"]);
  });
  it("treats a card taller than the screen as seen once it fills half the screen", () => {
    expect(visiblePostIds({ tall: { y: 0, height: 2000 } }, 900, viewport).has("tall")).toBe(true);
    expect(visiblePostIds({ tall: { y: 0, height: 2000 } }, 1700, viewport).has("tall")).toBe(false);
  });
  it("sees nothing before the viewport is measured", () => {
    expect(visiblePostIds({ a: { y: 0, height: 400 } }, 0, 0).size).toBe(0);
  });
});
