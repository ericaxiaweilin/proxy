import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUB_PAGE_CONTENT, meSubPage } from "./me-sub-pages";

// STORE-TILES-001：「我的 → 企业 / 店铺」按产品稿从「4 行平铺」整合成
// 「2 个入口磁贴」（我的店铺 / 店铺推荐）。
//
// 这类「整合」最容易出的两种事故，就是本文件钉的两件事：
//   ① **整合着整合着把入口弄丢** —— 4 个目的地（bdash / recommendstore /
//      mystorerecs / storerecqueue）必须一个不少，只是换了层壳；
//   ② 新页「店铺推荐」落到通用兜底 —— 那种页面只渲染诚实空态，用户看到
//      「正在准备这个工作区」，3 条入口等于凭空消失。
//
// 断言前先剥注释：这些注释里复述了同样的标签，不剥的话把代码删掉测试照样绿
// （假守卫 —— 注释替代码把关）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const me = readFileSync(here("./me.tsx"), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(me);

// 「场景推荐」这一组的源码片段（STORE-TILES-003 之前叫「企业 / 店铺」）：
// 从 id: "biz" 到下一组 id: "account"。
const bizStart = meCode.indexOf('id: "biz"');
const bizEnd = meCode.indexOf('id: "account"', bizStart);
const bizSection = bizStart >= 0 && bizEnd > bizStart ? meCode.slice(bizStart, bizEnd) : "";

// 「店铺推荐」子页那一段。
const manageStart = meCode.indexOf('subPage.route === "storerecmanage"');
const manageBranch = manageStart >= 0 ? meCode.slice(manageStart, manageStart + 1200) : "";

describe("STORE-TILES-001 企业 / 店铺整合成两个入口磁贴", () => {
  it("the group carries exactly the two tiles from the product mock", () => {
    expect(bizStart).toBeGreaterThan(-1);
    expect(bizEnd).toBeGreaterThan(bizStart);
    // 2026-10-09：磁贴的 `desc`（「企业 · 经营 · 工作台」/「推荐 · 状态 · 审核」）随
    // 用户「把解释性的废话全部删除」一起删掉 —— 这里跟着收窄到**不变量**：
    // 两个磁贴的图标、名字和目的地。钉的意图（入口没丢）一个字没变。
    for (const tile of [
      // STORE-REC-BUILDER-001（2026-10-11）：用户侧「我的店铺」指向 myrecstores（我推荐、已入平台的店），
      // 不再是商家侧的 bdash。
      '{ icon: "home", label: "我的店铺", route: "myrecstores" }',
      '{ icon: "star", label: "店铺推荐", route: "storerecmanage" }'
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
    // bdash 仍在：它是商家侧「我的」页的店铺 hub，只是用户侧磁贴不再指向它。
    for (const route of ["bdash", "myrecstores", "recommendstore", "mystorerecs", "storerecqueue"]) {
      expect(meCode, `路由分支 ${route} 不见了`).toContain(`subPage.route === "${route}"`);
    }
  });

  it("STORE-REC-001's recommend-store entry keeps its pinned label", () => {
    // 钉脚本 grep 的是 me.tsx 里的 `label: "推荐商铺进体系"`。这条入口从菜单行
    // 变成了「店铺推荐」的页签② —— 钉的意图（入口独立可达）没变，字符串必须还在，
    // 且必须配着它原来的路由。
    // ⚠️ 设计稿（deepseek_html_20260925_38b4e5.html）把这一页签写成「推荐新店」。
    // 改用户可见文案是产品决定，不是我能顺手改的，所以这里沿用既有入口名。
    expect(meCode).toContain('label: "推荐商铺进体系"');
    // 文案必须配着它自己的页签 id 和路由分支 —— 只留一句文案、点进去是空的，
    // 那比把入口删掉更糟（用户以为功能没了）。
    expect(meCode).toContain('{ id: "new", label: "推荐商铺进体系" }');
    expect(meCode).toContain('subPage.route === "recommendstore"');
  });

  it("店铺推荐 renders the real experience instead of falling back to the empty state", () => {
    expect(manageStart).toBeGreaterThan(-1);
    expect(manageBranch).toContain("<StoreRecommendationManage");
    // 没有专属分支 ⇒ 通用兜底 ⇒ 只剩「正在准备这个工作区」。
    expect(meCode).toContain('subPage.route === "storerecmanage"');
    // 3 条入口收成 2 个页签 + 1 个运营入口，一个都没丢。
    expect(meCode).toContain("STORE_REC_MANAGE_TABS");
    expect(meCode).toContain("STORE_REC_QUEUE_ROW");
  });

  it("both tiles point at a registered sub-page, so neither opens a generic page", () => {
    for (const route of ["myrecstores", "storerecmanage"]) {
      expect(meSubPage(route)).toBeDefined();
    }
    // 诚实：这一页是入口列表，不是一张编造的数据表。
    expect(SUB_PAGE_CONTENT.storerecmanage?.sections).toBeUndefined();
  });
});

// STORE-TILES-002（2026-10-09）磁贴改名「推荐管理」→「店铺推荐」。
//
// 用户原话：「用户侧-我的店铺 推荐管理你是不是搞错了 搞混了和商家侧 如果容易搞混
// 就改名 店铺推荐」。名字来自产品稿 Revision 315，本轮由产品本人改掉。
//
// 为什么单独钉：这个名字住在**四个**用户可见的地方（磁贴 label / 子页标题 /
// SUB_PAGE_CONTENT 的 title / REC_TIP 里那句指路）。改一处漏三处就会出现
// 「磁贴叫 A、点进去标题叫 B」—— 用户没法判断这两个是不是同一个东西。
//
// 而且**正反两面都要钉**：只钉新名的话，把旧名加回某处照样全绿。
// （旧名在这几个文件的注释里还有 —— 那是引文和历史说明，所以断言前先剥注释。）
describe("STORE-TILES-002 改名后四处一致，且旧名不再出现", () => {
  const subPagesCode = stripComments(readFileSync(here("./me-sub-pages.ts"), "utf8"));
  const recModelCode = stripComments(readFileSync(here("./store-recommendation-manage-model.ts"), "utf8"));

  it("四个用户可见处都叫「店铺推荐」", () => {
    expect(meCode).toContain('label: "店铺推荐"');
    expect(meCode).toContain("styles.subPageTitle}>店铺推荐</Text>");
    expect(subPagesCode).toContain('title: "店铺推荐"');
    // REC_TIP 不再提「店铺推荐」（STORE-REC-BUILDER-001：不再指路去那里建店），改为指向「我的店铺」。
    expect(recModelCode).toContain("「我的店铺」");
  });

  it("旧名「推荐管理」在代码里（剥掉注释后）一处都不剩", () => {
    for (const [name, code] of [
      ["me.tsx", meCode],
      ["me-sub-pages.ts", subPagesCode],
      ["store-recommendation-manage-model.ts", recModelCode]
    ] as const) {
      expect(code, `${name} 里还留着旧名`).not.toContain("推荐管理");
    }
  });
});

// STORE-TILES-003（2026-10-09）分组标题改名「企业 / 店铺」→「场景推荐」。
//
// 用户原话：「把用户侧 我的-企业/店铺 改为 场景推荐」。这是 STORE-TILES-002 那条
// 抱怨的另一半：磁贴名改了，但**组名**还读作商家侧的经营模块（「企业 / 店铺」），
// 而并排的磁贴就叫「我的店铺」—— 两行叠在一起更像商家工作台。
//
// 为什么连 id 一起钉：effectiveSections 是**按 id** 把服务端下发的 managed rows
// 合并进本地分组的（`managedSections.find((m) => m.id === pSection.id)`）。
// 改标题安全；改 id 会让服务端那一路**静默**断掉 —— 页面看不出任何异常，
// 只是服务端加的入口凭空消失。所以「标题变了」和「id 没变」要一起钉。
describe("STORE-TILES-003 分组标题改为「场景推荐」，id 与磁贴不动", () => {
  it("组标题是「场景推荐」", () => {
    expect(bizStart).toBeGreaterThan(-1);
    expect(bizSection).toContain('title: "场景推荐"');
  });

  it("旧组标题「企业 / 店铺」不再作为任何组的 title（剥注释后）", () => {
    // 只钉 `title: "..."` 这个形状。me.tsx 里另有「企业 / 店铺资料」子页标题
    // （styles.subPageTitle 里的 JSX 文本）和 bdash 的历史叫法 —— 那是别的屏幕，
    // 不该被这条咬到。
    expect(meCode).not.toContain('title: "企业 / 店铺"');
  });

  it("分组 id 仍是 biz，且按 id 合并服务端 rows 的那一路还在", () => {
    expect(bizSection).toContain('id: "biz"');
    expect(meCode).toContain("m.id === pSection.id");
  });

  it("改名没有动两个磁贴与它们的路由", () => {
    expect(bizSection).toContain('label: "我的店铺"');
    expect(bizSection).toContain('label: "店铺推荐"');
    // STORE-REC-BUILDER-001：「我的店铺」磁贴指向 myrecstores，且这一组不再有商家侧的 bdash。
    expect(bizSection).toContain('route: "myrecstores"');
    expect(bizSection).not.toContain('route: "bdash"');
    expect(bizSection).toContain('route: "storerecmanage"');
  });
});
