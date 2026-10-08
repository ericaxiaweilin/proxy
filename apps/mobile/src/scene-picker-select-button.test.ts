import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 更多页底栏：没选动作档、直接点了 Moment 卡时，「选择场景」也必须在（用户 2026-10-08：只有重置没有选择）。
describe("scene picker select button", () => {
  const src = readFileSync(new URL("./components/scene-activity-discovery.tsx", import.meta.url), "utf8");
  it("is not gated on actionId alone", () => {
    expect(src).not.toMatch(/\{actionId \? \(\(\) => \{\s*const moment = pickedMomentId/);
    expect(src).toContain("const effectiveAction = actionId ?? pickedMoment?.action;");
  });
  it("shows a disabled select button when nothing is picked, not an empty bar", () => {
    expect(src).toContain('accessibilityState={{ disabled: true }}');
  });
});
