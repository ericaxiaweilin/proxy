// 规范 §3/§10 手势判定的单测。纯函数层，vitest 直接跑。
import { describe, expect, it } from "vitest";
import {
  decideSwipe,
  decideExitRelease,
  shouldLockHorizontal,
  HORIZONTAL_LOCK_RATIO,
  TAP_SLOP_PX,
  EXIT_COMMIT_RATIO
} from "./module-pager-gesture";

describe("shouldLockHorizontal", () => {
  it("|dx| > |dy| * 1.2 才锁横向", () => {
    expect(shouldLockHorizontal(30, 10)).toBe(true);
    expect(HORIZONTAL_LOCK_RATIO).toBe(1.2);
  });
  it("纵向主导不锁定", () => {
    expect(shouldLockHorizontal(10, 30)).toBe(false);
  });
  it("45 度对角线不锁定（dx = dy * 1.2 边界）", () => {
    expect(shouldLockHorizontal(24, 20)).toBe(false);
    expect(shouldLockHorizontal(25, 20)).toBe(true);
  });
});

describe("decideSwipe", () => {
  const W = 390;
  it("小位移低速判 tap（§10）", () => {
    expect(decideSwipe({ dx: TAP_SLOP_PX - 1, dy: 0, pageWidth: W })).toBe("tap");
    expect(TAP_SLOP_PX).toBeGreaterThanOrEqual(8);
    expect(TAP_SLOP_PX).toBeLessThanOrEqual(16);
  });
  it("过半页宽 → next/prev", () => {
    expect(decideSwipe({ dx: -W * 0.4, dy: 0, pageWidth: W })).toBe("next");
    expect(decideSwipe({ dx: W * 0.4, dy: 0, pageWidth: W })).toBe("prev");
  });
  it("快速轻扫（flick）即使位移不足也翻页", () => {
    expect(decideSwipe({ dx: -60, dy: 0, pageWidth: W, vx: -0.8 })).toBe("next");
    expect(decideSwipe({ dx: 60, dy: 0, pageWidth: W, vx: 0.8 })).toBe("prev");
  });
  it("纵向主导的手势不产生分页决策（§3 锁定规则）", () => {
    expect(decideSwipe({ dx: -60, dy: 200, pageWidth: W })).toBe("none");
    expect(decideSwipe({ dx: -W * 0.6, dy: W * 0.6, pageWidth: W })).toBe("none");
  });
  it("慢速小位移既非 tap 也非翻页", () => {
    expect(decideSwipe({ dx: 20, dy: 0, pageWidth: W, vx: 0.1 })).toBe("none");
  });
});

describe("decideExitRelease（第 1 页右滑过头退模块）", () => {
  const W = 390;
  it("右滑超过页宽阈值 → exit", () => {
    expect(decideExitRelease({ overscrollPx: W * EXIT_COMMIT_RATIO + 1, pageWidth: W })).toBe("exit");
    expect(decideExitRelease({ overscrollPx: W * 0.6, pageWidth: W })).toBe("exit");
  });
  it("不足阈值回弹，不退出", () => {
    expect(decideExitRelease({ overscrollPx: W * EXIT_COMMIT_RATIO - 1, pageWidth: W })).toBe("none");
    expect(decideExitRelease({ overscrollPx: 12, pageWidth: W })).toBe("none");
  });
  it("方向不对（overscroll 非正）绝不触发", () => {
    expect(decideExitRelease({ overscrollPx: -50, pageWidth: W })).toBe("none");
    expect(decideExitRelease({ overscrollPx: 0, pageWidth: W })).toBe("none");
  });
});

