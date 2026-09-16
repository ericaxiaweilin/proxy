import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUB_PAGE_CONTENT, meSubPage } from "./me-sub-pages";

// SUBPAGE-GENERIC-FABRICATED-001
//
// me.tsx 的「我的 → 子页面」有两条渲染路径：
//   1. 专属分支（`subPage.route === "xxx"` 那二十几条）——真正的业务表面；
//   2. 通用兜底分支（me.tsx 里那个 `content?.sections?.map(...)`）——它把
//      SUB_PAGE_CONTENT[route].sections 的每一行**原样当用户自己的数据**渲染：
//      每个 row 变成一张卡，label 当标题、value 当正文。没有 sections 时它
//      渲染诚实的空态「正在准备这个工作区」。
//
// 于是「没有专属分支 + 菜单可达 + 带 sections」这三件事凑在一起，就等于：
// 用户点进一个还没做出来的页面，看到的却是一张编造的数据表。历史上真发生过：
//   · members（成员与权限）→ 列出 Nguyen A / Lan / Minh 三个不存在的人，
//     还给他们派了所有者 / 运营 / 账单三种权限；
//   · outcomehistory（商家结果历史）→ 列出「检查 #001 72% / #003 85% /
//     #004 91%」这条不存在的复查趋势，外加「重复出现的问题」「已验证的改善」。
// 两张表都已删除，这两条路由现在落回诚实的空态。
//
// 本文件同时钉住两件事：
//   · 正向：诚实的空态还在（不许把「没做出来」又变回一张假表）；
//   · 反向：那条结构性规则（菜单可达 + 无专属分支 ⇒ 不许有 sections）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const me = readFileSync(here("./me.tsx"), "utf8");
const meSub = readFileSync(here("./me-sub-pages.ts"), "utf8");
// 与 placeholder-honest-actions.test.ts 同样的理由：钉「某段代码在不在」之前
// 先剥注释，否则解释这段历史的注释里写着同一个字符串，把代码删掉测试照样绿。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(me);
const meSubCode = stripComments(meSub);

// me.tsx 里有哪些路由**有**专属渲染分支。
const dedicated = new Set(
  [...meCode.matchAll(/subPage\.route === "([a-z]+)"/g)].map((m) => m[1] ?? ""),
);
// me.tsx 里有哪些路由**被菜单指向**（两种写法：openSubPage("x") / route: "x"）。
const menuReachable = new Set([
  ...[...meCode.matchAll(/openSubPage\("([a-z]+)"\)/g)].map((m) => m[1] ?? ""),
  ...[...meCode.matchAll(/route: "([a-z]+)"/g)].map((m) => m[1] ?? ""),
]);
// 通用兜底分支只会渲染这两者交集之外的路由的 sections。
const genericOnly = [...menuReachable].filter((r) => !dedicated.has(r)).sort();

describe("SUBPAGE-GENERIC-FABRICATED-001 generic sub-pages never render an invented table", () => {
  it("the projection used by the menu drops sections entirely", () => {
    // meSubPage 只投影 title/desc/icon/route —— 菜单卡片拿不到 sections，
    // 这是「表只能经由通用兜底上屏」这个前提本身。
    const projected = meSubPage("members");
    expect(projected).toBeDefined();
    expect(Object.keys(projected ?? {}).sort()).toEqual(["desc", "icon", "route", "title"]);
  });

  it("the two pages that really rendered invented rows no longer carry a table", () => {
    expect(SUB_PAGE_CONTENT.members?.sections).toBeUndefined();
    expect(SUB_PAGE_CONTENT.outcomehistory?.sections).toBeUndefined();
  });

  it("no menu-reachable route without a dedicated surface carries sections", () => {
    // 这是核心不变量。失败意味着有人给一个还没做出来的页面配了一张数据表，
    // 而它会被通用兜底原样渲染成「用户自己的数据」。
    expect(genericOnly.length).toBeGreaterThan(0); // 前提：确实存在这类路由
    const offenders = genericOnly.filter((r) => SUB_PAGE_CONTENT[r]?.sections !== undefined);
    expect(offenders).toEqual([]);
  });

  it("still describes those pages, so the deletion removed data and not the page", () => {
    // 反向钉：不是把条目整个删掉（那会让菜单点进去什么都不显示），
    // 而是保留标题/描述/图标，让页面身份还在、内容诚实缺席。
    for (const route of ["members", "outcomehistory"]) {
      const entry = SUB_PAGE_CONTENT[route];
      expect(entry).toBeDefined();
      expect(entry?.title.length ?? 0).toBeGreaterThan(0);
      expect(entry?.desc.length ?? 0).toBeGreaterThan(0);
      expect(entry?.icon.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("the honest empty state is still the fallback for a page with no table", () => {
    expect(meCode).toContain("正在准备这个工作区");
    // 兜底分支必须真的是「没有 sections 才显示空态」，而不是无条件显示。
    expect(meCode).toMatch(/!\s*content\?\.sections\s*\?/);
  });

  it("keeps the invented member roster and inspection trend out of the data file", () => {
    // 三个不存在的人 + 他们被派的权限。
    for (const dead of ["Nguyen A", "所有者 · 企业管理 / 需求 / 成员 / 账单"]) {
      expect(meSubCode).not.toContain(dead);
    }
    // 不存在的复查趋势与它的结论。
    for (const dead of ["检查 #001", "重复出现的问题", "已验证的改善", "英文菜单可用"]) {
      expect(meSubCode).not.toContain(dead);
    }
    // 编造的金额与到店漏斗（这些条目本身没有渲染方，但同样是编造数字，
    // 留在数据文件里就是下一个 openSubPage 调用的事）。
    for (const dead of ["8,450,000", "8.2k / 1.1k / 412 / 248 / 38", "满意度 4.6"]) {
      expect(meSubCode).not.toContain(dead);
    }
  });

  it("does not reintroduce a fabricated identity state", () => {
    // 「Identity verified · Principal ACTIVE」是把一次没人做过的核验写成已完成态；
    // 未接入就该是「—」。
    expect(meSubCode).not.toContain("Identity verified");
    expect(meSubCode).not.toContain("Principal ACTIVE");
  });
});
