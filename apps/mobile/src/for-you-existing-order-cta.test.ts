import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectOrderConflict, type ExistingOrder } from "./requester-home-combo";

// HOME-FORYOU-ORDER-008（2026-10-01，用户「点击 for you 的选择 不能下一步」）
//
// 现场（模拟器 idb + 真库实测，不是推演）：
//   · 四宫格当前活动 = tb_sun_cupping 周日杯测小聚（Three Beans · Cầu Giấy）；
//   · 这个账号在**同一场活动**上已经有一单（票面快照的 companion 为空 =
//     迁移前下的单）；时间也是 周日 10:00–11:30；
//   · 于是 detectOrderConflict 先按「同活动 + 同行人对得上」判重复 → 对不上，
//     落到「同时间」判定 → **TIME_TAKEN**（说成"你在别的时间有单"）；
//   · 「选择」的冲突分支会调 resolveConflictSlots() 就地换一场不冲突的活动。
//     而 `sceneActivities` 只有三家咖啡店场景下的 3 场活动，**这 3 场这个账号
//     全下过** ⇒ 换不出来（altIndex = -1）⇒ 只弹一句冲突文案，
//     屏幕上没有任何能走的入口。这就是"不能下一步"。
//
// 已裁决（2026-10-01，写在 requester-home-combo.ts:321 起）：同一场活动**不**放行
// 再次下单 —— 服务端 (activity, actor) 只有一行，同场再下单会沿用原编号并刷新
// 票面，等于无声改写原同行人正等着的那张票。
//
// 所以这条钉钉的不是"放行"，而是**出路**：守卫照旧拦住下单，但屏幕必须给出
// 真正能走的一步 —— **看那张已有的票**。
const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

describe("HOME-FORYOU-ORDER-008 有票时「选择」必须给出下一步", () => {
  it("形状：existingOrder 按「同一场活动有未取消的单」认，不再依赖同行人对不对得上", () => {
    expect(source).toContain("const existingOrder = myOrders.find((o) => o.activityId === gridActivity.activityId && !o.cancelled);");
    // 反向臂：旧的窄口径（只在 ALREADY_ORDERED 时才认这单）不许回来 ——
    // 同行人对不上时它会让 existingOrder 变 undefined，屏幕上就没有入口了。
    expect(source).not.toMatch(/const existingOrder = orderConflict\?\.kind === "ALREADY_ORDERED"/);
  });

  it("形状：CTA 在有票时是「查看这张订单」，且这条路在「缺人」之前", () => {
    expect(source).toContain("if (existingOrder) { openExistingOrder(existingOrder); return; }");
    // 顺序很关键：缺人时也要能走到那张票（缺人只会弹人选择器，选完还是下不了单）。
    expect(source.indexOf("if (existingOrder) { openExistingOrder(existingOrder); return; }"))
      .toBeLessThan(source.indexOf('if (!gridPerson) { setChooser("person"); return; }'));
    // 按钮上的字必须是它真的会做的事。
    expect(source).toContain('{existingOrder ? t("viewExistingOrder") : t("selectComboCta")}');
    // 有票时不许因为「四个槽都不可用」而点不动 —— 那张票与槽位可用性无关。
    expect(source).toContain("disabled={comboBlocked && !existingOrder}");
    // 同一入口写两遍迟早只改一处：次级按钮已并进 CTA，只剩这一个调用点
    // （定义 `const openExistingOrder = (…` 不含 "openExistingOrder(" 这个子串）。
    expect(source.split("openExistingOrder(existingOrder)").length - 1).toBe(1);
  });

  it("行为：同活动 + 同行人对不上 ⇒ 仍然是 TIME_TAKEN（出路 ≠ 放行）", () => {
    // 钉住「没有放宽守卫」。这条绿 + 上一条绿 = 拦住下单的同时给了出路。
    const mine: ExistingOrder[] = [
      { activityId: "tb_sun_cupping", title: "周日杯测小聚", time: "周日 10:00–11:30", orderNo: "100260927150535000001" },
    ];
    const conflict = detectOrderConflict(
      { activityId: "tb_sun_cupping", time: "周日 10:00–11:30", companionId: "dev_20" },
      mine,
    );
    expect(conflict?.kind).toBe("TIME_TAKEN");
  });

  it("行为：这个账号的池子里换不出不冲突的活动 —— 死路是真的（所以必须有别的出路）", () => {
    // 真库里的三场咖啡店活动 + 该账号的真实订单（三场全下过，票面同行人均为空）。
    const pool = [
      { activityId: "tb_matcha_night", time: "周五 19:00–20:30" },
      { activityId: "tb_sun_cupping", time: "周日 10:00–11:30" },
      { activityId: "tb_sat_buddy", time: "周六 15:00–17:00" },
    ];
    const mine: ExistingOrder[] = [
      { activityId: "tb_matcha_night", title: "抹茶之夜", time: "周五 19:00–20:30" },
      { activityId: "tb_sun_cupping", title: "周日杯测小聚", time: "周日 10:00–11:30" },
      { activityId: "tb_sat_buddy", title: "周六咖啡拍照搭子", time: "周六 15:00–17:00" },
    ];
    // 组件里 resolveConflictSlots 用的就是这条谓词：找第一场不冲突的活动。
    const altIndex = pool.findIndex((a) => detectOrderConflict({ activityId: a.activityId, time: a.time }, mine) === undefined);
    expect(altIndex).toBe(-1);
    // 而「同一场活动我有一单」这条判据成立 ⇒ CTA 必须指向那张票。
    expect(mine.some((o) => o.activityId === "tb_sun_cupping" && !o.cancelled)).toBe(true);
  });
});
