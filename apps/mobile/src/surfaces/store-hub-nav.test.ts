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
//   ② 「去我的店铺建店」必须真的能建店。推荐管理 ACCEPTED 态的 CTA 落点就是这一页，
//      而这一页以前没有任何建店动作 ⇒ 死路（与 merchant-storefront 里「两处空态互相指
//      '去别处建'，实际无入口」同一个 bug）。
//   ③ bdash 被改成店铺 hub 之后，原来指向它的入口不能跟着落到店铺列表上
//      （BUSINESS 的「Proxy 中心」、二维码页的 backRoute）。
//
// 剥注释是必须的：注释里复述了同样的标签，不剥的话把代码删掉测试照样绿。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const meCode = stripComments(readFileSync(here("./me.tsx"), "utf8"));
const hubCode = stripComments(readFileSync(here("./my-stores-hub.tsx"), "utf8"));

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
    expect(hubCode).toContain('backLabel="‹ 返回" onBack={onBack}');
    expect(hubCode).toContain('backLabel="‹ 返回店铺列表"');
    // 详情态的回调必须回列表（setSelectedId(undefined)），不能是 onBack（退出整页）。
    expect(hubCode).toContain("onBack={() => { setSelectedId(undefined); setCopied(false); }}");
  });

  it("标题只有一处出处，且就是子页登记的那个", () => {
    expect(SUB_PAGE_CONTENT.bdash?.title).toBe("我的店铺");
    expect(hubCode).toContain("SUB_PAGE_CONTENT.bdash?.title");
    // hub 自己不再写死第二个标题字面量（fallback 除外）。
    expect(hubCode).toContain("const HUB_TITLE =");
  });
});

describe("STORE-HUB-NAV-001 建店闭环", () => {
  it("hub 有建店入口，且落到全 App 唯一的建店流程", () => {
    expect(meCode).toContain('onOpenStoreCreate={() => openSubPage("merchantstorefront")}');
    // 两处：空态的「建店」和页脚的「建店 / 添加门店」。
    expect(countOf(hubCode, "onOpenStoreCreate")).toBeGreaterThanOrEqual(3);
    expect(hubCode).toContain('accessibilityLabel="建店"');
    expect(hubCode).toContain("建店 / 添加门店");
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
