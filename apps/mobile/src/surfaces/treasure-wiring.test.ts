import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TREASURE-001 接线：寻宝整屏从场景地图进，盖在地图之上；没用 react-native-maps；声音 / 震动失败不挡开箱。
describe("treasure wiring", () => {
  const shell = readFileSync(new URL("../shell/app-shell.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("./reality-scene-map.tsx", import.meta.url), "utf8");
  const hunt = readFileSync(new URL("./treasure-hunt.tsx", import.meta.url), "utf8");
  const sfx = readFileSync(new URL("../treasure-sfx.ts", import.meta.url), "utf8");
  it("opens from the scene map and covers it (and hides the tabs underneath)", () => {
    expect(map).toContain("onOpenTreasure");
    expect(shell).toContain("onOpenTreasure={() => setTreasureOpen(true)}");
    expect(shell).toContain("<TreasureHuntSurface client={treasureClient} onBack={() => setTreasureOpen(false)} />");
    expect(shell).toContain("const overlayOpen = Boolean(treasureOpen ||");
  });
  it("the hunt screen needs no map library and never decides eligibility itself", () => {
    expect(hunt).not.toContain("react-native-maps");
    expect(hunt).toContain("client.openSolo(target.id, fix)");
    expect(hunt).toContain("client.openCompanion(target.activityId, target.companionId, fix)");
    // 练习箱不发任何请求。
    expect(hunt).toMatch(/target\.practice\) \{\s*finishOpen\(/);
  });
  it("hold-to-open is 0.9s of charge with sound + buzz, and sound failures are swallowed", () => {
    expect(hunt).toContain('playSfx("charge")');
    expect(hunt).toContain("onPressIn={begin} onPressOut={cancel}");
    expect(sfx.match(/catch \{/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
