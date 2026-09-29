import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wallet = readFileSync(fileURLToPath(new URL("./wallet.tsx", import.meta.url)), "utf8");

// WALLET-001：钱包是原型 5 页流（home / topup / bean / ticket / history），
// 不是单页长列表。版式/顺序/文案跟原型走，数字只读服务端。
describe("WALLET-001 wallet follows the prototype page flow", () => {
  it("has five pages switched by state, home first", () => {
    expect(wallet).toContain('useState<WalletPage>("home")');
    for (const page of ['page === "home"', 'page === "topup"', 'page === "bean"', 'page === "ticket"', 'page === "history"']) {
      expect(wallet).toContain(page);
    }
  });

  it("home shows the three-asset hero, four funcs, hot packages and the banner", () => {
    expect(wallet).toContain("t(\"diamonds\")");
    expect(wallet).toContain("t(\"beans\")");
    expect(wallet).toContain("t(\"voucherPackUnit\")");
    expect(wallet).toContain("t(\"commonFuncs\")");
    expect(wallet).toContain("t(\"hotRecharge\")");
    expect(wallet).toContain("t(\"beanExchangeOff\")");
    expect(wallet).toContain("go(\"topup\")");
    expect(wallet).toContain("go(\"bean\")");
    expect(wallet).toContain("go(\"ticket\")");
    expect(wallet).toContain("go(\"history\")");
  });

  it("renders no invented money: balances, prices, rates and counts come from GetWallet", () => {
    expect(wallet).toContain("wallet.getWallet()");
    expect(wallet).toContain("snapshot?.diamonds");
    expect(wallet).toContain("snapshot?.beans");
    expect(wallet).toContain("snapshot?.rechargePackages");
    expect(wallet).toContain("snapshot?.exchangeCatalog");
    expect(wallet).toContain("snapshot?.providers");
    for (const fake of ["12,680", "8,420", "12,800", "3,280", "860,000"]) {
      expect(wallet).not.toContain(fake);
    }
  });

  it("never lets a stale refresh overwrite newer balances, and applies server balances instantly", () => {
    // 慢请求压哨返回覆盖成功后的刷新 → 余额闪回旧 0 → 用户只能再点一次。
    expect(wallet).toContain("loadSeq");
    expect(wallet).toContain("setSnapshot((prev) => (prev ? { ...prev, diamonds: result.diamonds, beans: result.beans } : prev));");
  });

  it("history filters by currency and groups by day like the prototype", () => {
    expect(wallet).toContain("historyTab");
    expect(wallet).toContain("todayTx");
    expect(wallet).toContain("yesterdayTx");
    expect(wallet).toContain("earlierTx");
  });

  it("uses glyphs, not hand-drawn back arrows or emoji buttons", () => {
    expect(wallet).toContain("ProxyBackGlyph");
    expect(wallet).toContain('name="diamond"');
    expect(wallet).toContain('name="ticket"');
  });
});
