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
    // STORE-REC-MANAGE-001 之后前 3 条换了层壳（菜单行 → 页签 / 页脚行），
    // 但**路由分支一个都没删**：旧的深链（mystorerecs / recommendstore）还得能到，
    // 队列对 BUSINESS 身份也仍然可达。少一个分支 = 少一个目的地。
    for (const route of ["bdash", "recommendstore", "mystorerecs", "storerecqueue"]) {
      expect(meCode, `路由分支 ${route} 不见了`).toContain(`subPage.route === "${route}"`);
    }
  });

  it("STORE-REC-001's recommend-store entry keeps its pinned label", () => {
    // 钉脚本 grep 的是 me.tsx 里的 `label: "推荐商铺进体系"`。这条入口从菜单行
    // 变成了「推荐管理」的页签② —— 钉的意图（入口独立可达）没变，字符串必须还在，
    // 且必须配着它原来的路由。
    // ⚠️ 设计稿（deepseek_html_20260925_38b4e5.html）把这一页签写成「推荐新店」。
    // 改用户可见文案是产品决定，不是我能顺手改的，所以这里沿用既有入口名。
    expect(meCode).toContain('label: "推荐商铺进体系"');
    // 文案必须配着它自己的页签 id 和路由分支 —— 只留一句文案、点进去是空的，
    // 那比把入口删掉更糟（用户以为功能没了）。
    expect(meCode).toContain('{ id: "new", label: "推荐商铺进体系" }');
    expect(meCode).toContain('subPage.route === "recommendstore"');
  });

  it("推荐管理 renders the real experience instead of falling back to the empty state", () => {
    expect(manageStart).toBeGreaterThan(-1);
    expect(manageBranch).toContain("<StoreRecommendationManage");
    // 没有专属分支 ⇒ 通用兜底 ⇒ 只剩「正在准备这个工作区」。
    expect(meCode).toContain('subPage.route === "storerecmanage"');
    // 3 条入口收成 2 个页签 + 1 个运营入口，一个都没丢。
    expect(meCode).toContain("STORE_REC_MANAGE_TABS");
    expect(meCode).toContain("STORE_REC_QUEUE_ROW");
  });

  it("both tiles point at a registered sub-page, so neither opens a generic page", () => {
    for (const route of ["bdash", "storerecmanage"]) {
      expect(meSubPage(route)).toBeDefined();
    }
    // 诚实：这一页是入口列表，不是一张编造的数据表。
    expect(SUB_PAGE_CONTENT.storerecmanage?.sections).toBeUndefined();
  });
});
