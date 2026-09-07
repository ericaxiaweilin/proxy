import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./business-home.tsx", import.meta.url), "utf8");

describe("MERCHANT-R35-OPERATING-FLOW-001", () => {
  it("keeps the commercial approval plan inline on merchant Home", () => {
    expect(source).toContain('testID="merchant-inline-operating-plan"');
    expect(source).toContain("确认只授权当前商业条件");
    expect(source).toContain("activities.publish");
  });

  it("does not turn a stop-traffic decision into an activity", () => {
    expect(source).toContain('operatingHome.bestNextDecision.kind === "STOP_TRAFFIC"');
    expect(source).toContain("该动作不会创建活动或新增预算");
  });

  it("preserves attendance truth after publishing", () => {
    expect(source).toContain("报名不等于到场");
    expect(source).toContain("只有核验后才计入经营结果");
  });
});
