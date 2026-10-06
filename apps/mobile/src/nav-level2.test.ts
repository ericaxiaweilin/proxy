import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// NAV-L2-001（2026-10-03，用户「底栏只有1级页面有，为什么编辑页面也有底栏」）：
//
// 底栏只有一级模块有（app-shell 442 行注释）。me.tsx 的 subPage 上报管的是
// 个人上下文 —— BUSINESS 上下文直接 return，不走 subPage，里面再钻多深
// （creator/券/活动/店详情/资产编辑）都没人上报，底栏一直以为还在一级。
//
// 2026-10-06 用户又说了一遍：「说了 底栏在非1级页面不要出现」。这次漏的是**市场 tab**：
// 发布需求向导 / 创建活动向导 / 选人工作台 / 机会详情 / 活动详情都渲染在 market 自己的
// ScrollView 里（in-page takeover），底栏却是壳画的（ProxyNativeTabBarView）—— market
// 只能靠 bottomNavVisible 知道自己该留多少 padding，关不掉它。所以 market 也要上报。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

describe("NAV-L2-001 二级页藏底栏", () => {
  const hub = read("./surfaces/merchant-me-r21-replacement.tsx");
  const me = read("./surfaces/me.tsx");

  it("hub 非 root 页上报（卸载时还原）", () => {
    expect(hub).toContain("onSubPageOpenChange?: ((open: boolean) => void) | undefined");
    expect(hub).toContain("onSubPageOpenChange?.(page !== \"root\")");
    expect(hub).toContain("return () => onSubPageOpenChange?.(false);");
  });

  it("me.tsx 把 hub 信号和 subPage 取或", () => {
    expect(me).toContain("merchantSubOpen");
    expect(me).toContain("subPage !== undefined || merchantSubOpen");
    expect(me).toContain("onSubPageOpenChange={setMerchantSubOpen}");
  });

  it("一级（root）不上报", () => {
    // 断言的是表达式形状，不是"出现过上报"——后者恒真。
    expect(hub).toMatch(/page !== "root"\)/);
    expect(hub).not.toMatch(/onSubPageOpenChange\?\. ?\(true\)/);
  });

  it("市场 tab 的非一级页面也上报，并真的进了底栏判据", () => {
    // 2026-10-06 用户：「说了 底栏在非1级页面不要出现」。
    const market = read("./surfaces/market.tsx");
    const shell = read("./shell/app-shell.tsx");
    expect(market).toContain("onSubPageOpenChange?: ((open: boolean) => void) | undefined");
    expect(market).toContain("onSubPageOpenChange?.(marketSubPageOpen)");
    expect(market).toContain("return () => onSubPageOpenChange?.(false);");
    // 壳侧：信号真的接上线了，而且真的进了 isNavVisible（只接不用 = 白接）。
    expect(shell).toContain("onSubPageOpenChange={setMarketSubPageOpen}");
    expect(shell).toContain("!marketSubPageOpen");
  });

  it("上报清单覆盖每一个页面级子表面（漏一个就有一个页面把底栏带回来）", () => {
    // 真正防的是「以后又加一个全页子表面、忘了上报」。所以不写死清单，
    // 而是拿 market 自己那串 useModuleBackHandler 当基准 —— 它列的就是
    // 「会盖住整页的入口」，两者必须同一组。
    // 两处豁免，都是**故意的**：
    //   · publishMenuOpen —— Modal 弹层（发布选择面板 / KYC 提示），不是页面，底栏留在下面才对。
    //   · MarketMap 的 fullscreen —— 也在文件里，但它是**全屏 Modal**（自己盖住底栏），
    //     不是 in-page takeover；而且它的 state 在 MarketMap 内部，外层够不着。
    //     所以下面把切片限定在 MarketSurface 这一个组件体内。
    const market = read("./surfaces/market.tsx");
    const surface = market.slice(
      market.indexOf("export function MarketSurface("),
      market.indexOf("function OpportunityTab(")
    );
    expect(surface).not.toBe("");
    const pageFlags = [...surface.matchAll(/useModuleBackHandler\((\w+) \?/g)]
      .map((match) => match[1]!)
      .filter((flag) => flag !== "publishMenuOpen");
    expect(pageFlags.length).toBeGreaterThanOrEqual(5);
    const reported = surface.match(/const marketSubPageOpen =\s*([\s\S]+?);/)![1]!;
    for (const flag of pageFlags) {
      expect(reported, `${flag} 没进 marketSubPageOpen —— 那个页面会把底栏带回来`).toContain(flag);
    }
  });
});
