/**
 * Pure selectors for the AppShell that are testable without the React
 * Native runtime. Kept separate from app-shell.tsx so vitest can import
 * them directly without tripping over JSX / `import typeof` markers in
 * the React Native entrypoint.
 */

export type MeTabView = "guest" | "voucher" | "me";

export function selectShellChromeVisible(input: {
  tab: "HOME" | "MARKET" | "FEED" | "MESSAGES" | "ME";
  feedChromeVisible: boolean;
  /** HOME 主信息流的滑动显隐信号（可选：未接线时 HOME 保持常显，向后兼容）。 */
  homeChromeVisible?: boolean;
  /** MESSAGES 收件箱的滑动显隐信号（可选：未接线时 MESSAGES 保持常显，向后兼容）。 */
  messageChromeVisible?: boolean;
  feedChatOpen: boolean;
  feedPrefsOpen: boolean;
  /**
   * The MESSAGES home inbox opened a 1:1 conversation. The conversation
   * surface is a fullscreen overlay with its own header + composer, so
   * the bottom nav must be hidden regardless of which tab is active.
   * (Symmetric with feedChatOpen, which forces chrome visible while
   * the feed's nested chat sheet is open.)
   */
  messageChatOpen: boolean;
}): boolean {
  // 1:1 conversation overlay is a fullscreen takeover — hide chrome.
  if (input.messageChatOpen) return false;
  // R15.33: MAP tab 撤了；不可滚动的 tab 底栏一直可见。
  // Feed + Market 列表滚动驱动显隐（下滑隐藏、上滑恢复），与其余 tab 无关。
  // HOME / MESSAGES 与动态同一套滑动显隐（chrome-parity）：信号由各自
  // Surface 上报；optional 未接线时保持常显（旧调用兼容）。
  if (input.tab === "HOME") return input.homeChromeVisible ?? true;
  if (input.tab === "MESSAGES") return input.messageChromeVisible ?? true;
  if (input.tab !== "FEED" && input.tab !== "MARKET") return true;
  if (input.feedChatOpen || input.feedPrefsOpen) return true;
  return input.feedChromeVisible;
}

/**
 * The "Me" tab body selector.
 * - isGuest=true → "need to sign in" view (anonymous browser can't see
 *   personal data, relationships, or orders).
 * - voucherOpen=true → VoucherSurface
 * - default → MeSurface
 *
 * `isGuest` comes first so a guest never accidentally lands on the
 * voucher overlay (vouchers carry personal redemption history).
 */
export function selectMeTabView(input: { isGuest: boolean; voucherOpen: boolean }): MeTabView {
  if (input.isGuest) return "guest";
  if (input.voucherOpen) return "voucher";
  return "me";
}

/**
 * R15.22 motion patch: how the liquid dock should respond to a press
 * given the system Reduce Motion setting.
 *
 *   reduceMotion = false  →  Animated.spring (default, ~100ms)
 *   reduceMotion = true   →  setValue immediate, no animation
 *
 * Returned object is consumed by both the press spring in setLensPressed
 * and the drag-driven liquid motion in onPanResponderMove.
 */
export function selectMotionProfile(reduceMotion: boolean): { useSpring: boolean } {
  return { useSpring: !reduceMotion };
}
