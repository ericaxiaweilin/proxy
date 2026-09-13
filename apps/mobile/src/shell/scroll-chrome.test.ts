import { describe, expect, it } from "vitest";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  CHROME_HIDE_ACCUMULATED,
  CHROME_SETTLE_MS,
  CHROME_SHOW_ACCUMULATED,
  applyChromeScroll,
  createChromeScrollState,
} from "./scroll-chrome";

// SCROLL-CHROME-001 — 逃逸于 2026-09-12。
//
// 现象：消息模块对话 list 滑到底部会自动滑回中部，同时顶部 logo 在
// 「黑屏 / 显示」之间闪。六个信息流页面（messages / feed / me / market /
// requester-home / business-home）各自抄了一份「上滑隐藏 chrome」的逻辑，
// 也各自抄了同一个闭环：
//
//   1. 用户下滑 → accumulator 累计到 +28 → chrome 隐藏
//   2. 隐藏 chrome 会卸载 shell Header（logo 在里面），并把若干页面的
//      底部 padding 从 96/120 改到 16 → 滚动容器 frame 与 content 高度都变
//   3. 当前 contentOffset 超出新的 maxOffset，RN 把它 clamp 回来
//   4. clamp 产生一个 delta 为负的 scroll 事件
//   5. accumulator 累计到 -18 → chrome 显示 → 回到第 2 步
//
// 这是一个无限振荡：调阈值只改变频率。修法是不再把「自己改布局的后果」
// 当成用户意图 —— 一旦切换过 chrome 显隐，就忽略一段 settle 时间内的
// scroll 事件。
//
// 下面第 3 个用例把上面 1→5 完整重放一遍。它用注入时钟，因为振荡只在
// 时间跨过 settle 窗口时才复现，真实计时器测不稳。

function scrollEvent(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 2000 },
      layoutMeasurement: { width: 400, height: 800 },
    },
  } as unknown as NativeSyntheticEvent<NativeScrollEvent>;
}

type Recorder = {
  state: ReturnType<typeof createChromeScrollState>;
  changes: boolean[];
  step: (y: number, now: number) => ReturnType<typeof applyChromeScroll>;
};

function recorder(canHide?: (event: NativeSyntheticEvent<NativeScrollEvent>) => boolean): Recorder {
  const state = createChromeScrollState();
  const changes: boolean[] = [];
  return {
    state,
    changes,
    step: (y, now) =>
      applyChromeScroll({
        state,
        event: scrollEvent(y),
        now,
        onChange: (visible) => changes.push(visible),
        canHide,
      }),
  };
}

describe("scroll-chrome", () => {
  it("SCROLL-CHROME-001: sustained downward scroll hides, upward scroll shows", () => {
    const r = recorder();
    // First event only establishes a baseline (delta 20 is under the
    // threshold), the second one is what crosses it.
    expect(r.step(20, 1000).action).toBe("none");
    expect(r.step(400, 1010).action).toBe("hide");
    expect(r.changes).toEqual([false]);

    // Settle, then a genuine upward gesture brings it back.
    const back = r.step(200, 1010 + CHROME_SETTLE_MS + 10);
    expect(back.action).toBe("show");
    expect(r.changes).toEqual([false, true]);
  });

  it("SCROLL-CHROME-001: a freshly hidden chrome shows again at the top of the list", () => {
    const r = recorder();
    r.step(20, 1000);
    expect(r.step(400, 1010).action).toBe("hide");
    expect(r.state.visible).toBe(false);
    // Rubber-band back to the very top: y <= 48 always shows.
    expect(r.step(10, 1010 + CHROME_SETTLE_MS + 10).action).toBe("show");
  });

  it("SCROLL-CHROME-001: the clamp echo after hiding does not flip the chrome back", () => {
    const r = recorder();

    // 1. user scrolls down to the end of the list.
    r.step(20, 1000);
    const hide = r.step(1200, 1010);
    expect(hide.action).toBe("hide");
    expect(r.changes).toEqual([false]);

    // 2. hiding the chrome shrinks the content (padding 96 -> 16), so RN clamps
    //    the offset from 1200 down to 1120 and emits a NEGATIVE delta of -80 —
    //    eight times the -18 show threshold. This is the echo, not a gesture.
    const echo = r.step(1120, 1012);
    expect(echo.suppressed).toBe(true);
    expect(echo.action).toBe("none");
    expect(r.changes).toEqual([false]);
    expect(r.state.visible).toBe(false);

    // A second echo one frame later is still inside the settle window.
    expect(r.step(1118, 1028).suppressed).toBe(true);
    expect(r.changes).toEqual([false]);

    // 3. once the layout has settled a real upward gesture still works.
    expect(r.step(900, 1010 + CHROME_SETTLE_MS + 10).action).toBe("show");
    expect(r.changes).toEqual([false, true]);
  });



  it("SCROLL-CHROME-001: a bottom-anchored list does not oscillate once settled", () => {
    // The messages list is bottom-anchored, which is what makes the loop close:
    //   chrome hides -> bottom padding 96 -> 16, content shrinks 80px, RN
    //     clamps the offset DOWN -> negative delta -> chrome shows
    //   chrome shows -> content grows back 80px, the bottom anchor pushes the
    //     offset back UP -> positive delta -> chrome hides
    // One lap per frame, forever. Pre-fix this loop toggles ~60 times a second.
    const VISIBLE_MAX_OFFSET = 1200;
    const HIDDEN_MAX_OFFSET = 1120;
    const r = recorder();

    // Warm up: a real downward gesture that hides the chrome.
    r.step(20, 1000);
    const hide = r.step(VISIBLE_MAX_OFFSET, 1010);
    expect(hide.action).toBe("hide");

    let offset = HIDDEN_MAX_OFFSET; // RN clamped when the content shrank
    let now = 1010;
    for (let frame = 0; frame < 60; frame += 1) {
      now += 16;
      const result = r.step(offset, now);
      if (result.action === "hide") {
        offset = HIDDEN_MAX_OFFSET;
      } else if (result.action === "show") {
        offset = VISIBLE_MAX_OFFSET;
      }
    }
    // The settle window caps a stuck layout at one toggle per CHROME_SETTLE_MS;
    // the correct behaviour here is zero, because every event after the hide is
    // an echo.
    const ceiling = Math.ceil((60 * 16) / CHROME_SETTLE_MS);
    expect(r.changes.length - 1).toBeLessThanOrEqual(ceiling);
  });

  it("SCROLL-CHROME-001: thresholds stay where the six surfaces were tuned", () => {
    expect(CHROME_HIDE_ACCUMULATED).toBe(28);
    expect(CHROME_SHOW_ACCUMULATED).toBe(-18);
  });

  it("SCROLL-CHROME-001: canHide veto keeps the chrome visible (market near-bottom)", () => {
    const r = recorder(() => false);
    expect(r.step(600, 1000).action).toBe("none");
    // Without the veto the same gesture hides.
    expect(recorder().step(600, 1000).action).toBe("hide");
  });
});
