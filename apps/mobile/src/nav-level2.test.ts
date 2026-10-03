import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// NAV-L2-001（2026-10-03，用户「底栏只有1级页面有，为什么编辑页面也有底栏」）：
//
// 底栏只有一级模块有（app-shell 442 行注释）。me.tsx 的 subPage 上报管的是
// 个人上下文 —— BUSINESS 上下文直接 return，不走 subPage，里面再钻多深
// （creator/券/活动/店详情/资产编辑）都没人上报，底栏一直以为还在一级。
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
});
