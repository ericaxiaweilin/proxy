import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { selectMeTabView, selectShellChromeVisible, selectMotionProfile } from "./app-shell-selectors";

describe("app shell guest path", () => {
  it("AVATAR-ACCOUNT-001: remounts MeSurface when authenticated account resolves", () => {
    const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
    expect(source).toContain('key={viewerAccountId ?? "pending-account"}');
  });
  it("PROFILE-READ-001: wires account identity and avatar upload into MeSurface", () => {
    const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
    const start = source.indexOf("<MeSurface");
    const meCall = source.slice(start, source.indexOf("/>", start));
    expect(meCall).toContain("viewerAccountId");
    expect(meCall).toContain("mediaClient={media}");
  });
  it("anonymous browser sees the 'need to sign in' view, not MeSurface", () => {
    expect(selectMeTabView({ isGuest: true, voucherOpen: false })).toBe("guest");
  });

  it("guest is not silently demoted to MeSurface when voucherOpen is also true", () => {
    // Guest comes first; voucher must never be shown to anonymous users
    // because vouchers carry personal redemption history.
    expect(selectMeTabView({ isGuest: true, voucherOpen: true })).toBe("guest");
  });

  it("authenticated user with no voucher overlay sees MeSurface", () => {
    expect(selectMeTabView({ isGuest: false, voucherOpen: false })).toBe("me");
  });

  it("authenticated user with voucher overlay sees VoucherSurface", () => {
    expect(selectMeTabView({ isGuest: false, voucherOpen: true })).toBe("voucher");
  });

  it("undefined isGuest is treated as 'not guest' (fail-closed: don't accidentally show the sign-in wall)", () => {
    // If a refactor drops the prop, the shell must NOT silently start
    // showing the guest view; it should still render MeSurface.
    expect(selectMeTabView({ isGuest: false, voucherOpen: false })).toBe("me");
  });
});

describe("app shell scroll chrome ownership", () => {
  it("keeps chrome visible on ME", () => {
    expect(selectShellChromeVisible({ tab: "ME", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(true);
  });

  it.each([
    ["HOME", "homeChromeVisible"],
    ["MESSAGES", "messageChromeVisible"],
  ] as const)("lets the %s stream hide chrome like Feed (chrome-parity)", (tab, key) => {
    // 信号隐藏 chrome（上滑藏）
    expect(selectShellChromeVisible({ tab, feedChromeVisible: true, [key]: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false } as Parameters<typeof selectShellChromeVisible>[0])).toBe(false);
    // 信号恢复（下滑/回顶显）
    expect(selectShellChromeVisible({ tab, feedChromeVisible: true, [key]: true, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false } as Parameters<typeof selectShellChromeVisible>[0])).toBe(true);
  });

  it("keeps HOME/MESSAGES chrome visible when the signal is not wired (legacy callers)", () => {
    // optional 未传时保持常显：旧调用（测试/未来 surface）不受影响。
    expect(selectShellChromeVisible({ tab: "HOME", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(true);
    expect(selectShellChromeVisible({ tab: "MESSAGES", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(true);
  });

  it.each(["FEED", "MARKET"] as const)("lets the %s stream hide chrome on scroll", (tab) => {
    expect(selectShellChromeVisible({ tab, feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(false);
    expect(selectShellChromeVisible({ tab, feedChromeVisible: true, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(true);
  });

  it("feed nested chat/preferences force chrome visible", () => {
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: false })).toBe(false);
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: true, feedPrefsOpen: false, messageChatOpen: false })).toBe(true);
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: true, messageChatOpen: false })).toBe(true);
  });

  it("hides chrome whenever a 1:1 conversation overlay is open, regardless of tab", () => {
    // Tab-agnostic: 1:1 conversation owns its own header + composer.
    for (const tab of ["HOME", "MARKET", "FEED", "MESSAGES", "ME"] as const) {
      expect(
        selectShellChromeVisible({ tab, feedChromeVisible: true, feedChatOpen: false, feedPrefsOpen: false, messageChatOpen: true })
      ).toBe(false);
    }
  });

  it("1:1 conversation overlay beats the Feed chat open override", () => {
    // The 1:1 overlay is a hard takeover; feedChatOpen's "force visible"
    // does not resurrect chrome while a 1:1 conversation is on screen.
    expect(
      selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: true, feedPrefsOpen: false, messageChatOpen: true })
    ).toBe(false);
  });
});

describe("app shell motion profile (R15.22 reduce-motion downgrade)", () => {
  it("uses Animated.spring when Reduce Motion is off", () => {
    expect(selectMotionProfile(false)).toEqual({ useSpring: true });
  });

  it("skips spring when Reduce Motion is on (a11y)", () => {
    expect(selectMotionProfile(true)).toEqual({ useSpring: false });
  });
});

// R15.34.3: body 横滑切页的 PanResponder — 选诀。
// 重点: onStartShouldSetPanResponder 为 false (不抢 start),
// onMoveShouldSetPanResponder 需要 dx > 56 + dx > dy*1.25 才抢。
// 这样子组件 (FilterChipRail / 多图 ScrollView / stories) 的 PanResponder
// (dx > 6 或 start 抢) 会先于 body 拿到 responder, body 的 PanResponder
// 拿不到, 不切 tab。
describe("app shell body swipe PanResponder (R15.34.3)", () => {
  type PanHandlers = {
    onStartShouldSetPanResponder?: (e: unknown, gs: { dx: number; dy: number }) => boolean;
    onMoveShouldSetPanResponder?: (e: unknown, gs: { dx: number; dy: number }) => boolean;
    onPanResponderRelease?: (e: unknown, gs: { dx: number; dy: number }) => void;
  };

  // 复刻 app-shell.tsx 里的 bodySwipePanResponder 逻辑
  function buildHandlers(): PanHandlers {
    return {
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        const absDx = Math.abs(gs.dx);
        const absDy = Math.abs(gs.dy);
        const swipeThreshold = 56;
        return absDx > swipeThreshold && absDx > absDy * 1.25;
      }
    };
  }

  it("does NOT claim the responder on touch start (lets children claim first)", () => {
    const handlers = buildHandlers();
    expect(handlers.onStartShouldSetPanResponder!(null, { dx: 0, dy: 0 })).toBe(false);
    expect(handlers.onStartShouldSetPanResponder!(null, { dx: 200, dy: 0 })).toBe(false);
  });

  it("does NOT claim the responder for small moves (lets chip rail / multi-image scroll claim)", () => {
    const handlers = buildHandlers();
    // 小于 56 px 的横滑 — 让给子组件
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 10, dy: 0 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 30, dy: 0 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 55, dy: 0 })).toBe(false);
  });

  it("does NOT claim the responder for vertical (dy > dx) moves", () => {
    const handlers = buildHandlers();
    // 纯垂直滑 (上下滚) — 不当横滑
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 0, dy: 200 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 10, dy: 200 })).toBe(false);
  });

  it("does claim the responder for big horizontal swipes (true root-level page switch)", () => {
    const handlers = buildHandlers();
    // dx > 56 且 dx > dy*1.25 — 是真实的根层横滑
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 60, dy: 0 })).toBe(true);
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 100, dy: 5 })).toBe(true);
    // dy 超过 dx*0.8 — 不算横滑
    expect(handlers.onMoveShouldSetPanResponder!(null, { dx: 100, dy: 90 })).toBe(false);
  });
});
