import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./scene-activity-discovery.tsx", import.meta.url)), "utf8");
const rail = readFileSync(fileURLToPath(new URL("./horizontal-swipe-rail.tsx", import.meta.url)), "utf8");

describe("scene activity discovery contract", () => {
  it("keeps Action, Scene and Theme as independent semantic atoms", () => {
    expect(source).toContain('id: "cycling"');
    expect(source).toContain('id: "old-town"');
    expect(source).toContain('id: "ao-dai"');
    expect(source).toContain("moment.action === actionMatchId(actionId)");
    expect(source).toContain("moment.scene === sceneId");
    expect(source).toContain("themeIds.every");
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

  it("does not introduce order price or human inventory into Moment cards", () => {
    expect(source).not.toMatch(/price|moneyFlow|humanIds|年龄/);
  });

  it("keeps taxonomy cards tappable while still taking over real horizontal swipes", () => {
    expect(source.match(/preserveChildPresses threshold=\{3\}/g)).toHaveLength(1);
    expect(rail).toContain("onStartShouldSetPanResponder: () => !preserveChildPresses");
    expect(rail).toContain("!preserveChildPresses || Math.abs(gs.dx) > threshold");
  });

  it("keeps one compact Action row and opens all three taxonomies from one 全部 button", () => {
    expect(source).toContain("setPickerOpen(true)");
    expect(source).toContain(">全部筛选<");
    expect(source).toContain('{ key: "actions", label: "动作", items: ACTIONS }');
    expect(source).toContain('{ key: "scenes", label: "场景", items: SCENES }');
    expect(source).toContain('{ key: "themes", label: "主题", items: THEMES }');
    expect(source).not.toContain('<SectionHead label="场景"');
    expect(source).not.toContain('<SectionHead label="主题"');
    expect(source).toContain("styles.actionGlyph");
    expect(source).not.toContain("styles.actionCard");
    expect(source).toContain("可组合选择");
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
