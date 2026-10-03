import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// STORE-ASSET-SCOPE-001（2026-10-02，用户「这个还是有重复的」+ 实机截图）：
//
// STORE-CONSOLIDATE-001 把「线上店铺」并进 hub 时，资产编辑子视图是**整页嵌**
// MerchantStorefrontSurface —— 而那一页作为独立整页时，外壳就是它的内容：主体抬头
// 「管理别人看到你的店」、门店身份卡、分享店铺、店铺二维码、经营数字条、资产列表、
// 活动/Offer、Creator 权益、口径说明。嵌进店详情之后，这些全部变成店详情已有内容的
// **第二份**：同一个店名一屏出现三次（返回条 / 身份卡 / 主体抬头），二维码卡和经营
// 数字两边各一份，券和 Creator 也是两边各一份。更糟的是它按 accounts.map 渲染，
// 在「返回某一家店」的页面里把**别的主体、别的门店**一起铺出来。
//
// 修法是给原子页一个作用域：只画被选中的那一家、只画要编的那一节，外壳交给 hub。
// 中间那层「资产管理」列表因此没有落脚点了 —— 但它的三个目的地必须各自还在（下面
// 第二条钉），否则"去重"会变成"把能力删了"。
const hub = readFileSync(new URL("./my-stores-hub.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const face = readFileSync(new URL("./merchant-storefront.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

describe("STORE-ASSET-SCOPE-001", () => {
  it("the embedded asset view is scoped to the one store and the one section", () => {
    expect(hub).toContain("scope={{ storeId: selected.store.id, page: showAssets }}");
    // 原子页必须真的按作用域过滤门店，而不是收下 props 继续整页铺。
    expect(face).toContain("allStores.filter((s) => s.id === scope.storeId)");
    expect(face).toContain("if (scope && aStores.length === 0) return null;");
    // 子视图的页由宿主定：没有作用域时才回到自己的资产列表（独立整页那条路还在）。
    expect(face).toContain("const currentPage: StoreAssetPage = scope ? scope.page");
  });

  it("the duplicated shell only renders for the standalone page", () => {
    // 主体抬头 / 资产列表 / 口径说明：各自被 scope 挡住。
    for (const [marker, label] of [
      ["{scope ? null : <View style={styles.accountHead}>", "主体抬头「管理别人看到你的店」"],
      ["{scope ? null : currentPage === \"root\" ? <View style={styles.assetSection}>", "资产列表（含返回行）"],
      ["{scope ? null : <View style={styles.scopeNote}>", "口径说明"],
    ] as const) {
      expect(face, `${label} 又画了第二份`).toContain(marker);
    }
    // 身份卡 / 分享 / 二维码卡 / 经营数字条：一起被同一个片段包住（它们中间夹着
    // JSX 注释，逐块挡会漏掉夹在中间的那一块，所以钉的是"同一段被同一个 scope 挡住"）。
    const fragOpen = face.indexOf("{scope ? null : <>");
    const fragClose = face.indexOf("</>}", fragOpen);
    expect(fragOpen).toBeGreaterThan(-1);
    expect(fragClose).toBeGreaterThan(fragOpen);
    for (const marker of ["styles.storeHero", "Share.share", "styles.qrCard", "styles.metricStrip"]) {
      const at = face.indexOf(marker, fragOpen);
      expect(at, `${marker} 不在被挡住的那段里`).toBeGreaterThan(-1);
      expect(at, `${marker} 在子视图里还会渲染`).toBeLessThan(fragClose);
    }
    // 这段必须在资产列表之前收掉 —— 否则把下面的编辑面板也一起藏了，子视图就是空的。
    expect(fragClose).toBeLessThan(face.indexOf("styles.assetSection"));
    // 中间那层「资产管理」标题整页消失（hub 里不许再有）。
    expect(hub).not.toContain("资产管理");
  });

  it("keeps an entry for every section the removed middle page used to offer", () => {
    // 删中间页最容易顺手删掉能力：三个目的地必须各有一个入口，且指名去哪一节。
    for (const call of [
      'onManageProducts("menu")',
      'onManageProducts("photos")',
      'onManageProducts("details")',
    ]) {
      expect(hub).toContain(call);
    }
    // 营业资料（简介 / 联系方式 / 营业时间）的编辑入口挂在「店铺信息」那一节上。
    expect(hub).toContain('accessibilityLabel="编辑经营资料"');
  });

  it("clears the sub-view when leaving the store, so the next store opens its detail", () => {
    // 从 A 店的子视图退回列表、再进店 B ⇒ 必须落在 B 的详情，而不是 B 的「菜单与价格」。
    const pick = hub.slice(hub.indexOf("onPress={() => { setSelectedId(row.store.id);"), hub.indexOf("onPress={() => { setSelectedId(row.store.id);") + 120);
    expect(pick).toContain("setShowAssets(undefined)");
    const detailBack = hub.slice(hub.indexOf('backLabel="返回店铺列表"'));
    expect(detailBack.slice(0, 160)).toContain("setShowAssets(undefined)");
  });
});
