import { describe, expect, it } from "vitest";
import type { ExistingOrder } from "./requester-home-combo";
import {
  activityOptions,
  activityStatus,
  lockValueFor,
  matchesLocks,
  pickForScene,
  pickForTime,
  resolveSelected,
  sceneOptions,
  shufflePick,
  timeOptions,
  type FYActivity,
} from "./for-you-derivation";

const act = (activityId: string, time: string, sceneId: string, over: Partial<FYActivity> = {}): FYActivity => ({
  activityId, title: activityId, time, sceneId, joined: 0, capacity: 8, ...over,
});

const SUN = "周日 10:00–11:30";
const SAT = "周六 15:00–17:00";
const FRI = "周五 19:00";
const acts = [
  act("cup", SUN, "tb_cg"),
  act("latte", SUN, "tb_bn"),
  act("buddy", SAT, "tb_cg"),
  act("matcha", FRI, "tb_cg", { joined: 8, capacity: 8 }),
];
const noOrders: ExistingOrder[] = [];
const ordered: ExistingOrder[] = [{ activityId: "cup", title: "cup", time: SUN, orderNo: "100260927150535000001" }];

describe("FOR-YOU-DERIVE-001 availability", () => {
  it("marks ordered, time-taken and full activities as unavailable", () => {
    expect(activityStatus(acts[0]!, ordered)).toEqual({ ok: false, reason: "ORDERED", orderNo: "100260927150535000001" });
    expect(activityStatus(acts[1]!, ordered)).toEqual({ ok: false, reason: "TIME_TAKEN", orderNo: "100260927150535000001", clashTitle: "cup" });
    expect(activityStatus(acts[3]!, noOrders)).toEqual({ ok: false, reason: "FULL" });
    expect(activityStatus(acts[2]!, ordered)).toEqual({ ok: true });
  });
  it("ignores cancelled orders", () => {
    expect(activityStatus(acts[0]!, [{ ...ordered[0]!, cancelled: true }])).toEqual({ ok: true });
  });
});

describe("FOR-YOU-DERIVE-001 switching an axis re-derives the activity", () => {
  it("switching time moves to an available activity at that time, keeping the shop when possible", () => {
    expect(pickForTime(SAT, acts[0], acts, noOrders, {})).toBe("buddy");
    expect(pickForTime(SUN, acts[2], acts, noOrders, {})).toBe("cup"); // same shop tb_cg
    expect(pickForTime(SUN, act("x", SAT, "tb_bn"), acts, noOrders, {})).toBe("latte"); // same shop tb_bn
  });
  it("a time slot I already hold, or a full one, cannot be picked", () => {
    expect(pickForTime(SUN, acts[2], acts, ordered, {})).toBeUndefined();
    expect(pickForTime(FRI, acts[0], acts, noOrders, {})).toBeUndefined();
  });
  it("switching place keeps the time when possible", () => {
    expect(pickForScene("tb_bn", acts[0], acts, noOrders, {})).toBe("latte");
    expect(pickForScene("tb_cg", acts[1], acts, noOrders, {})).toBe("cup");
    expect(pickForScene("tb_cg", acts[1], acts, ordered, {})).toBe("buddy");
  });
});

describe("FOR-YOU-DERIVE-001 locks are constraints", () => {
  it("a locked time limits place choices to that time", () => {
    const locks = lockValueFor("time", acts[0]!);
    expect(pickForScene("tb_bn", acts[0], acts, noOrders, locks)).toBe("latte");
    expect(matchesLocks(acts[2]!, locks)).toBe(false);
    expect(pickForScene("tb_cg", acts[1], acts, noOrders, { time: SAT })).toBe("buddy");
  });
  it("a locked shop limits time choices to that shop", () => {
    const locks = lockValueFor("scene", acts[1]!); // tb_bn only hosts SUN
    const options = timeOptions(acts, noOrders, locks);
    expect(options.find((o) => o.value === SUN)?.status).toEqual({ ok: true });
    expect(options.find((o) => o.value === SAT)?.status).toEqual({ ok: false, reason: "LOCKED_OUT" });
  });
});

describe("FOR-YOU-DERIVE-001 picker options carry a reason", () => {
  it("time options", () => {
    const options = timeOptions(acts, ordered, {});
    expect(options.map((o) => o.value)).toEqual([SUN, SAT, FRI]);
    expect(options[0]!.status).toMatchObject({ ok: false, reason: "ORDERED" });
    expect(options[1]!.status).toEqual({ ok: true });
    expect(options[2]!.status).toEqual({ ok: false, reason: "FULL" });
  });
  it("scene options include shops with no activity, marked NONE", () => {
    const options = sceneOptions(["tb_cg", "tb_bn", "empty_shop"], acts, ordered, {});
    expect(options[0]!.status).toEqual({ ok: true }); // buddy is still available there
    expect(options[1]!.status).toMatchObject({ ok: false, reason: "TIME_TAKEN" });
    expect(options[2]!.status).toEqual({ ok: false, reason: "NONE" });
  });
  it("activity options", () => {
    const options = activityOptions(acts, ordered, { time: SAT });
    expect(options.map((o) => o.status)).toEqual([
      { ok: false, reason: "LOCKED_OUT" },
      { ok: false, reason: "LOCKED_OUT" },
      { ok: true },
      { ok: false, reason: "LOCKED_OUT" },
    ]);
  });
});

describe("FOR-YOU-DERIVE-001 shuffle and default only land on available combos", () => {
  it("shuffle skips unavailable and respects locks", () => {
    for (let i = 0; i < 20; i += 1) {
      const id = shufflePick(acts, ordered, {}, undefined, () => i / 20);
      expect(["buddy"]).toContain(id); // cup ordered, latte time-taken, matcha full
    }
    expect(shufflePick(acts, ordered, { time: SUN }, undefined)).toBeUndefined();
  });
  it("shuffle prefers a different activity than the current one", () => {
    expect(shufflePick(acts, noOrders, { sceneId: "tb_cg" }, "cup", () => 0)).toBe("buddy");
  });
  it("keeps the user's selection even after it was just ordered, otherwise defaults to an available one", () => {
    expect(resolveSelected(acts, "cup", ordered, 0)?.activityId).toBe("cup");
    expect(resolveSelected(acts, undefined, ordered, 5)?.activityId).toBe("buddy");
    expect(resolveSelected(acts, "gone", noOrders, 1)?.activityId).toBe("latte");
    expect(resolveSelected([], undefined, noOrders, 0)).toBeUndefined();
  });
});
