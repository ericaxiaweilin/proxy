import { describe, expect, it } from "vitest";
import { hasOpenSeat, pickRefreshedActivity, type SlotActivity } from "./for-you-slots";
import type { ComboScene } from "./requester-home-combo";

const scenes: ComboScene[] = [
  { id: "beans", name: "Three Beans", area: "Cầu Giấy", imageUrl: "" },
  { id: "lake", name: "West Lake Cafe", area: "Tây Hồ", imageUrl: "" },
];

const act = (id: string, over: Partial<SlotActivity> = {}): SlotActivity => ({
  activityId: id, title: id, venueName: "Three Beans", time: "周六 15:00", realitySceneId: "beans", joined: 0, capacity: 4, ...over,
});

const none = new Set<string>();

describe("HOME-FORYOU-REFRESH-001 for-you slot refresh", () => {
  it("never picks a full activity or one I already ordered", () => {
    const list = [act("full", { joined: 2, capacity: 2 }), act("mine"), act("open")];
    for (let i = 0; i < 20; i += 1) {
      const pick = pickRefreshedActivity(list, scenes, {}, new Set(["mine"]), undefined, () => i / 20);
      expect(pick).toEqual({ kind: "picked", index: 2, changed: true });
    }
    expect(hasOpenSeat({ joined: 5, capacity: 0 })).toBe(true);
  });

  it("changes to a different activity when another is available", () => {
    const list = [act("a"), act("b")];
    for (let i = 0; i < 20; i += 1) {
      const pick = pickRefreshedActivity(list, scenes, {}, none, "a", () => i / 20);
      expect(pick).toEqual({ kind: "picked", index: 1, changed: true });
    }
    expect(pickRefreshedActivity([act("a")], scenes, {}, none, "a")).toEqual({ kind: "picked", index: 0, changed: false });
  });

  it("respects locked place and time instead of creating a conflict", () => {
    const list = [act("beans-sat"), act("lake-sat", { venueName: "West Lake Cafe", realitySceneId: "lake" }), act("beans-sun", { time: "周日 10:00" })];
    for (let i = 0; i < 20; i += 1) {
      expect(pickRefreshedActivity(list, scenes, { placeSceneId: "lake" }, none, "beans-sat", () => i / 20)).toEqual({ kind: "picked", index: 1, changed: true });
      expect(pickRefreshedActivity(list, scenes, { time: "周日 10:00" }, none, "beans-sat", () => i / 20)).toEqual({ kind: "picked", index: 2, changed: true });
    }
    expect(pickRefreshedActivity(list, scenes, { placeSceneId: "lake", time: "周日 10:00" }, none, undefined)).toEqual({ kind: "none", reason: "NO_AVAILABLE" });
  });

  it("keeps a locked activity only while it is still available", () => {
    const list = [act("locked"), act("other")];
    expect(pickRefreshedActivity(list, scenes, { activityId: "locked" }, none, "locked")).toEqual({ kind: "picked", index: 0, changed: false });
    const nowFull = [act("locked", { joined: 4, capacity: 4 }), act("other")];
    expect(pickRefreshedActivity(nowFull, scenes, { activityId: "locked" }, none, "locked")).toEqual({ kind: "none", reason: "LOCKED_ACTIVITY_UNAVAILABLE" });
  });
});
