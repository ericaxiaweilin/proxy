import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { detectOrderConflict, type ExistingOrder } from "./requester-home-combo";

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

// 上面几条钉的是**形状**（源码里必须有某一行）。形状级钉抓不住这次的病 ——
// 上一版 `c583809` 也"调用了 resolveConflictSlots"，钉照样绿，而用户照样点不动。
// 因为那个函数改的是 timeIndex，而冲突判据 `orderConflict` 读的是
// `gridActivity.activityId` / `gridActivity.time`，只由 **activityIndex** 决定。
//
// 所以下面这几条钉的是**行为**：换过去之后冲突到底消不消失。
// 判据照抄组件里那条谓词（requester-home.tsx 的 resolveConflictSlots）。
describe("HOME-FORYOU-SLOT-AVAIL-001 修冲突必须真的收敛（行为级）", () => {
  const SUN = "周日 10:00–11:30";
  const SAT = "周六 15:00–17:00";
  // 周日这个时段我已经有一单。
  const mine: ExistingOrder[] = [
    { activityId: "cup", title: "周日杯测", time: SUN, orderNo: "100260927150535000001" },
  ];
  const acts = [
    { activityId: "cup", time: SUN }, // 与我的单撞时段
    { activityId: "latte", time: SUN }, // 同样撞时段
    { activityId: "buddy", time: SAT }, // 不撞
  ];
  // 组件里用的就是这条谓词：找第一场与我的订单不冲突的活动。
  const altIndexOf = (list: typeof acts): number =>
    list.findIndex((a) => detectOrderConflict({ activityId: a.activityId, time: a.time }, mine) === undefined);

  it("撞时段的几场里，光换时间是救不回来的 —— 必须换活动", () => {
    // 旧修法本质上只在"时间"这一轴上挑（availableTimes.find(t => t !== 当前)）。
    // 而撞的是**整个时段**：这个时段内的每一场都撞，挑到哪一场都没用。
    const atSun = acts.filter((a) => a.time === SUN);
    expect(atSun.length).toBeGreaterThan(1);
    for (const a of atSun) {
      expect(detectOrderConflict({ activityId: a.activityId, time: a.time }, mine)?.kind).toBe("TIME_TAKEN");
    }
    // 只有换到别的时段（= 换一场活动）才真的清掉。
    const other = acts.find((a) => a.time !== SUN)!;
    expect(detectOrderConflict({ activityId: other.activityId, time: other.time }, mine)).toBeUndefined();
  });

  it("换活动之后冲突真的没了（收敛），且换的是另一场", () => {
    const currentIndex = 0; // cup @ SUN —— 冲突
    expect(detectOrderConflict({ activityId: acts[currentIndex]!.activityId, time: acts[currentIndex]!.time }, mine)?.kind).toBe("TIME_TAKEN");

    const altIndex = altIndexOf(acts);
    expect(altIndex).toBeGreaterThanOrEqual(0);
    expect(altIndex).not.toBe(currentIndex);
    // 收敛：换过去之后，同一条判据算出来必须是「没冲突」。
    expect(detectOrderConflict({ activityId: acts[altIndex]!.activityId, time: acts[altIndex]!.time }, mine)).toBeUndefined();
  });

  it("一场都不冲突时如实返回 -1 —— 不许假装修好了", () => {
    // 假装修好 = 下一次点击还是原地 = 用户看到的「点击没响应」。
    const allClash = [
      { activityId: "cup", time: SUN },
      { activityId: "latte", time: SUN },
    ];
    expect(altIndexOf(allClash)).toBe(-1);
  });
});
