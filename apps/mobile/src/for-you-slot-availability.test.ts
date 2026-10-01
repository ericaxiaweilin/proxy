import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// HOME-FORYOU-SLOT-AVAIL-001（用户：「点什么都灰。理论上我们 for you 是4个资源槽
// 检测冲突 4个全部不可用才灰，有一个可用都不能灰」）。
//
// 原来的判据是 `comboConflicts.length > 0 || !gridPerson || orderConflict !== undefined`
// —— 任何**一个**槽位出问题就整体置灰，于是点哪个新人都灰、点哪个时间也灰，
// 用户什么都做不了：明明换一个槽位就能凑出可用组合，却被告知不行。
//
// 这里钉的是判据的**形状**：四个槽位各算可用性，全不可用才置灰。
describe("For You 四槽可用性（HOME-FORYOU-SLOT-AVAIL-001）", () => {
  const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

  it("四个槽位各算一次可用性", () => {
    expect(source).toContain("const personAvailable = filteredPeople.length > 0;");
    expect(source).toContain("const timeAvailable =");
    expect(source).toContain("const sceneAvailable =");
    expect(source).toContain("const placeAvailable =");
  });

  it("置灰条件是「全都不可用」，不是「任一不可用」", () => {
    // 关键：comboBlocked 必须由 anySlotAvailable 取反得到。
    expect(source).toContain("const anySlotAvailable = personAvailable || timeAvailable || sceneAvailable || placeAvailable;");
    expect(source).toContain("const comboBlocked = !anySlotAvailable;");
    // 旧写法（任一冲突即置灰）必须已经不在了 —— 它是用户报的问题本身。
    expect(source).not.toMatch(/const comboBlocked\s*=\s*comboConflicts\.length > 0\s*\|\|/);
    expect(source).not.toMatch(/const comboBlocked\s*=\s*.*\|\|\s*!gridPerson\s*\|\|/);
  });

  it("点「选择」直接进确认页；冲突就地修好，不弹窗打断", () => {
    // 用户 2026-10-01 报 P0：「点击圆圈就自动刷新 4 个可用的资源槽-选择就可以」，
    // 而我上一版把按钮改成"有冲突就弹对应选择器"，流程变成
    //   点选择 → 弹时间 → 选完**还得再点一次选择**。
    // 圆圈本来就已刷新出可用组合，凭什么还要用户再选一次。
    //
    // 现在：冲突**就地修好**（换掉冲突的那个槽），下一帧就能直接下单；
    // 唯一还需要人介入的是"这一槽真的没有值"（缺人）—— 那才开人选择器。
    expect(source).toMatch(/if \(!gridPerson\) \{ setChooser\("person"\); return; \}/);
    // 冲突不再弹选择器
    expect(source).not.toMatch(/if \(timeClash\) \{ setChooser\("time"\); return; \}/);
    expect(source).not.toMatch(/if \(placeClash\) \{ setChooser\("place"\); return; \}/);
    expect(source).toContain("resolveConflictSlots();");
    // 治本：撞时段的时间根本不该出现在候选里
    expect(source).toMatch(/\{availableTimes\.map\(\(slot, i\) =>/);
  });

  it("「缺人」仍然不能进确认页（人是一单的一部分）", () => {
    // 放行按钮 ≠ 放行缺人的组合：没选人依然要去选人。
    expect(source).toContain("const currentComboBroken = !gridPerson || orderConflict !== undefined || comboConflicts.length > 0;");
  });
});
