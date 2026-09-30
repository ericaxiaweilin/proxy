import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rawSource = readFileSync(new URL("./business-home.tsx", import.meta.url), "utf8");
const source = rawSource;
// UI-GEO-HONEST-002 / UI-COPY-HONEST-001 这类改动会在注释里**引用**被删掉的文案作为
// 反例（「以前写的是『待商家确认具体时段』」）。断言必须剥注释再比对，否则反向钉会被
// 自己的说明喂红 —— 这与 scene-shop-directory.test.ts 的 stripComments 同一理由。
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(rawSource);

describe("MERCHANT-R35-OPERATING-FLOW-001", () => {
  it("keeps the commercial approval plan inline on merchant Home", () => {
    expect(source).toContain('testID="merchant-inline-operating-plan"');
    expect(source).toContain("确认只授权当前商业条件");
    // UI-GEO-HONEST-002：这里原来钉 `activities.publish`，但那段 publish 的入参全是
    // 编的（时间/容量/场地），等于替商家编一份活动发出去。一键代发已移除，改为提示
    // 商家自己去「发布活动」填。真实发布链路在 activity-wizard（另测）。
    expect(source).toContain("别让平台替你猜");
  });

  it("does not turn a stop-traffic decision into an activity", () => {
    expect(source).toContain('operatingHome.bestNextDecision.kind === "STOP_TRAFFIC"');
    expect(source).toContain("该动作不会创建活动或新增预算");
  });

  it("preserves attendance truth after publishing", () => {
    expect(source).toContain("报名不等于到场");
    expect(source).toContain("只有核验后才计入经营结果");
    expect(source).toContain("只显示本商家动作");
    expect(source).toContain('entry.origin === "MERCHANT"');
  });

  // UI-GEO-HONEST-002：这个测试原来钉「prepareOperatingAction 会调 activities.publish」
  // 且活动创建后提示「报名不等于到场，只有核验后才计入经营结果」。但那段 publish 的
  // 入参**全是编的**：time 写死「待商家确认具体时段」（一句提示语被当活动时间落库）、
  // capacity: 12、venueIcon: "☕️"、venueType: "CAFE" —— 与真实门店无关，那个 12 在整个
  // app 里没有任何来源。编容量与本仓库反复修掉的 GEO-HONEST-001 同类，只是这次编的
  // 数字会落库、会被别人看到。
  //
  // 所以「一键替商家发活动」这个能力被移除（活动时间、人数、场地都得商家自己定）。
  // 下面钉的是**移除后的诚实口径**，不是钉住那段假实现。
  it("no longer invents an activity's time / capacity / venue to publish on the merchant's behalf", () => {
    expect(source).not.toContain("activities.publish");
    // 三个编造值一个都不许回来。
    expect(code).not.toContain("待商家确认具体时段");
    expect(code).not.toContain('capacity: 12');
    expect(code).not.toContain('venueIcon: "☕️"');
    // 改为诚实提示：让商家自己去填。
    expect(source).toContain("别让平台替你猜");
  });
});
