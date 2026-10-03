import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { pickPersonSlot, resolveActivityIndexAvoidingOrders } from "./for-you-slots";

// HOME-FORYOU-ORDER-009（2026-10-01，用户 P0：「点击圆圈 不是选择 是查看这张订单
// 我只有几个用户有订单」）
//
// 取号规则以前内联在 requester-home 里，候选为 0 或 1 的两条分支一个 else 都没有
// —— 点圆圈像死的。现在搬进 pickPersonSlot，下面**直接把它跑出来**验，而不是在
// 源码里 grep 那几个 if：grep 只能证明「字面量还在」，证明不了「只剩一个人时真的会
// 说话」，而后者才是这条修复的全部内容。
const P = (id: string, online: boolean) => ({ id, online });

describe("HOME-FORYOU-ORDER-009 圆圈重掷人：候选为 0/1 时必须说话", () => {
  it("候选为空时如实说明，且不假装换到了谁", () => {
    const pick = pickPersonSlot([], 0);
    // 关键：不能返回一个 index 让调用方去 setPersonIndex —— 名单是空的，
    // 任何下标都是编的。
    expect(pick).toEqual({ kind: "noCandidates" });
    expect("index" in pick).toBe(false);
  });

  it("只剩一个人且他不在线时如实说明「只有他可选」", () => {
    // 这正是「库里只有几个用户有距离数据」时的形态：PERSON-DISTANCE-ZERO-001
    // 那条半径过滤把无坐标真人全排除了，候选常常只剩 1。
    const pick = pickPersonSlot([P("only", false)], 0);
    expect(pick.kind).toBe("onlyCandidate");
    // 他就是当前这一格，不换人（换出去只会是越界）。
    expect(pick.kind === "onlyCandidate" && pick.index).toBe(0);
  });

  it("只剩一个人但他在线上时，照常换到那个有空的（不是「只有他可选」）", () => {
    // 上面那条不能顺手把唯一候选也一律当死路 —— 他在线就仍然是有空的。
    const pick = pickPersonSlot([P("only", true)], 0);
    expect(pick.kind).toBe("free");
  });

  it("一个在线的人都没有、但名单多于一人：换人 + 说明换不出「有空的」", () => {
    const pick = pickPersonSlot([P("a", false), P("b", false)], 0, () => 0.99);
    expect(pick.kind).toBe("noneFreeButOthers");
    expect(pick.kind === "noneFreeButOthers" && pick.index).toBe(1);
  });

  it("优先换到在线的人，且在在线的人里轮转（连点两次不给同一个人）", () => {
    // HOME-FORYOU-FREE-001：轮转而不是 Math.random() —— 与「有没有空」无关的
    // 随机，正是这条链原来最假的地方。
    const people = [P("off", false), P("on1", true), P("on2", true)];
    const first = pickPersonSlot(people, 0);
    const second = pickPersonSlot(people, 1);
    expect(first.kind === "free" && first.index).toBe(1);
    expect(second.kind === "free" && second.index).toBe(2);
    // 再点一次回到第一个 —— 轮转是循环，不是往下走到头。
    const third = pickPersonSlot(people, 2);
    expect(third.kind === "free" && third.index).toBe(1);
  });

  it("名字说清的是哪一种：0 个人和 1 个人不是同一句话", () => {
    // 这两条曾经共用 noOneFree，所以「只剩他」被说成「没有有空的人」——
    // 而真相是「有一个人，他不在线」。分不开就等于没说实话。
    expect(pickPersonSlot([], 0).kind).toBe("noCandidates");
    expect(pickPersonSlot([P("x", false)], 0).kind).toBe("onlyCandidate");
  });
});

describe("HOME-FORYOU-ORDER-009 刷新与 CTA 共用一份「我已下过单」", () => {
  const src = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");
  // 剥掉注释再判「不许出现」：修复说明里会复述被禁的写法（"`if (!isGuest)` 压根
  // 不拉"），那是解释，不是代码。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("joinedByMe 由 myOrders 派生，不再另拉一次 listMyActivities", () => {
    // 那次另拉的 `.catch(() => new Set<string>())` 会静默变成空集 ⇒ 刷新以为
    // 「你没下过单」，挑回你已有票的那场；而 CTA 读的 myOrders 仍为真 ⇒ 按钮
    // 一直显示「查看这张订单」。症状只落在已有订单的人身上（用户：只有几个用户
    // 有订单），而「点圆圈想换人却总是进订单」读起来像随机故障。
    expect(code).toContain("joinedByMe = new Set(myOrders.map((o) => o.activityId));");
    expect(code).not.toMatch(/joinedByMe\s*=\s*await activities\.listMyActivities/);
    // 也不许再按 isGuest 跳过 —— 访客态以前压根不拉，joinedByMe 恒为空集。
    expect(code).not.toMatch(/if\s*\(\s*!isGuest\s*\)[^;]{0,240}joinedByMe/);
  });

  it("四条分支都调了 pickPersonSlot，旧的静默 else 已经不在", () => {
    // 钉住「组件用的是纯函数」而不是自己又写一遍 if —— 上一版只 grep 字面量，
    // 函数加上了没人用也照样绿。
    expect(code).toContain("pickPersonSlot(filteredPeople, freePersonCursor.current)");
    for (const kind of ["free", "noneFreeButOthers", "onlyCandidate", "noCandidates"]) {
      expect(code).toContain(`personPick.kind === "${kind}"`);
    }
    // 候选为空时不得去 setPersonIndex —— 名单空还设下标就是越界。
    expect(code).toContain('if (personPick.kind !== "noCandidates") setPersonIndex(personPick.index);');
  });

  it("刷新读 myOrders 不存在 TDZ：它只有一个调用点，在 remixForYou 里", () => {
    // myOrders 声明在 refreshAvailableSlots **之后**，读它要靠闭包捕获绑定 ——
    // 只有渲染期被调用才会 TDZ。既然唯一调用点在 remixForYou 里，而 remixForYou
    // 只被 onPress 触发，渲染期就跑不到。
    expect([...code.matchAll(/refreshAvailableSlots/g)].length).toBe(2);
    expect(code).toContain("function remixForYou(): void {\n    void refreshAvailableSlots();\n  }");
  });
});
// HOME-FORYOU-ORDER-010（2026-10-01，用户 P0：「for you 的选择变成查看这张订单」）
//
// 这是**首屏**的那一下，圆圈管不到：activityIndex 初始是种子下标、不看订单，
// 首屏可能正停在一张你已经有票的活动上 ⇒ existingOrder 为真 ⇒ CTA 一直显示
// 「查看这张订单」，「选择」那条路整个看不见。ORDER-009 只修了刷新那一下。
const A = (id: string) => ({ activityId: id });
const IDS = (i: ReadonlySet<string>) => [...i];

describe("HOME-FORYOU-ORDER-010 首屏选中项要避开已下单的活动", () => {
  it("停在已下单的那场上时，挪到最近的一场没下过单的", () => {
    const acts = [A("a"), A("b"), A("c")];
    // 种子停在 "b"，而 "b" 已有票 → 必须挪走。
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(["b"]), 1)).toBe(2);
  });

  it("停的不是已下单的：不动", () => {
    const acts = [A("a"), A("b"), A("c")];
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(["b"]), 2)).toBe(2);
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(), 0)).toBe(0);
  });

  it("一张可挪的都没有时保持不动 —— 那时「查看这张订单」是实话", () => {
    // 全都下过单：此时**不能**乱跳（跳到哪儿都是已下单），CTA 显示查看订单
    // 是诚实的结果。悄悄挪到另一张同样有票的活动，只会让人以为换了就没事了。
    const acts = [A("a"), A("b")];
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(["a", "b"]), 0)).toBe(0);
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(["a", "b"]), 1)).toBe(1);
  });

  it("只有一场时不挪（下标 0 就是那一场）", () => {
    expect(resolveActivityIndexAvoidingOrders([A("solo")], new Set(["solo"]), 0)).toBe(0);
    expect(resolveActivityIndexAvoidingOrders([], new Set(), 0)).toBe(0);
  });

  it("绕圈找：停在最后一场时回到开头那场没下过单的", () => {
    const acts = [A("a"), A("b"), A("c")];
    // "c" 有票、"a" 没票，但 "a" 在索引 0 —— 必须能绕回去，不能因为"后面都没票"就放弃。
    expect(resolveActivityIndexAvoidingOrders(acts, new Set(["b", "c"]), 2)).toBe(0);
  });

  it("下标越界 / 负数收敛回有效范围，且落点一定是没下过单的那场", () => {
    // activityIndex 在组件里是 mod 过的下标，但这个纯函数不该假设调用方传得干净。
    // 7 % 3 === 1 → 落在 "b"（有票）→ 下一个是 "c"。-1 归一到 2 → "c" 本来就没票。
    const acts = [A("a"), A("b"), A("c")];
    const joined = new Set(["b"]);
    for (const raw of [7, -1, 100, -100]) {
      const at = resolveActivityIndexAvoidingOrders(acts, joined, raw);
      expect(at, `raw=${raw}`).toBeGreaterThanOrEqual(0);
      expect(at, `raw=${raw}`).toBeLessThan(acts.length);
      // 关键：落点不能是已下单的那场，否则首屏照样卡在「查看这张订单」。
      expect(joined.has(acts[at]!.activityId), `raw=${raw} 落在已下单的活动上`).toBe(false);
    }
  });
});
