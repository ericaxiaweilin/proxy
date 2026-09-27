import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-LOCATION-PICKER-001（用户：「所有的场景卡片 点击弹出的 list 都要共用
// 城市list 搜索框 这是必须的 你看运动卡片list就做好了 其它的没做」）。
//
// 首页 7 张场景卡：coffee/dining/city-walk/photo/cycling/exhibition 六张都走
// 共用组件 SceneShopDirectory；sport（运动·羽毛球）走独立的
// BadmintonCompanion，那份已经有一套"点开一整页、能搜"的城市选择器。这里钉
// 住 SceneShopDirectory 现在用的是同一套共用组件 LocationListPicker，不再是
// 一行横滑的区域筛选 chip（没有搜索、点了不弹整页）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const picker = stripComments(readFileSync(here("./location-list-picker.tsx"), "utf8"));
const directory = stripComments(readFileSync(here("./scene-shop-directory.tsx"), "utf8"));

describe("SCENE-LOCATION-PICKER-001 shared picker component", () => {
  it("has a search box that filters across all sections", () => {
    expect(picker).toContain("export function LocationListPicker");
    expect(picker).toContain("onChangeText={setKeyword}");
    expect(picker).toContain("allItems.filter((item) => item.toLowerCase().includes(q))");
  });

  it("does not wrap itself in a Modal (callers already are one — nested Modal is silently dropped on iOS)", () => {
    expect(picker).not.toContain("<Modal");
  });

  it("supports multi-select with a clear-all and a confirm step, same as badminton's city picker", () => {
    expect(picker).toContain("onPress={() => onToggle(item)}");
    expect(picker).toContain("onPress={onClear}");
    expect(picker).toContain("onPress={onConfirm}");
  });
});

describe("SCENE-LOCATION-PICKER-001 SceneShopDirectory (all 6 real scene-category cards) uses the shared picker", () => {
  it("imports and renders the shared LocationListPicker instead of a bespoke filter UI", () => {
    expect(directory).toContain('import { LocationListPicker } from "./location-list-picker";');
    expect(directory).toContain("<LocationListPicker");
  });

  it("no longer has its own horizontal area-chip scroll bar (that was the thing missing the shared search box)", () => {
    expect(directory).not.toContain("styles.filterChip");
    expect(directory).not.toContain("filterChip:");
  });

  it("opens the picker via a tappable row, not inline, same interaction shape as badminton's 选择城市 row", () => {
    expect(directory).toContain('accessibilityLabel="选择区域"');
    expect(directory).toContain("onPress={() => setPickerOpen(true)}");
    expect(directory).toContain("styles.locationRow");
  });

  it("does not show a dead entry when there is nothing to filter (only one real area)", () => {
    expect(directory).toContain("facets.length > 1 ?");
  });

  it("wires the picker's selection back into the same real toggleArea/areas state the row list already filters on", () => {
    expect(directory).toContain("onToggle={toggleArea}");
    expect(directory).toContain("selected={areas}");
    // 反向臂：不能新造一套跟 shopDirectoryRows 的 areas 参数脱节的选中态。
    expect(directory).toContain("shopDirectoryRows(scenes, actionId, { sortId, areas,");
  });

  it("single Modal, no nesting: the picker swaps in via state inside the same top-level Modal", () => {
    expect((directory.match(/<Modal /g) ?? []).length).toBe(1);
    expect(directory).toContain("const [pickerOpen, setPickerOpen] = useState(false);");
    expect(directory).toContain("{pickerOpen ? (");
  });
});
