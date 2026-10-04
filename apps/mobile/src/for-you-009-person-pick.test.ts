import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// HOME-FORYOU-ORDER-009（2026-10-01）→ FOR-YOU-SLOT-001（2026-10-04）。
//
// ORDER-009 把圆圈「换人」抽成了 pickPersonSlot，在线的人里轮转、只换人。用户随后报：
// 「点击 for you 的圆圈，能自动刷新的只有人物，其它时间 场所 地点没有刷新」。
// 现在圆圈在「人 × 活动」的可约组合里整组挑（shufflePick，行为测试在
// for-you-derivation.test.ts），pickPersonSlot 已删。这里只钉组件侧仍然成立的几件事。
describe("HOME-FORYOU-ORDER-009 / FOR-YOU-SLOT-001 圆圈刷新", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");
  // 剥掉注释再判「不许出现」：注释会复述被删的写法。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("刷新用的「我下过的单」和 CTA 是同一份 myOrders，「谁被约了」是刚拉的 busy", () => {
    expect(code).toContain("shufflePick(freshFY, filteredPeople, { myOrders, busy: freshBusy }, lockValues,");
    expect(code).not.toMatch(/joinedByMe\s*=\s*await activities\.listMyActivities/);
  });

  it("一组可约的都没有时如实说，不假装换了", () => {
    expect(code).toContain('showResponse(filteredPeople.length === 0 ? t("noOneFree") : t("noFreeCombo"), t("slotNoneAvailableSub"));');
  });

  it("换人与换活动同一次落地：人和活动都来自 shufflePick 的同一组", () => {
    expect(code).toContain("if (picked.personId !== undefined) {");
    expect(code).toContain("setSelectedActivityId(picked.activityId);");
    expect(code).not.toContain("pickPersonSlot");
  });

  it("刷新读 myOrders 不存在 TDZ：它只有一个调用点，在 remixForYou 里", () => {
    expect([...code.matchAll(/refreshAvailableSlots/g)].length).toBe(2);
    expect(code).toContain("function remixForYou(): void {\n    void refreshAvailableSlots();\n  }");
  });
});
