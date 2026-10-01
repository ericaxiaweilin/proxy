import { describe, expect, it } from "vitest";

import { detectOrderConflict, type ExistingOrder } from "./requester-home-combo";

// HOME-FORYOU-ORDER-007：换一个同行人 = 换一单。
//
// 用户报的是 P0：新用户在 For You 里是**灰色**的、点确认下单被告知
// 「这一单你已经下过了（订单号 …）」，而那个新用户根本没下过单。
// 根因是判重只看 activityId —— 同行人是 For You 组合（人+时间+场景+地点）
// 的一部分，换人就是换单。
//
// 服务端（postgres activity 仓储的 companionChanged）已经改成看同行人；
// 客户端不改的话服务端放行、界面照样不给下单。
describe("detectOrderConflict is companion-aware", () => {
  const base: ExistingOrder[] = [
    { activityId: "act_1", title: "杯测", time: "周六 15:00", orderNo: "1002609…", companionId: "alice" },
  ];

  it("same activity + same companion is a duplicate", () => {
    const conflict = detectOrderConflict({ activityId: "act_1", time: "周六 15:00", companionId: "alice" }, base);
    expect(conflict?.kind).toBe("ALREADY_ORDERED");
  });

  it("same activity + a DIFFERENT companion is a new order — this is the greyed-out bug", () => {
    const conflict = detectOrderConflict({ activityId: "act_1", time: "周六 15:00", companionId: "bob" }, base);
    // No duplicate. A time clash is a different question and may still fire, but
    // it must not be ALREADY_ORDERED.
    expect(conflict?.kind).not.toBe("ALREADY_ORDERED");
  });

  it("a legacy order with NO companion recorded must NOT lock the user out", () => {
    // 旧数据的票面快照是 NULL，拿不到同行人。第一版写的是"⇒ 判重"，
    // 结果是把这个用户**永久锁死**：库里所有旧单都没有快照，于是他在任何一个
    // 自己下过单的活动上，选任何新同行人都被判「已经下过了」—— 而那个人
    // 根本没下过单。
    //
    // 代价不对称：真实重复下单 = 一张票；误判重复 = 永远无法和新人下单。
    // 所以往放行那边偏。
    const legacy: ExistingOrder[] = [{ activityId: "act_1", title: "杯测", time: "周六 15:00", orderNo: "1002609…" }];
    const conflict = detectOrderConflict({ activityId: "act_1", time: "周六 15:00", companionId: "bob" }, legacy);
    expect(conflict?.kind).not.toBe("ALREADY_ORDERED");
  });

  it("identity is the id, not the name — renaming must not defeat the check", () => {
    const renamed: ExistingOrder[] = [
      { activityId: "act_1", title: "杯测", time: "周六 15:00", orderNo: "1", companionId: "bob" },
    ];
    const conflict = detectOrderConflict({ activityId: "act_1", time: "周六 15:00", companionId: "bob" }, renamed);
    expect(conflict?.kind).toBe("ALREADY_ORDERED");
  });

  it("cancelled orders never block", () => {
    const cancelled: ExistingOrder[] = [
      { activityId: "act_1", title: "杯测", time: "周六 15:00", orderNo: "1", companionId: "bob", cancelled: true },
    ];
    const conflict = detectOrderConflict({ activityId: "act_1", time: "周六 15:00", companionId: "bob" }, cancelled);
    expect(conflict).toBeUndefined();
  });
});
