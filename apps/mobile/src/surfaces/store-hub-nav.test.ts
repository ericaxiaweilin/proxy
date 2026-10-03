import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUB_PAGE_CONTENT } from "./me-sub-pages";

// STORE-HUB-NAV-001：修「我的店铺」三个毛病。
//
// 这轮修的是**导航和闭环**，不是样式，所以钉法也是结构钉（剥注释后 grep 源码形状）：
//   ① 一屏只能有一个返回。以前 me.tsx 的 bdash 分支画一个（退出整页）、hub 底部画一个
//      （同一个动作）、详情页顶上再画一个（回列表）⇒ 详情页有两个返回，而用户会点的
//      最上面那个直接把他踢出「我的店铺」。现在返回/标题归 hub 自己管。
//   ② 建店必须真的能建店。这一页以前没有任何建店动作 ⇒ 死路（与 merchant-storefront 里
//      「两处空态互相指'去别处建'，实际无入口」同一个 bug）。STORE-HUB-004 之后，
//      推荐管理 ACCEPTED 态的 CTA 直接落 merchantstorefront，不再绕经这一页。
//   ③ bdash 被改成店铺 hub 之后，原来指向它的入口不能跟着落到店铺列表上
//      （BUSINESS 的「Proxy 中心」、二维码页的 backRoute）。
//
// 剥注释是必须的：注释里复述了同样的标签，不剥的话把代码删掉测试照样绿。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meCode = stripComments(readFileSync(here("./me.tsx"), "utf8"));
const hubCode = stripComments(readFileSync(here("./my-stores-hub.tsx"), "utf8"));
const manageCode = stripComments(readFileSync(here("./store-recommendation-manage.tsx"), "utf8"));
const recModelCode = stripComments(readFileSync(here("./store-recommendation-manage-model.ts"), "utf8"));

// bdash 分支：从 `subPage.route === "bdash"` 到 `subPage.route === "bdashprofile"`。
const bdashStart = meCode.indexOf('subPage.route === "bdash"');
const bdashEnd = meCode.indexOf('subPage.route === "bdashprofile"', bdashStart);
const bdashBranch = bdashStart >= 0 && bdashEnd > bdashStart ? meCode.slice(bdashStart, bdashEnd) : "";

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("STORE-HUB-NAV-001 我的店铺的返回只有一个", () => {
  it("bdash 分支不再自己画返回和标题（否则详情页会有两个返回）", () => {
    expect(bdashStart).toBeGreaterThan(-1);
    expect(bdashEnd).toBeGreaterThan(bdashStart);
    // 这一层画了 back ⇒ 详情页顶上会多一个「退出整页」的返回，盖在 hub 自己的返回上面。
    expect(bdashBranch).not.toContain("styles.subPageBack");
    expect(bdashBranch).not.toContain("styles.subPageTitle");
    // 但内容必须还在（别把整段删了让测试变绿）。
    expect(bdashBranch).toContain("<MyStoresHub");
  });

  it("hub 只有一个返回条，列表态退出、详情态回列表", () => {
    // 全组件只有一处 backRow —— 以前底部那个重复的返回就在这里。
    expect(countOf(hubCode, "s.backRow")).toBe(1);
    expect(hubCode).toContain("function HubNav(");
    // 两种落点各一次：列表态退到「我的」，详情态回列表。
    //
    // BACK-GLYPH-001（2026-09-26）：label 现在只写**文字**。原来传的是 `"‹ 返回"`
    // —— `‹` 是文本引号、不是箭头，而且 2026-09-25 那次 PROFILE-QR-003 提交把它
    // 退成了裸 `"‹"`（只有字形、没有目的地），正是这条钉要防的事：标签不写目的地，
    // 就是替用户猜。现在字形由公共原语 ProxyBackGlyph 画，`‹` 从源码里消失。
    expect(hubCode).toContain('backLabel="返回" onBack={onBack}');
    expect(hubCode).toContain('backLabel="返回店铺列表"');
    // 字形必须来自公共原语，不许再手写字符字形（剥过注释，所以这条是真断言）。
    expect(hubCode).toContain("<ProxyBackGlyph label={backLabel} />");
    expect(hubCode).not.toContain("‹");
    // 详情态的回调必须回列表（setSelectedId(undefined)），不能是 onBack（退出整页）。
    // STORE-ASSET-SCOPE-001：同一次返回顺手把资产子视图也清掉 —— 否则从店 A 的子视图
    // 退回列表、再进店 B，会直接落在 B 的「菜单与价格」上。
    expect(hubCode).toContain("onBack={() => { setSelectedId(undefined); setCopied(false); setShowAssets(undefined); }}");
  });

  it("标题只有一处出处，且就是子页登记的那个", () => {
    expect(SUB_PAGE_CONTENT.bdash?.title).toBe("我的店铺");
    expect(hubCode).toContain("SUB_PAGE_CONTENT.bdash?.title");
    // hub 自己不再写死第二个标题字面量（fallback 除外）。
    expect(hubCode).toContain("const HUB_TITLE =");
  });
});

describe("STORE-HUB-NAV-001 建店闭环", () => {
  // STORE-CONSOLIDATE-001（2026-10-02，用户「管理别人看到你的店 有重复的ab版本」
  // 选收编）：建店不再绕 merchantstorefront —— 那边现在就是 hub 本体，绕一圈回到
  // 原地。空态 CTA 直连企业运营助手（建店本来就是助手的事）。
  // 注意这是对 STORE-HUB-MOVE-001 的**反转**：原来"建店/二维码归推荐管理"，
  // 现在 hub 自己就是唯一的管店入口，所以建店也从这里直连助手。
  it("hub 只有空态一个建店入口，列表态不摆建店/资料行", () => {
    expect(meCode).toContain('onOpenStoreCreate={() => openSubPage("enterpriseops")}');
    expect(meCode).not.toContain('onOpenStoreCreate={() => openSubPage("merchantstorefront")}');
    // 三处：hub props（解构+类型）+ 空态 CTA 的 onPress。空态 CTA 走的是传进来的
    // prop，不在 hub 里硬编码目标 —— 所以这里是 3 不是 4。
    // （原来第 4 处是资产子视图的 onStartStoreSetup：STORE-ASSET-SCOPE-001 之后子视图
    // 只画被选中的那一家，空态在那一屏根本渲染不出来，传了也是死 prop。）
    expect(countOf(hubCode, "onOpenStoreCreate")).toBe(3);
    expect(hubCode).toContain('accessibilityLabel="建店"');
    expect(hubCode).not.toContain("建店 / 添加门店");
    expect(hubCode).not.toContain("店铺资料与二维码");
  });

  it("推荐管理摆体系接入两行：建店走建店流程，二维码看门店名片", () => {
    expect(manageCode).toContain("建店 / 添加门店");
    expect(manageCode).toContain("店铺资料与二维码");
    expect(manageCode).toContain("onOpenStoreProfile");
  });

  it("空态不再承诺「推荐被签约后自动进来」—— 那是跟服务端相反的说法", () => {
    // 服务端语义：采纳 ≠ 店铺已存在（见 store-recommendation-manage-model.ts）。
    expect(hubCode).not.toContain("自动进来");
    expect(hubCode).toContain("推荐被采纳不等于店铺已存在");
  });
});

describe("STORE-HUB-NAV-001 bdash 改语义后，老入口不跟着漂", () => {
  it("BUSINESS 的「Proxy 中心」不再落到店铺列表", () => {
    const row = meCode.slice(meCode.indexOf('label: "Proxy 中心"'), meCode.indexOf('label: "Proxy 中心"') + 200);
    expect(row).toContain('route: "bdashprofile"');
  });

  it("二维码页的 backRoute 回到店铺资料页，而不是 hub", () => {
    // ⚠️ 不能用 `not.toContain('backRoute: "bdash"')` —— "bdashprofile" 的前缀就是它，
    // 那样写是恒假断言（假守卫）。钉带引号收尾的完整字面量。
    expect(meCode).toContain('backRoute: "bdashprofile"');
    expect(meCode).not.toContain('backRoute: "bdash"');
  });
});

// STORE-HUB-003（2026-09-25，产品决定）：「我的店铺」里**没有**推荐管理。
//
// STORE-HUB-002 在页内加过「店铺 | 推荐管理」分段 tab（把 StoreRecommendationManage
// 直接嵌进来），用户看实机截图后否掉了 —— 原型 2ef163 的「我的店铺」就是一张店铺列表；
// 推荐管理在「我的 → 企业 / 店铺」已经是独立磁贴，页内再嵌一遍等于同一个功能两个入口。
// 连空态文案里那句「……或先去「推荐管理」推荐新店」也去掉了：这一页只留店铺，不再指路。
//
// ⚠️ 删「页内入口」最容易顺手把**整条路**删掉（这正是 store-section-tiles.test.ts
// 钉的那类事故），所以这里两条一起钉：页面里没有它，但路由和磁贴都还在。
describe("STORE-HUB-003 我的店铺里没有推荐管理", () => {
  it("页内不再有分段 tab，也不再嵌推荐管理组件", () => {
    expect(hubCode).not.toContain("hubTab");
    expect(hubCode).not.toContain("StoreRecommendationManage");
    // 剥注释之后，这一页一个字都不许再出现「推荐管理」—— 包括空态文案里那句指路。
    // 用户的原话是「我的店铺是没有推荐管理的」，所以钉的是**零出现**，不是「没有 tab」。
    expect(hubCode).not.toContain("推荐管理");
    // 样式一起删：留着就是死样式，下一个人会以为还有 tab。
    expect(hubCode).not.toContain("s.tabs");
    expect(hubCode).not.toContain("tabTextOn");
  });

  it("me.tsx 也不再往 hub 传推荐页签的 props", () => {
    expect(meCode).not.toContain("recommendTabs");
    expect(meCode).not.toContain("onOpenRecQueue");
  });

  it("但推荐管理的可达性没丢 —— 路由分支和磁贴都还在", () => {
    expect(meCode).toContain('subPage.route === "storerecmanage"');
    expect(meCode).toContain('label: "推荐管理"');
  });
});

// STORE-HUB-004（2026-09-25，用户定的分工）：
//   「推荐管理」= workspace —— 在飞的推荐在这里处理，**建店也属于这里**；
//   「我的店铺」= 只放**已经处理完**的店（真实存在的店）。
// 推论：还没建出来的店不在「我的店铺」里 ⇒ 任何把它指过去的入口都是空指；
// 反过来，「我的店铺」也不许把在飞的推荐掺进来（那不是"处理完的"）。
describe("STORE-HUB-004 建店属于推荐管理，不属于我的店铺", () => {
  it("推荐管理 ACCEPTED 的 CTA 直接落建店流程，不再绕经我的店铺", () => {
    // 三处挂载（页签① / 页签② / 直落路由）都要改，漏一处就还是空指。
    expect(countOf(meCode, 'onOpenStore={() => openSubPage("merchantstorefront")}')).toBe(3);
    expect(meCode).not.toContain('onOpenStore={() => openSubPage("bdash")}');
  });

  it("按钮和「下一步」文案不再说「去我的店铺」", () => {
    expect(manageCode).not.toContain("去我的店铺");
    expect(recModelCode).not.toContain("去「我的店铺」");
    // 但仍必须说清「要有人把它建出来」—— 采纳 ≠ 店铺已存在。
    expect(recModelCode).toContain("把店建出来");
  });

  it("推荐管理 不说「在『我的店铺』里建店」—— 建店不发生在那一屏", () => {
    // 「出现在「我的店铺」」是对的（建完才会出现在那里）；
    // 「在「我的店铺」里建出来」是空指 —— 建店入口在 merchantstorefront。
    expect(recModelCode).not.toContain("在「我的店铺」里");
  });

  it("我的店铺 只放已经处理完的店 —— 它不读推荐记录", () => {
    // 钉住「不要把在飞的推荐掺进我的店铺」这个决定：一旦有人接上
    // listMyRecommendations，这里立刻红。
    expect(hubCode).not.toContain("listMyRecommendations");
    expect(hubCode).not.toContain("StoreRecommendation");
  });
});
