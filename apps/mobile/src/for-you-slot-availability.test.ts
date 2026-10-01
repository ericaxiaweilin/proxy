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
    // 修法必须**真的有效**，而不是"调了就算修了"。
    //
    // 🔴 时间与订单的冲突是从 **gridActivity** 算出来的（本文件 :1545 读的是
    // `gridActivity.activityId` / `gridActivity.time`），而 gridActivity 只由
    // `activityIndex` 决定 —— **不是** timeIndex。所以「改 timeIndex + 锁时间」
    // 这条修法永远修不好：锁定别的时间只会让 lockedTimeValue 跟活动对不上
    // （反而多一条 comboConflicts），而 orderConflict 一动不动 ⇒ 按钮永远走冲突
    // 分支、永远进不去确认页。用户报的「点击没响应」，真身就是这个。
    expect(source).toContain("if (resolveConflictSlots()) {");
    // 要修就得换**活动**：那才是 activityId / time 的来源。
    expect(source).toContain("sceneActivities.findIndex((a) =>");
    expect(source).toContain("setActivityIndex(altIndex);");
    // 不许退回那条「只改 timeIndex」的无效修法
    expect(source).not.toMatch(/const at = distinctTimes\.indexOf\(alt\);/);
    // 治本：撞时段的时间根本不该出现在候选里
    expect(source).toMatch(/\{availableTimes\.map\(\(slot, i\) =>/);
  });

  it("刷新出来的组合本身必须能下单：时间只从可用值里挑", () => {
    // 用户 2026-10-01 报 P0：「点击选择没响应」。
    //
    // 根因是刷新的时间取的是活动自己写的 `picked.time`，不看我有没有单 ——
    // 于是圆圈刷出一个撞时段的组合 → 点「选择」走进"修冲突"分支 → 修完又
    // return → 用户永远到不了确认页。
    //
    // 治本：刷新时在这个活动的**可用时间**里挑（availableTimes 已滤掉冲突值）。
    expect(source).toMatch(/const freeForThis = freshTimes\.filter\(\(time\) => freeSet\.has\(time\.trim\(\)\)\);/);
    expect(source).toMatch(/const preferred = freeForThis\.includes\(picked\.time\)/);
    // 不许再直接用 picked.time
    expect(source).not.toMatch(/indexOf\(picked\.time\)/);
  });

  it("修不好冲突时必须给出路，不能死循环", () => {
    // 第一版无论修没修好都 return，于是「修不好」的组合（比如这个时间没有替代值）
    // 会让按钮永远只弹消息、进不去确认页 —— 表现为「点击没响应」。
    // 现在必须说明白为什么走不通、以及该动哪个轴。
    expect(source).toMatch(/showResponse\([\s\S]{0,200}slotTimeClash/);
    expect(source).toMatch(/t\("slotTimeClashSub"\)/);
    expect(source).toMatch(/t\("slotPlaceClash"\)/);
  });

  it("「缺人」仍然不能进确认页（人是一单的一部分）", () => {
    // 放行按钮 ≠ 放行缺人的组合：没选人依然要去选人。
    expect(source).toContain("const currentComboBroken = !gridPerson || orderConflict !== undefined || comboConflicts.length > 0;");
  });
});
