import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./scene-activity-discovery.tsx", import.meta.url)), "utf8");
const rail = readFileSync(fileURLToPath(new URL("./horizontal-swipe-rail.tsx", import.meta.url)), "utf8");

describe("scene activity discovery contract", () => {
  it("keeps Action and Theme as independent semantic atoms (Scene is card metadata, not a top-level filter)", () => {
    expect(source).toContain('id: "cycling"');
    expect(source).toContain('id: "old-town"');
    expect(source).toContain('id: "ao-dai"');
    expect(source).toContain("moment.action === actionMatchId(actionId)");
    expect(source).toContain("matchesRefine");
  });

  // SCENE-PICKER-FILTER-ROWS-001 (2026-09-21): Scene and Action were both
  // top-level filters, but in this data Scene is nearly 1:1 with Action
  // (咖啡 → 咖啡馆, City Walk → 老城区…), so it added a filter row that
  // barely filtered anything. sceneId/setSceneId are gone entirely — Scene
  // now only ever shows up as a read-only tag on a Moment card/detail.
  it("SCENE-PICKER-FILTER-ROWS-001: sceneId is not a filter dimension anymore", () => {
    expect(source).not.toContain("sceneId, setSceneId");
    expect(source).not.toContain("setSceneId(");
  });

  it("ships the complete R42 visual taxonomy", () => {
    expect(source.match(/assets\/scene-activity\/actions\//g)).toHaveLength(32);
    expect(source.match(/assets\/scene-activity\/scenes\//g)).toHaveLength(11);
    expect(source.match(/assets\/scene-activity\/themes\//g)).toHaveLength(11);
  });

  it("opens a real server scene rather than treating a semantic category as a venue", () => {
    expect(source).toContain("liveSceneFor(detail.scene)");
    expect(source).toContain("onOpenScene?.(target.id)");
    expect(source).not.toContain("onOpenScene?.(detail.scene)");
  });

  // SCENE-PICKER-FILTER-SINGLE-ROW-003 (2026-09-21, user follow-up + explicit
  // sign-off): this used to hard-forbid the word "price" — a guard against
  // showing a price filter with no real per-Moment price behind it. The user
  // was told exactly that ("金额 has no real data wired to Moments yet, this
  // would be a placeholder"), and after that explicit warning still chose to
  // ship a 金额 filter now rather than wait for real Activity/RealityScene
  // price plumbing. That is a commander-level call on this repo (AGENTS.md:
  // gate changes are commander-owned infrastructure changes), so the guard is
  // updated, not silently bypassed. moneyFlow/humanIds/年龄 remain forbidden —
  // nothing about this change touches order settlement or human inventory.
  it("SCENE-PICKER-FILTER-SINGLE-ROW-003: 金额 is an explicit placeholder filter, not real settlement data", () => {
    expect(source).not.toMatch(/moneyFlow|humanIds|年龄/);
    expect(source).toContain("PRICE_OPTIONS");
    expect(source).toContain("占位字段");
  });

  // SCENE-HOME-ENTRY-001 (2026-09-24, prototype deepseek_html_20260924_412dba
  // 「Scene · 精修版」首页): the home action row is now the prototype's 6
  // fixed equal-width items — there is nothing left to scroll, so the
  // HorizontalSwipeRail wrapper (and the tap-vs-swipe disambiguation it
  // existed for) is gone from this file. The 8 secondary actions and 17
  // sub-details are still one tap away through 「全部」.
  //
  // Asserting the import is *gone* is the point: re-adding a horizontal swipe
  // surface on Home for a row that already fits would buy nothing and fight
  // the iOS system tab-switch gesture again.
  it("SCENE-HOME-ENTRY-001: the home action row is a fixed 6-item row with no horizontal swipe surface", () => {
    expect(source).not.toContain("HorizontalSwipeRail");
    expect(source).not.toContain("preserveChildPresses");
    expect(source).not.toContain("styles.actionRail");
    // The 6 ids themselves live in ../scene-category-entries and are pinned by
    // behaviour there (including "every primary action has keywords, so no
    // button on that row is dead"). Here we only pin that the row is built
    // from that single source rather than a second hardcoded list.
    expect(source).toContain('import { PRIMARY_ACTION_IDS, sceneCategoryEntries } from "../scene-category-entries";');
    expect(source).toContain("PRIMARY_ACTION_IDS.map");
    expect(source).toContain("styles.actionRow");
    expect(source).toContain("PRIMARY_ACTIONS.map");
    // The full taxonomy is still reachable, and still complete.
    expect(source).toContain("setPickerOpen(true)");
    expect((source.match(/assets\/scene-activity\/actions\//g) ?? [])).toHaveLength(32);
    // The rail itself is unchanged and still used by Home's other rails
    // (stories / person chooser / photo & time choosers) — its tap-vs-swipe
    // contract still has to hold there.
    expect(rail).toContain("onStartShouldSetPanResponder: () => !preserveChildPresses");
    expect(rail).toContain("!preserveChildPresses || Math.abs(gs.dx) > threshold");
  });

  it("keeps one compact Action row and opens the full picker from one 全部 button", () => {
    expect(source).toContain("setPickerOpen(true)");
    expect(source).not.toContain('<SectionHead label="场景"');
    expect(source).not.toContain('<SectionHead label="主题"');
    expect(source).toContain("styles.actionGlyph");
    expect(source).not.toContain("styles.actionCard");
  });

  // SCENE-PICKER-WAIMAI-001 (2026-09-20): three equal-weight stacked grids
  // (动作×14 + 场景×11 + 主题×9, plus 17 action sub-details) AND-filtering a
  // 10-item local fixture was information overload for what it actually
  // filters — most combinations landed on the empty state. Replaced with a
  // waimai-style single left-rail category (动作, the one users actually
  // reach for first) + a right list of matching Moments; 场景/主题 are now
  // lightweight secondary chips, not a second and third equal grid.
  it("SCENE-PICKER-WAIMAI-001: uses a single left-rail category, not three equal-weight grids", () => {
    expect(source).not.toContain('{ key: "actions", label: "动作", items: ACTIONS }');
    expect(source).not.toContain('{ key: "scenes", label: "场景", items: SCENES }');
    expect(source).not.toContain('{ key: "themes", label: "主题", items: THEMES }');
    expect(source).toContain("styles.waimaiRail");
    expect(source).toContain("styles.waimaiList");
    // SCENE-HOME-ENTRY-001: the right column used to be a list of small rows
    // (waimaiMomentRow, 64px thumb). It now renders the big single-column
    // Moment cards that used to live on Home — same content, same favourite
    // and expand behaviour, moved behind the category entry instead of
    // deleted.
    expect(source).toContain("styles.sceneCard");
    expect(source).not.toContain("styles.waimaiMomentRow");
    // Per-category counts so a user can see before tapping whether a
    // category actually has anything, instead of discovering an empty
    // state only after combining several filters.
    expect(source).toContain("styles.waimaiRailCount");
  });

  // SCENE-PICKER-WAIMAI-001 (2026-09-21): the picker was a partial-height
  // bottom sheet (backdrop tap to dismiss, drag handle, maxHeight "84%") —
  // a left-rail + right-list browsing screen is meant to be used as a full
  // page, not squeezed into a sheet that leaves a sliver of the page behind
  // it showing. Now a full page with a "‹ 返回" header, matching how every
  // other full-screen surface in this app closes.
  it("SCENE-PICKER-WAIMAI-001: the picker is a full page with a back button, not a dismissible bottom sheet", () => {
    const start = source.indexOf("<Modal animationType=\"slide\" onRequestClose={() => setPickerOpen(false)}");
    expect(start).toBeGreaterThan(-1);
    const pickerModal = source.slice(start, source.indexOf("</Modal>", start));
    expect(pickerModal).toContain("‹ 返回");
    expect(pickerModal).toContain("styles.pickerPage");
    // No more backdrop-tap-to-dismiss or bottom-sheet framing on this modal.
    expect(pickerModal).not.toContain("styles.backdrop");
    expect(pickerModal).not.toContain("styles.pickerSheet");
    expect(pickerModal).not.toContain("styles.grab");
    expect(source).not.toContain("pickerSheet:");
  });

  it("supports expandable action families and a persistent full reset", () => {
    expect(source).toContain("type ActionDetail");
    expect(source).toContain("actionMatchId(actionId)");
    expect(source).toContain("城市轻运动");
    expect(source).toContain('id: "badminton"');
    expect(source).toContain('id: "tennis"');
    expect(source).toContain('id: "yoga"');
    expect(source).not.toContain('id: "hiking"');
    expect(source).not.toContain('id: "water-sports"');
    expect(source).toContain('id: "translation"');
    expect(source).toContain('id: "hospital"');
    expect(source).toContain('id: "medical-companion"');
    expect(source).toContain('id: "urban-support"');
    expect(source).toContain('id: "business-companion"');
    expect(source).toContain('id: "local-guide"');
    expect(source).not.toContain('id: "bank-support"');
    expect(source).not.toContain('id: "immigration-companion"');
    expect(source).toContain("不提供诊断、治疗、护理或急救服务");
    expect(source).toContain("styles.pickerReset");
    expect(source).toContain(">重置<");
  });

  it("loads editorial photos from the server catalog instead of the app bundle", () => {
    expect(source).toContain("/v1/scene-assets");
    expect(source).toContain('networkSource("moments"');
    expect(source).not.toContain("assets/market-scene-samples");
    expect(source).not.toMatch(/require\([^)]*\.jpg/);
  });
});

// SCENE-PICKER-FILTER-ROWS-001 (2026-09-21): the flat 11-tag THEMES rail read
// as one undifferentiated wall of chips.
//
// SCENE-PICKER-FILTER-LABELS-002 (2026-09-21): first attempt only relabeled
// the 3 rows (风格/时段/氛围 → 造型/时间/主题); the 3-stacked-rows structure
// itself was unchanged.
//
// SCENE-PICKER-FILTER-SINGLE-ROW-003 (2026-09-21, user's second follow-up):
// the row *structure* was the actual problem, not the labels — the user
// wanted exactly the reference mock's shape: one row, 3 popup buttons
// (金额/时间/场合), not 3 permanently-expanded chip rows. THEME_GROUPS and
// withGroupTheme are gone; 金额/时间/场合 are new simple option lists with a
// matching field added to each local MOMENTS entry — see the long comment
// above PRICE_OPTIONS in the component for why these are explicitly
// placeholder, commander-approved data rather than a real backend-fed
// filter.
//
// SCENE-PICKER-OCCASION-006 (2026-09-21, user's third follow-up): the first
// 场合 implementation merged 造型+主题's 9 THEMES ids into one list —
// flagged as "wrong option content." Replaced with a purpose/mood taxonomy
// (约会/朋友聚会/独自放空/商务社交/家庭出行) per the user's explicit choice,
// as its own OCCASION_OPTIONS + moment.occasion field, independent of THEMES.
//
// SCENE-PICKER-FILTER-ANCHORED-004 (2026-09-21, user's bug report): each
// popup used to be its own <Modal> stacked on top of the picker page's own
// <Modal> — two native Modals open at once silently ate taps ("点了金额/时间
// 没反应"). Replaced with a plain View anchored directly under the tapped
// button (no <Modal>), plus a transparent scrim Pressable to close on
// outside tap — this also happens to match the user's explicit ask to not
// pop up from the bottom like the reference mock.
describe("single-row price / time / occasion filter (SCENE-PICKER-FILTER-SINGLE-ROW-003, SCENE-PICKER-OCCASION-006, SCENE-PICKER-FILTER-ANCHORED-004)", () => {
  it("renders exactly one filter row with 3 popup buttons, not 3 stacked chip rows", () => {
    expect(source).toContain("styles.filterBarRow");
    // The identifier itself is gone (a historical comment mentioning it by
    // name for context is fine — only the declaration/usage is forbidden).
    expect(source).not.toContain("const THEME_GROUPS");
    expect(source).not.toContain("THEME_GROUPS.map");
    expect(source).not.toContain("withGroupTheme");
    expect(source).not.toContain("styles.refineChip");
    expect(source).not.toContain("styles.refineRail");
    const start = source.indexOf("styles.filterBarRow");
    const end = source.indexOf("</View>", source.indexOf("waimaiRow"));
    const block = source.slice(start, end);
    expect(block.match(/dim: "/g)).toHaveLength(3);
    expect(block).toContain('dim: "price"');
    expect(block).toContain('dim: "time"');
    expect(block).toContain('dim: "occasion"');
  });

  it("SCENE-PICKER-FILTER-ANCHORED-004: opens as an anchored dropdown, not a stacked bottom-sheet Modal", () => {
    // Only one <Modal> should remain for this whole component now: the
    // full-page "动作分类" picker and the Moment detail sheet. The old
    // per-dimension filter <Modal> (backdrop + slide-up sheet) is gone.
    expect(source.match(/<Modal /g)).toHaveLength(2);
    expect(source).toContain("styles.filterDropdown");
    expect(source).toContain("styles.filterDropdownScrim");
    expect(source).not.toContain("visible={openFilter !== undefined}");
  });

  it("SCENE-PICKER-OCCASION-006: 场合 is a standalone purpose/mood taxonomy, not derived from THEMES", () => {
    expect(source).toContain('const OCCASION_OPTIONS: readonly SimpleOption[] = [\n  { id: "date", label: "约会", glyph: "💕" },\n  { id: "friends", label: "朋友聚会", glyph: "🎉" },\n  { id: "solo", label: "独自放空", glyph: "🧘" },\n  { id: "business", label: "商务社交", glyph: "💼" },\n  { id: "family", label: "家庭出行", glyph: "👨‍👩‍👧" },\n];');
    expect(source).not.toContain("OCCASION_ITEMS");
    expect(source).toContain("occasion: string;");
  });

  it("gives each Moment an explicit time / price / occasion field the popup filters can actually match against", () => {
    expect(source).toContain('time: string;');
    expect(source).toContain('price: string;');
    expect(source).toContain('occasion: string;');
    const start = source.indexOf("const MOMENTS: readonly MomentSeed[]");
    const end = source.indexOf("] as const;", start);
    const block = source.slice(start, end);
    const momentCount = block.match(/{ id: "/g)?.length ?? 0;
    const timeCount = block.match(/time: "(morning|afternoon|evening)"/g)?.length ?? 0;
    const priceCount = block.match(/price: "(free|low|mid|high)"/g)?.length ?? 0;
    const occasionCount = block.match(/occasion: "(date|friends|solo|business|family)"/g)?.length ?? 0;
    expect(momentCount).toBe(10);
    expect(timeCount).toBe(10);
    expect(priceCount).toBe(10);
    expect(occasionCount).toBe(10);
  });

  it("filters by AND across action / price / time / occasion, matching the previous combination semantics", () => {
    expect(source).toContain("(!actionId || moment.action === actionMatchId(actionId))");
    expect(source).toContain("(!occasionId || moment.occasion === occasionId)");
    expect(source).toContain("(!timeId || moment.time === timeId)");
    expect(source).toContain("(!priceId || moment.price === priceId)");
  });

  it("每个弹层都有一个不受任何 id 约束的「不限」选项，点了就把该维度清空", () => {
    expect(source.match(/不限/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("setPriceId(undefined); setOpenFilter(undefined)");
    expect(source).toContain("setTimeId(undefined); setOpenFilter(undefined)");
    expect(source).toContain("setOccasionId(undefined); setOpenFilter(undefined)");
  });
});

// SCENE-CARD-STACK-005 (2026-09-21, user reference: deepseek_html_20260921_
// c417e3.html): the two-column 194px-tall momentCard grid became a single
// column of full-width, taller background-photo cards, matching the
// reference's "big card" list. Favorite reuses the existing real `saved`
// state (just moved position); the reference's "🔥 热门" badge was
// deliberately not ported — there is no real popularity/ranking signal to
// back it, and this file already has a standing rule against decorative
// placeholders that look like real signals it isn't (see the price/time
// comments above) — a badge is a stronger, more misleading claim than a
// filter bucket, so it stays out until a real signal exists.
describe("SCENE-CARD-STACK-005: single-column big Moment cards", () => {
  it("replaced the two-column momentCard grid with a single-column sceneCard list", () => {
    expect(source).not.toContain("styles.grid");
    expect(source).not.toContain("styles.momentCard");
    expect(source).toContain("styles.sceneList");
    expect(source).toContain("styles.sceneCard");
    expect(source).toContain('sceneList: { gap: 14, marginTop: 13 }');
  });

  it("does not fabricate a hot/trending badge with no real signal behind it", () => {
    // A historical comment explaining *why* this was deliberately left out
    // is fine (and expected) — only an actual rendered badge is forbidden.
    expect(source).not.toMatch(/hot-badge|hotBadge|<Text[^>]*>🔥/);
  });

  it("keeps the real favorite/save toggle, using this app's filled-heart convention", () => {
    expect(source).toContain('name="heart"');
    expect(source).toContain("filled={saved.includes(moment.id)}");
    expect(source).toContain("saved.includes(moment.id) ? \"取消收藏\" : \"收藏\"");
  });

  it("expands hidden tags (themes + time/price) in place via a single expandedMomentId, not a navigation or extra Modal", () => {
    expect(source).toContain("const [expandedMomentId, setExpandedMomentId] = useState<string>();");
    expect(source).toContain("expandedMomentId === moment.id");
    expect(source).toContain("styles.sceneTagMore");
  });
});

// SCENE-HOME-ENTRY-001 (2026-09-24, prototype deepseek_html_20260924_412dba
// 「Scene · 精修版」首页): the home scene section became the prototype's shape
// — a fixed 6-action row plus one big entry card per category that actually
// has scenes.
//
// The **counting** logic lives in ../scene-category-entries.ts and is covered
// by real behaviour assertions there (scene-category-entries.test.ts). This
// block only pins the wiring: that the component really consumes that module
// instead of re-deriving the numbers inline where no test could reach them.
//
// The prototype's cards also carry「3 场本周活动」「2 个正在招募」 — there is no
// activity/recruitment source for a scene category anywhere in this backend
// (scene detail's three Actions are invite / open-task / signup, i.e.
// executable actions, not categories). Those lines are deliberately NOT ported.
describe("SCENE-HOME-ENTRY-001: home entry cards are wired to the pure, tested derivation", () => {
  it("consumes the pure module instead of re-deriving counts inline in the untestable .tsx", () => {
    expect(source).toContain('from "../scene-category-entries"');
    expect(source).toContain("sceneCategoryEntries(scenes, PRIMARY_ACTIONS)");
    expect(source).toContain("PRIMARY_ACTION_IDS.map");
    // The .tsx must not own a second copy of the derivation — a count computed
    // here would be invisible to scene-category-entries.test.ts.
    expect(source).not.toContain('scene.category === "商家"');
    expect(source).not.toContain("const ACTION_SCENE_KEYWORDS");
    expect(source).not.toContain("export function sceneCategoryEntries");
  });

  it("renders an entry card per real category and an honest empty state otherwise", () => {
    expect(source).toContain("const entries = useMemo(() => sceneCategoryEntries(scenes, PRIMARY_ACTIONS), [scenes]);");
    expect(source).toContain("visibleEntries.length > 0 ?");
    expect(source).toContain("styles.entryCard");
    expect(source).toContain("styles.entryCountPill");
    expect(source).toContain("附近还没有接入真实场景");
    expect(source).toContain("场景目录接上后这里会显示分类入口。");
  });

  it("feeds the entry cards from the real scene list, not the local MOMENTS fixture", () => {
    // The guarantee is structural, not textual: sceneCategoryEntries takes the
    // scene list as its only data input, and its own behaviour test proves an
    // empty list yields zero cards. So pinning the call site is enough — the
    // fixture cannot reach the cards without this line changing.
    expect(source).toContain("sceneCategoryEntries(scenes, PRIMARY_ACTIONS)");
    expect(source).toContain("scenes: readonly SceneDiscoveryBrief[];");
  });

  it("opens the category's own list page — the prototype's card → list → shop flow", () => {
    // SCENE-SHOP-DIRECTORY-001: 卡片以前直接开动作分类页（picker）。原型里
    // 卡片点进去是**这个分类自己的列表**（咖啡 → 附近咖啡 N 家 → 单店详情），
    // 动作分类页仍然从右上「全部」进 —— 那条路一个都没少。
    expect(source).toContain("onPress={() => setDirectoryEntry(entry)}");
    expect(source).toContain("<SceneShopDirectory");
    expect(source).toContain("actionId={directoryEntry.actionId}");
    expect(source).toContain("unit={directoryEntry.unit}");
    expect(source).toContain("onClose={() => setDirectoryEntry(undefined)}");
    expect(source).toContain("setPickerOpen(true)");
    // 旧行为（点卡片顺手把 picker 也打开）不该回来：两个全屏 Modal 叠着开，
    // 系统返回只会收掉上面那个，用户会以为返回坏了。
    expect(source).not.toContain("setActionId(entry.actionId);");
  });

  it("does not port the prototype's activity / recruitment lines that have no data source", () => {
    expect(source).not.toContain("场本周活动");
    expect(source).not.toContain("个正在招募");
    expect(source).not.toContain("位小美走过");
  });
});
