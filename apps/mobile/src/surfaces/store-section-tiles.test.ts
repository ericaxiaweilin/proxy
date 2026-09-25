import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUB_PAGE_CONTENT, meSubPage } from "./me-sub-pages";

// STORE-TILES-001：「我的 → 企业 / 店铺」按产品稿从「4 行平铺」整合成
// 「2 个入口磁贴」（我的店铺 / 推荐管理）。
//
// 这类「整合」最容易出的两种事故，就是本文件钉的两件事：
//   ① **整合着整合着把入口弄丢** —— 4 个目的地（bdash / recommendstore /
//      mystorerecs / storerecqueue）必须一个不少，只是换了层壳；
//   ② 新页「推荐管理」落到通用兜底 —— 那种页面只渲染诚实空态，用户看到
//      「正在准备这个工作区」，3 条入口等于凭空消失。
//
// 断言前先剥注释：这些注释里复述了同样的标签，不剥的话把代码删掉测试照样绿
// （假守卫 —— 注释替代码把关）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const me = readFileSync(here("./me.tsx"), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(me);

// 「企业 / 店铺」这一组的源码片段：从 id: "biz" 到下一组 id: "account"。
const bizStart = meCode.indexOf('id: "biz"');
const bizEnd = meCode.indexOf('id: "account"', bizStart);
const bizSection = bizStart >= 0 && bizEnd > bizStart ? meCode.slice(bizStart, bizEnd) : "";

// 「推荐管理」子页那一段。
const manageStart = meCode.indexOf('subPage.route === "storerecmanage"');
const manageBranch = manageStart >= 0 ? meCode.slice(manageStart, manageStart + 1200) : "";

describe("STORE-TILES-001 企业 / 店铺整合成两个入口磁贴", () => {
  it("the group carries exactly the two tiles from the product mock", () => {
    expect(bizStart).toBeGreaterThan(-1);
    expect(bizEnd).toBeGreaterThan(bizStart);
    for (const tile of [
      '{ icon: "home", label: "我的店铺", desc: "企业 · 经营 · 工作台", route: "bdash" }',
      '{ icon: "star", label: "推荐管理", desc: "推荐 · 状态 · 审核", route: "storerecmanage" }'
    ]) {
      expect(bizSection).toContain(tile);
    }
  });

  it("the group no longer flat-lists rows (that is the whole point of 整合)", () => {
    // rows 留空是有意的：服务端下发的 managed sections 仍按 id 合并进 rows，
    // 那一路不能因为这里换成磁贴就断掉。所以钉「tiles 在、rows 空」，
    // 而不是钉「rows 字段消失」。
    expect(bizSection).toContain("tiles: [");
    expect(bizSection).toContain("rows: []");
  });

  it("all four original destinations survive the consolidation", () => {
    for (const route of ["bdash", "recommendstore", "mystorerecs", "storerecqueue"]) {
      expect(meCode).toContain(`route: "${route}"`);
    }
  });

  it("STORE-REC-001's recommend-store entry is still a real menu row", () => {
    // 钉脚本 grep 的是 me.tsx 里的 `label: "推荐商铺进体系"`。这条入口从菜单组
    // 挪进了「推荐管理」页 —— 钉的意图（入口独立可达）没变，字符串必须还在，
    // 且必须配着它原来的路由。
    expect(meCode).toContain('label: "推荐商铺进体系"');
    expect(meCode).toContain('route: "recommendstore"');
  });

  it("推荐管理 renders those rows itself instead of falling back to the empty state", () => {
    expect(manageStart).toBeGreaterThan(-1);
    expect(manageBranch).toContain("STORE_REC_MANAGE_ROWS.map(");
    // 没有专属分支 ⇒ 通用兜底 ⇒ 只剩「正在准备这个工作区」。
    expect(meCode).toContain('subPage.route === "storerecmanage"');
  });

  it("both tiles point at a registered sub-page, so neither opens a generic page", () => {
    for (const route of ["bdash", "storerecmanage"]) {
      expect(meSubPage(route)).toBeDefined();
    }
    // 诚实：这一页是入口列表，不是一张编造的数据表。
    expect(SUB_PAGE_CONTENT.storerecmanage?.sections).toBeUndefined();
  });
});
