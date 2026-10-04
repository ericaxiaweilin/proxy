import { describe, expect, it } from "vitest";

import { busyKey, detectOrderConflict, type ExistingOrder } from "./requester-home-combo";

// FOR-YOU-SLOT-001（2026-10-04，推翻 HOME-FORYOU-ORDER-ONE-001）：资源单位是「小美 × 时段」。
//   - 一单 = (活动, 我, 小美)。换一个小美是新的一单（服务端各自一行、各自编号、各自票面，
//     不像 ORDER-007 那样改写旧票）。
//   - 小美的一个时段只接一单，谁约的都算 ⇒ COMPANION_BUSY。
//   - 我自己同一时段约多个小美不算冲突（用户裁决：只锁小美的时间）。
describe("detectOrderConflict: person × time slot", () => {
  const SAT = "周六 15:00–17:00";
  const mine: ExistingOrder[] = [
    { activityId: "act_1", title: "杯测", time: SAT, orderNo: "100260927150535000001", companionId: "alice" },
  ];

  it("same activity with the same companion is already ordered", () => {
    expect(detectOrderConflict({ activityId: "act_1", time: SAT, companionId: "alice" }, mine)).toEqual({ kind: "ALREADY_ORDERED", orderNo: "100260927150535000001" });
  });

  it("same activity with another companion is a new order", () => {
    expect(detectOrderConflict({ activityId: "act_1", time: SAT, companionId: "bob" }, mine)).toBeUndefined();
  });

  it("my companion at the same slot in another activity is busy", () => {
    expect(detectOrderConflict({ activityId: "act_2", time: ` ${SAT} `, companionId: "alice" }, mine)).toEqual({ kind: "COMPANION_BUSY", time: ` ${SAT} ` });
  });

  it("a companion booked by someone else at that slot is busy", () => {
    const busy = new Set([busyKey("carol", SAT)]);
    expect(detectOrderConflict({ activityId: "act_9", time: SAT, companionId: "carol" }, [], busy)?.kind).toBe("COMPANION_BUSY");
    expect(detectOrderConflict({ activityId: "act_9", time: "周日 10:00", companionId: "carol" }, [], busy)).toBeUndefined();
  });

  it("I am not blocked by my own other orders at the same time", () => {
    expect(detectOrderConflict({ activityId: "act_2", time: SAT, companionId: "bob" }, mine)).toBeUndefined();
  });

  it("cancelled orders never block", () => {
    const cancelled: ExistingOrder[] = [{ ...mine[0]!, cancelled: true }];
    expect(detectOrderConflict({ activityId: "act_1", time: SAT, companionId: "alice" }, cancelled)).toBeUndefined();
    expect(detectOrderConflict({ activityId: "act_2", time: SAT, companionId: "alice" }, cancelled)).toBeUndefined();
  });
});
