import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// STORE-CONSOLIDATE-001（2026-10-02，用户「管理别人看到你的店 有重复的ab版本」选收编）
//
// 现场："我的"里有两个管店入口 —— 「线上店铺」（merchantstorefront →
// MerchantStorefrontSurface，标题就叫"管理别人看到你的店"）和「我的店铺」
// （bdash → MyStoresHub）。菜单、照片、营业资料两边都能管；而且同一个
// MerchantStorefrontSurface 还在 merchant-me-r21 里又被嵌了一遍，状态不共享。
//
// 收编后：唯一的管店入口是 MyStoresHub。二维码 / 菜品 / 券 / Creator 四样都在
// 店详情里（券和 Creator 直接搬，二维码是单店组件，菜品是只看列表 + 编辑走
// 原子页子视图）。merchantstorefront 路由改渲染 hub，不再是第二套管店页。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("STORE-CONSOLIDATE-001 管店只有一个入口", () => {
  const me = strip(read("./surfaces/me.tsx"));
  const hub = strip(read("./surfaces/my-stores-hub.tsx"));
  const biz = strip(read("./surfaces/merchant-me-r21-replacement.tsx"));

  it("菜单里只有一个管店入口：线上店铺 tile 已并入我的店铺", () => {
    // 用户看到的"重复的2个"就是这两个 tile（点进去早已是同一页）。
    // 路由保留给深链，删的只是菜单 tile —— 下一个人别把它加回来。
    expect(me).not.toContain('label: "线上店铺"');
    expect(me).toContain('label: "我的店铺"');
  });

  it("商家主页底部的快捷行里也没有第二个线上店铺", () => {
    // business-home 底部 quickRow 里曾经也有一个"线上店铺"，点下去只是 onOpenMe
    // （落到"我的"页还要再找一次）。三个按钮（线上店铺/结果复盘/客户）onPress
    // 全是同一个 onOpenMe —— 剩下两个名不副实，但那是另一条，这里只钉"线上店铺"。
    const home = read("./surfaces/business-home.tsx");
    expect(home).not.toContain('label: "线上店铺"');
  });

  it("merchantstorefront 路由渲染的是统一 hub，不再是第二套管店页", () => {
    const route = me.slice(me.indexOf('subPage.route === "merchantstorefront"'));
    expect(route).toContain("<MyStoresHub");
    // 反向：这条路由里不许再出现旧 surface，否则"收编"只是嘴上说说。
    // 注意只查路由块内 —— hub 的资产编辑子视图里调它是合法的（见下）。
    const routeEnd = route.indexOf('subPage.route === "bdashprofile"');
    expect(route.slice(0, routeEnd)).not.toContain("<MerchantStorefrontSurface");
  });

  it("BUSINESS 上下文的店页也是同一个 hub，不是第三套", () => {
    const storePage = biz.slice(biz.indexOf('if (page === "store")'));
    expect(storePage).toContain("<MyStoresHub");
    expect(storePage).not.toContain("<MerchantStorefrontSurface");
  });

  // 店照片是收编时漏掉的一块：旧面"照片与内容"那一节没搬过来，导致店详情里
  // 一张图都看不到（用户原话"店铺信息显示不全"）。B 口径同样只看不编辑。
  it("店详情里有照片区（只看，编辑走原子页）", () => {
    const hub = read("./surfaces/my-stores-hub.tsx");
    expect(hub).toContain("listStorePhotos");
    expect(hub).toContain("店铺照片");
    expect(hub).toContain("photoWall");
    expect(hub).not.toMatch(/删除照片|上传照片|startEditPhoto/);
  });

  it("四样都在店详情里：券、Creator、二维码、菜品", () => {
    expect(hub).toContain("onOpenVouchers");
    expect(hub).toContain("Creator 权益");
    expect(hub).toContain("<StoreQrCard");
    expect(hub).toContain("onManageProducts");
  });

  it("菜品只看不编辑：详情里没有增删改，编辑走原子页子视图", () => {
    //详情里出现"添加/编辑/删除菜品"字样 = 有人在详情里又写了一套编辑态。
    const detail = hub.slice(hub.indexOf("function StoreDetail"));
    expect(detail).not.toMatch(/添加菜单|编辑菜品|删除菜品|startEditProduct/);
    // 但"管理菜品"必须在 —— 否则编辑就没入口了。
    expect(detail).toContain("onManageProducts");
    expect(hub).toContain("showAssets");
  });

  it("建店直连助手，不绕已经不存在的第二入口", () => {
    expect(me).toContain('onOpenStoreCreate={() => openSubPage("enterpriseops")}');
    expect(me).not.toContain('onOpenStoreCreate={() => openSubPage("merchantstorefront")}');
  });
});

// UX-DIRECT-EDIT-001（2026-10-03，用户「藏的太深了 谁能找到」）：
// 店详情的营业资料节直接给"编辑"按钮，点进去就是表单 —— 不再让用户先点
// "编辑经营资料"进子视图、再在里面找"编辑主页"点第二下。
describe("UX-DIRECT-EDIT-001 店详情直达编辑表单", () => {
  const hub = read("./surfaces/my-stores-hub.tsx");

  it("营业资料节有行内编辑按钮", () => {
    expect(hub).toContain('accessibilityLabel="编辑店铺信息"');
    expect(hub).toContain("onEditDetails");
  });

  it("两个编辑入口都直达表单（行为一致，不看点的是哪个）", () => {
    const hub = read("./surfaces/my-stores-hub.tsx");
    // "编辑店铺信息"和"编辑经营资料"都调 onEditDetails —— 留两个入口但行为必须
    // 一致，不然用户点的那个决定了他要跳几下（"还是编辑-编辑主页"的来源）。
    expect(hub.match(/onPress=\{onEditDetails\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("autoEdit 信号真的传到原子页（state 在 hub，prop 必须过去）", () => {
    // 这行丢过一次：state 和 setter 都在，但调用处没传 prop，自动展开静默失效。
    // 症状就是"还是要点击编辑主页"。
    expect(hub).toContain("autoEditStoreId={autoEditStore ? selected.store.id : undefined}");
  });

  it("点进去自动展开表单（只开一次，关掉不再弹）", () => {
    expect(hub).toContain("autoEditStore");
    const atomic = read("./surfaces/merchant-storefront.tsx");
    expect(atomic).toContain("autoEditStoreId");
    expect(atomic).toContain("autoEditDoneRef");
  });

  it("等行到了再开，不拿空表单糊弄", () => {
    const atomic = read("./surfaces/merchant-storefront.tsx");
    // 空表单先开的话用户看到空白以为没数据，手快还会覆盖服务端值。
    expect(atomic).toContain("if (current === undefined) return;");
  });
});
