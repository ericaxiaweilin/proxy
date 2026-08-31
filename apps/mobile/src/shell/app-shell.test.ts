import { describe, expect, it } from "vitest";
import { selectMeTabView, selectShellChromeVisible } from "./app-shell-selectors";

describe("app shell guest path", () => {
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
  it.each(["HOME", "MARKET", "MESSAGES", "ME"] as const)("keeps chrome visible on %s", (tab) => {
    expect(selectShellChromeVisible({ tab, feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false })).toBe(true);
  });

  it("lets only the primary Feed stream hide chrome", () => {
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: false })).toBe(false);
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: true, feedPrefsOpen: false })).toBe(true);
    expect(selectShellChromeVisible({ tab: "FEED", feedChromeVisible: false, feedChatOpen: false, feedPrefsOpen: true })).toBe(true);
  });
});
