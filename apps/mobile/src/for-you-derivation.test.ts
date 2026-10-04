import { describe, expect, it } from "vitest";

import {
  activityOptions,
  activityStatus,
  personOptions,
  pickForPerson,
  pickForScene,
  pickForTime,
  resolveSelected,
  sceneOptions,
  shufflePick,
  timeOptions,
  type FYActivity,
  type FYContext,
} from "./for-you-derivation";
import { busyKey, type ExistingOrder } from "./requester-home-combo";

// FOR-YOU-SLOT-001（2026-10-04，用户：「for you 是 4 个自由资源槽，核心服务于小美真人……
// 20 个真人 × 3 个时间段 = 最大 60 个可以用，现在只有 9 个，设计逻辑有缺陷」）。
// 资源单位是「小美 × 时段」：她的一个时段只接一单（谁约的都算）；我自己同一时段可以约
// 多个小美；店 / 活动不扣名额；同一组 (活动, 小美) 我下过 ⇒ 看那张票。
const FRI = "周五 19:00–20:30";
const SAT = "周六 15:00–17:00";
const SUN = "周日 10:00–11:30";
const A = (id: string, time: string, sceneId: string): FYActivity => ({ activityId: id, title: id, time, sceneId });
const acts = [A("tb_fri", FRI, "threebeans"), A("tb_sat", SAT, "threebeans"), A("tb_sun", SUN, "threebeans"), A("mg_sat", SAT, "mocgian")];
const people = [{ id: "mai", online: true }, { id: "linh", online: true }, { id: "trang", online: false }];
const none: ExistingOrder[] = [];
const ctx = (over: Partial<FYContext> = {}): FYContext => ({ myOrders: none, busy: new Set(), personId: "mai", ...over });

describe("FOR-YOU-SLOT-001 availability is per person × time slot", () => {
  it("an old order of mine with no companion does not block anything", () => {
    const legacy: ExistingOrder[] = [{ activityId: "tb_fri", title: "抹茶之夜", time: FRI, orderNo: "1" }];
    expect(activityStatus(acts[0]!, ctx({ myOrders: legacy })).ok).toBe(true);
  });

  it("the same (activity, person) I already ordered is ORDERED; another person is still bookable", () => {
    const mine: ExistingOrder[] = [{ activityId: "tb_fri", title: "抹茶之夜", time: FRI, orderNo: "9", companionId: "mai" }];
    expect(activityStatus(acts[0]!, ctx({ myOrders: mine }))).toEqual({ ok: false, reason: "ORDERED", orderNo: "9" });
    expect(activityStatus(acts[0]!, ctx({ myOrders: mine, personId: "linh" })).ok).toBe(true);
  });

  it("a person booked by anyone at that time slot is PERSON_BUSY at every shop in that slot", () => {
    const busy = new Set([busyKey("mai", SAT)]);
    expect(activityStatus(acts[1]!, ctx({ busy }))).toEqual({ ok: false, reason: "PERSON_BUSY" });
    expect(activityStatus(acts[3]!, ctx({ busy }))).toEqual({ ok: false, reason: "PERSON_BUSY" });
    expect(activityStatus(acts[0]!, ctx({ busy })).ok).toBe(true);
  });

  it("I can book two different people at the same time slot", () => {
    const mine: ExistingOrder[] = [{ activityId: "tb_sat", title: "x", time: SAT, companionId: "mai" }];
    expect(activityStatus(acts[3]!, ctx({ myOrders: mine, personId: "linh" })).ok).toBe(true);
  });

  it("cancelled orders never block", () => {
    const cancelled: ExistingOrder[] = [{ activityId: "tb_fri", title: "x", time: FRI, companionId: "mai", cancelled: true }];
    expect(activityStatus(acts[0]!, ctx({ myOrders: cancelled })).ok).toBe(true);
  });

  it("capacity is 20 people × 3 slots, not one per activity", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }));
    const slots = [A("a1", FRI, "s"), A("a2", SAT, "s"), A("a3", SUN, "s")];
    let bookable = 0;
    for (const p of many) for (const a of slots) if (activityStatus(a, ctx({ personId: p.id })).ok) bookable += 1;
    expect(bookable).toBe(60);
  });
});

describe("FOR-YOU-SLOT-001 pickers carry the reason for the current person", () => {
  const busy = new Set([busyKey("mai", SAT)]);
  it("time options", () => {
    const opts = timeOptions(acts, ctx({ busy }), {});
    expect(opts.find((o) => o.value === SAT)?.status).toEqual({ ok: false, reason: "PERSON_BUSY" });
    expect(opts.find((o) => o.value === FRI)?.status.ok).toBe(true);
  });
  it("scene options include shops with no activity, marked NONE", () => {
    const opts = sceneOptions(["threebeans", "mocgian", "empty"], acts, ctx({ busy }), {});
    expect(opts.map((o) => o.status.ok)).toEqual([true, false, false]);
    expect(opts[2]!.status).toEqual({ ok: false, reason: "NONE" });
  });
  it("activity options", () => {
    const opts = activityOptions(acts, ctx({ busy }), { sceneId: "threebeans" });
    expect(opts.find((o) => o.value === "mg_sat")?.status).toEqual({ ok: false, reason: "LOCKED_OUT" });
    expect(opts.find((o) => o.value === "tb_sat")?.status).toEqual({ ok: false, reason: "PERSON_BUSY" });
  });
  it("person options: a person with no free slot under the locks is greyed with the reason", () => {
    const allBusy = new Set([busyKey("trang", FRI), busyKey("trang", SAT), busyKey("trang", SUN)]);
    const opts = personOptions(people, acts, ctx({ busy: allBusy }), {});
    expect(opts.map((o) => o.status.ok)).toEqual([true, true, false]);
    expect(personOptions(people, acts, ctx({ busy }), { time: SAT }).find((o) => o.value === "mai")?.status.ok).toBe(false);
  });
});

describe("FOR-YOU-SLOT-001 switching an axis re-derives the activity", () => {
  it("switching time moves to a bookable activity at that time, keeping the shop when possible", () => {
    expect(pickForTime(SAT, acts[0], acts, ctx(), {})).toBe("tb_sat");
    expect(pickForTime(SAT, acts[0], acts, ctx({ busy: new Set([busyKey("mai", SAT)]) }), {})).toBeUndefined();
  });
  it("switching place keeps the time when possible", () => {
    expect(pickForScene("mocgian", acts[1], acts, ctx(), {})).toBe("mg_sat");
  });
  it("switching person keeps the activity if she is free then, otherwise finds her a free one", () => {
    const busy = new Set([busyKey("linh", FRI)]);
    expect(pickForPerson(acts[1], acts, ctx({ busy, personId: "linh" }), {})).toBe("tb_sat");
    expect(pickForPerson(acts[0], acts, ctx({ busy, personId: "linh" }), {})).toBe("tb_sat");
  });
});

describe("FOR-YOU-SLOT-001 shuffle refreshes all four slots", () => {
  const first = () => 0;
  it("prefers a combo where person, activity, time and place all change", () => {
    const pick = shufflePick(acts, people, { myOrders: none, busy: new Set() }, {}, { personId: "mai", activity: acts[1] }, first);
    expect(pick?.personId).not.toBe("mai");
    const act = acts.find((a) => a.activityId === pick?.activityId)!;
    expect(act.activityId).not.toBe("tb_sat");
    expect(act.time).not.toBe(SAT);
  });
  it("only picks bookable combos and respects a locked person", () => {
    const busy = new Set([busyKey("mai", FRI), busyKey("mai", SUN)]);
    const pick = shufflePick(acts, people, { myOrders: none, busy }, { personId: "mai" }, { personId: "mai", activity: acts[0] }, first);
    expect(pick?.personId).toBe("mai");
    expect(["tb_sat", "mg_sat"]).toContain(pick?.activityId);
  });
  it("prefers online people within the best tier", () => {
    const pick = shufflePick(acts, people, { myOrders: none, busy: new Set() }, { activityId: "tb_fri" }, { personId: "mai", activity: acts[0] }, first);
    expect(pick).toEqual({ personId: "linh", activityId: "tb_fri" });
  });
  it("returns undefined when nothing is bookable", () => {
    const busy = new Set(people.flatMap((p) => [FRI, SAT, SUN].map((t) => busyKey(p.id, t))));
    expect(shufflePick(acts, people, { myOrders: none, busy }, {}, {}, first)).toBeUndefined();
  });
});

describe("FOR-YOU-SLOT-001 default selection", () => {
  it("keeps the user's selection, otherwise defaults to one the current person can book", () => {
    expect(resolveSelected(acts, "tb_fri", ctx({ busy: new Set([busyKey("mai", FRI)]) }), 0)?.activityId).toBe("tb_fri");
    const busy = new Set([busyKey("mai", FRI), busyKey("mai", SAT)]);
    expect(resolveSelected(acts, undefined, ctx({ busy }), 0)?.activityId).toBe("tb_sun");
  });
});
