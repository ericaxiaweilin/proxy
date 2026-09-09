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
    expect(source).toContain("moment.action === actionId");
    expect(source).toContain("moment.scene === sceneId");
    expect(source).toContain("themeIds.every");
  });

  it("ships the complete R42 visual taxonomy", () => {
    expect(source.match(/assets\/scene-activity\/actions\//g)).toHaveLength(12);
    expect(source.match(/assets\/scene-activity\/scenes\//g)).toHaveLength(10);
    expect(source.match(/assets\/scene-activity\/themes\//g)).toHaveLength(10);
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
    expect(source.match(/preserveChildPresses threshold=\{3\}/g)).toHaveLength(3);
    expect(rail).toContain("onStartShouldSetPanResponder: () => !preserveChildPresses");
    expect(rail).toContain("!preserveChildPresses || Math.abs(gs.dx) > threshold");
  });

  it("opens complete Action, Scene and Theme pickers from each 全部 button", () => {
    expect(source).toContain('setPickerKind("ACTION")');
    expect(source).toContain('setPickerKind("SCENE")');
    expect(source).toContain('setPickerKind("THEME")');
    expect(source).toContain("全部{pickerKind");
    expect(source).toContain("清除筛选");
  });
});
