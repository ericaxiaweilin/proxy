import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_SEARCH_KINDS } from "./site-search";

// SITE-SEARCH-001（2026-09-29，用户：「把全站搜索做一下 全部搜索按钮的搜索功能 比如home页的搜索」）。
//
// 修之前：每个「搜索」按钮各搜各的——首页只在四宫格推荐实体里匹配、没命中落到「没有找到」的
// 死胡同；动态只筛已加载的帖子；消息只筛会话；我的只筛自己的帖子；场景页只筛场景；市场页只筛活动。
// 五个按钮五套范围，没有一个是「全站」。
//
// 这一份钉的是**接线**（谁把词带去全站搜索页、点中结果去哪里）。行为（打分 / 分组 / 来源独立成败 /
// 访客与短词的诚实报告）由 site-search.test.ts 与 site-search-service.test.ts 钉。
// 两者缺一不可：接线没了，纯逻辑再对也只是没人调用的代码；逻辑错了，接线再全也搜不对。
//
// 只看会跑的代码：去掉 /* */ 与整行 // 注释。
const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const shell = source("./shell/app-shell.tsx");
const home = source("./surfaces/requester-home.tsx");
const dock = source("./components/home-search-dock.tsx");
const service = source("./site-search-service.ts");
const surface = source("./surfaces/site-search.tsx");

describe("SITE-SEARCH-001 every search button reaches the site-wide search", () => {
  it("the shell hands openSiteSearch to every surface that has a search button", () => {
    for (const surfaceTag of ["<RequesterHome", "<MarketSurface", "<FeedSurface", "<MessagesSurface", "<MeSurface", "<HotScenesSurface", "<RealitySceneMapSurface"]) {
      const at = shell.indexOf(surfaceTag);
      expect(at, `${surfaceTag} not rendered by the shell`).toBeGreaterThan(-1);
      // 该标签的开头几行（属性区）里必须带上 onOpenSiteSearch。
      expect(shell.slice(at, at + 400), `${surfaceTag} must receive onOpenSiteSearch`).toContain("onOpenSiteSearch={openSiteSearch}");
    }
  });

  it("each surface declares the prop AND renders the entry (no empty-shell prop)", () => {
    const pairs: Array<[string, string]> = [
      ["./surfaces/feed.tsx", "<SiteSearchEntry"],
      ["./surfaces/messages.tsx", "<SiteSearchEntry"],
      ["./surfaces/me.tsx", "<SiteSearchEntry"],
      ["./surfaces/hot-scenes.tsx", "<SiteSearchEntry"],
      ["./surfaces/reality-scene-map.tsx", "<SiteSearchEntry"],
      ["./surfaces/market.tsx", "<SiteSearchEntry"],
    ];
    for (const [path, entry] of pairs) {
      const text = source(path);
      expect(text, `${path} declares onOpenSiteSearch`).toContain("onOpenSiteSearch");
      expect(text, `${path} renders the entry`).toContain(entry);
    }
  });

  it("the in-place search rows only appear once there is a word to carry (an empty row carries nothing)", () => {
    expect(source("./surfaces/feed.tsx")).toContain('searchOpen && onOpenSiteSearch && searchQuery.trim() !== ""');
    expect(source("./surfaces/messages.tsx")).toContain('searchOpen && onOpenSiteSearch && search.trim() !== ""');
    expect(source("./surfaces/me.tsx")).toContain('onOpenSiteSearch && searchQuery.trim() !== ""');
    expect(source("./surfaces/hot-scenes.tsx")).toContain('searchOpen && onOpenSiteSearch && query.trim() !== ""');
    expect(source("./surfaces/reality-scene-map.tsx")).toContain('searchOpen && onOpenSiteSearch && !onPickScene && query.trim() !== ""');
    expect(source("./surfaces/market.tsx")).toContain('onOpenSiteSearch && search.trim() !== ""');
    expect(dock).toContain('onOpenSiteSearch && value.trim() !== "" && !photo');
  });

  it("the scene picker map (activity create) offers no way out to unrelated search", () => {
    expect(source("./surfaces/reality-scene-map.tsx")).toContain("!onPickScene");
  });
});

describe("SITE-SEARCH-001 home: no dead end for a query the local picks miss", () => {
  it("hands the query to the site search before the 'not found' dead end", () => {
    const handoff = home.indexOf("onOpenSiteSearch({ query: q })");
    const deadEnd = home.indexOf('t("notFoundQuery", { q })');
    expect(handoff).toBeGreaterThan(-1);
    expect(deadEnd).toBeGreaterThan(-1);
    expect(handoff).toBeLessThan(deadEnd);
    // 只有「本地联想没命中 + 没带图 + 有回调」才移交；命中了走四宫格，带图走模型对话提示。
    expect(home).toContain("!consumedLocal && !attachment && onOpenSiteSearch");
  });

  it("the dock passes the word through and the chip never shows for an image-only input", () => {
    expect(home).toContain("onOpenSiteSearch: (query: string) => onOpenSiteSearch({ query })");
    expect(dock).toContain("onOpenSiteSearch(value.trim())");
  });
});

describe("SITE-SEARCH-001 the shell", () => {
  it("routes every result kind somewhere (an unhandled kind would be a dead row)", () => {
    const handler = shell.slice(shell.indexOf("function selectSiteSearchHit"), shell.indexOf("function openMarket"));
    for (const kind of SITE_SEARCH_KINDS) expect(handler, `case "${kind}"`).toContain(`case "${kind}"`);
  });

  it("opens each result at its own destination", () => {
    const handler = shell.slice(shell.indexOf("function selectSiteSearchHit"), shell.indexOf("function openMarket"));
    // 人 → 他人主页（带着搜索命中的名字 / 城市 / 头像）
    expect(handler).toContain("setOpenHumanProfile({");
    // 活动 → 活动详情（含活动报名订单）
    expect(handler).toContain("setActivityDetailId(hit.id)");
    expect(handler).toContain("setActivityDetailId(hit.activityId)");
    // 场景 → 场景地图直达该场景
    expect(handler).toContain("setRealitySceneSelection(hit.id)");
    // 机会 → 市场页直接落该条详情（完整对象来自搜索时拉到的列表，不依赖市场缓存）
    expect(handler).toContain("setFocusOpportunity(full)");
    // 订单 → 我的订单
    expect(handler).toContain('meSubPage("myorders")');
    // 动态 → 动态页，带着同一个词
    expect(handler).toContain("setFeedSearchSeed(siteSearchDraft.current.query.trim() || undefined)");
  });

  it("keeps the site search mounted underneath details, so 'back' returns to the same results", () => {
    expect(shell).toContain("siteSearchLayerHidden: { display: \"none\" }");
    expect(shell).toContain("siteSearchCovered");
    // 被详情盖住时是 display:none + pointerEvents none，而不是卸载。
    expect(shell).toMatch(/\{siteSearchOpen \? \(\s*<View pointerEvents=\{siteSearchCovered \? "none" : "auto"\}/);
  });

  it("hides the tab bar, blocks page swipes and answers Android back while the search is open", () => {
    expect(shell).toContain("!siteSearchOpen && !activityMapPickOpen");
    expect(shell).toContain("siteSearchOpenRef.current");
    expect(shell).toContain("if (siteSearchOpen && !siteSearchCovered) { closeSiteSearch(); return true; }");
  });

  it("opening it from the hot-scenes page or the scene map returns there on back", () => {
    expect(shell).toContain('siteSearchReturn.current = hotScenesOpen ? "HOT_SCENES" : realitySceneOpen ? "SCENE_MAP" : undefined');
    expect(shell).toContain('if (back === "HOT_SCENES") setHotScenesOpen(true)');
    expect(shell).toContain('if (back === "SCENE_MAP") setRealitySceneOpen(true)');
  });

  it("does not return to the search after leaving for a chat from a profile opened via search", () => {
    const onMessage = shell.slice(shell.indexOf("onMessage={(name, avatarUri) => {"), shell.indexOf("onMessage={(name, avatarUri) => {") + 500);
    expect(onMessage).toContain("setSiteSearchOpen(false)");
  });
});

describe("SITE-SEARCH-001 honesty and scope rules", () => {
  it("orders come only from the viewer's own lists — there is no site-wide order query", () => {
    expect(service).toContain("fulfillment.listMyOrders()");
    expect(service).toContain("activities.listMyActivities()");
    for (const forbidden of ["LookupByNumber", "LookupPublicNumber", "numberlookup", "listAllOrders", "operator"]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("the page tells the truth about failed / login-gated / too-short sources instead of showing 'not found'", () => {
    expect(surface).toContain('t("siteSearchFailed"');
    expect(surface).toContain('t("siteSearchNeedsLogin"');
    expect(surface).toContain('t("siteSearchTooShort")');
    // 「没有找到」只在没有任何来源失败时才出现
    expect(surface).toContain("current.hits.length === 0 && current.failed.length === 0");
  });

  it("never fabricates: no demo/sample data is imported into the search", () => {
    for (const file of [service, surface, source("./site-search.ts")]) {
      expect(file).not.toMatch(/fixtures|sample|mock|demo/i);
    }
  });

  it("every user-visible string on the page and the entry goes through i18n", () => {
    const entry = source("./components/site-search-entry.tsx");
    for (const text of [surface, entry]) {
      // JSX 文本节点里不许出现 CJK（styles / 注释已剥掉）
      expect(text.replace(/"[^"\n]*[一-鿿][^"\n]*"/g, "")).not.toMatch(/[一-鿿]/);
    }
  });
});
