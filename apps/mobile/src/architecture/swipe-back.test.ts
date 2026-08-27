import { describe, expect, it } from "vitest";
import { shouldStartSwipeBack, SWIPE_BACK_EDGE_PX } from "./swipe-back-gesture";

describe("shouldStartSwipeBack", () => {
  it("只接受从左侧系统边缘开始的右滑", () => {
    expect(shouldStartSwipeBack({ startX: SWIPE_BACK_EDGE_PX, dx: 40, dy: 4 })).toBe(true);
    expect(shouldStartSwipeBack({ startX: SWIPE_BACK_EDGE_PX + 1, dx: 80, dy: 0 })).toBe(false);
  });

  it("不会抢占纵向滚动或向左横滑", () => {
    expect(shouldStartSwipeBack({ startX: 8, dx: 20, dy: 40 })).toBe(false);
    expect(shouldStartSwipeBack({ startX: 8, dx: -80, dy: 0 })).toBe(false);
  });
});
