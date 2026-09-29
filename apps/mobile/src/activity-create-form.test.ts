import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  canPublishForm,
  capacityOfRange,
  clampPeople,
  composeActivityTime,
  dayOfMonthISO,
  decodeDraft,
  defaultCreateForm,
  encodeDraft,
  formProgress,
  FORM_PROGRESS_TOTAL,
  isTimeAvailable,
  loadSceneSpots,
  nextAvailableTime,
  parseSceneSpots,
  peopleRangeLabel,
  spotsWithCoords,
  spotGlyph,
  todayLocalISO,
  venueTypeForCategory,
  venueTypeForSpotType,
  weekdayIndexISO,
  type CreateFormState,
} from "./activity-create-form";

function state(over: Partial<CreateFormState> = {}): CreateFormState {
  return { ...defaultCreateForm("2026-09-28"), ...over };
}

describe("ACTIVITY-CREATE-FORM-001 create form state machine", () => {
  it("gates publish on category, name and a catalog scene", () => {
    expect(canPublishForm(state())).toBe(false);
    expect(canPublishForm(state({ cat: "cafe" }))).toBe(false);
    expect(canPublishForm(state({ cat: "cafe", name: "咖啡拍照" }))).toBe(false);
    // 手输文字不算：无 placeId 的活动在场景页不可见，放行等于造不可见数据。
    expect(canPublishForm(state({ cat: "cafe", name: "咖啡拍照", placeName: "手输" }))).toBe(false);
    expect(canPublishForm(state({ cat: "cafe", name: " 咖啡拍照 ", placeId: "threebeans", placeName: "Three Beans" }))).toBe(true);
  });

  it("counts progress in sevenths like the prototype", () => {
    expect(FORM_PROGRESS_TOTAL).toBe(7);
    expect(formProgress(state())).toBe(4);
    expect(formProgress(state({ cat: "cafe", name: "x", placeId: "s1" }))).toBe(7);
  });

  it("clamps people to 2..50 and labels the range", () => {
    expect(clampPeople(4, 6)).toEqual({ min: 4, max: 6 });
    expect(clampPeople(1, 99)).toEqual({ min: 2, max: 50 });
    expect(clampPeople(6, 6)).toEqual({ min: 5, max: 6 });
    expect(peopleRangeLabel(4, 6)).toBe("4–6");
    expect(peopleRangeLabel(20, 50)).toBe("20–50+");
    expect(capacityOfRange(6)).toBe(6);
    expect(capacityOfRange(99)).toBe(50);
  });

  it("composes time labels with duration and midnight crossing", () => {
    expect(composeActivityTime("周日", 14, 0, 120, "全天", "次日")).toBe("周日 14:00–16:00");
    expect(composeActivityTime("周日", 9, 30, 60, "全天", "次日")).toBe("周日 09:30–10:30");
    expect(composeActivityTime("周日", 10, 0, "all", "全天", "次日")).toBe("周日 全天");
    expect(composeActivityTime("周五", 22, 0, 120, "全天", "次日")).toBe("周五 22:00–次日00:00");
  });

  it("disables past times today with a 15-minute buffer, anything goes other days", () => {
    const now = new Date(2026, 8, 28, 14, 0, 0);
    const today = todayLocalISO(now);
    expect(isTimeAvailable(today, 13, 30, now)).toBe(false);
    expect(isTimeAvailable(today, 14, 30, now)).toBe(true);
    expect(isTimeAvailable(today, 8, 0, now)).toBe(false);
    expect(isTimeAvailable("2099-01-01", 8, 0, now)).toBe(true);
    expect(nextAvailableTime(today, now)).toEqual({ hour: 14, minute: 30 });
    expect(nextAvailableTime(today, new Date(2026, 8, 28, 23, 0, 0))).toBe(undefined);
  });

  it("maps categories and spot types to venue types without inventing", () => {
    expect(venueTypeForCategory("cafe")).toBe("CAFE");
    expect(venueTypeForCategory("food")).toBe("RESTAURANT");
    expect(venueTypeForCategory("sport")).toBe("OTHER");
    expect(venueTypeForSpotType("咖啡 · 动态场景")).toBe("CAFE");
    expect(venueTypeForSpotType("街区 · 摄影")).toBe(undefined);
  });

  it("round-trips drafts and repairs stale or garbage ones", () => {
    const full = state({ cat: "photo", name: "街拍", placeId: "s9", peopleMin: 2, peopleMax: 4 });
    expect(decodeDraft(encodeDraft(full), "2026-09-28")).toEqual(full);
    expect(decodeDraft(undefined, "2026-09-28")).toBe(undefined);
    expect(decodeDraft("{{{", "2026-09-28")).toBe(undefined);
    expect(decodeDraft(JSON.stringify({ v: 999, state: full }), "2026-09-28")).toBe(undefined);
    // 过期日期回到今天，其他保留。
    const stale = decodeDraft(encodeDraft(state({ dateISO: "2026-09-01", name: "x" })), "2026-09-28");
    expect(stale?.dateISO).toBe("2026-09-28");
    expect(stale?.name).toBe("x");
  });

  it("parses the scene catalog like home and only pins finite coords", () => {
    const spots = parseSceneSpots({
      scenes: [
        { id: "a", name: "A", latitude: 21.1, longitude: 105.1 },
        { id: "b", name: "B" },
        { nope: true },
      ],
    });
    expect(spots).toHaveLength(2);
    expect(spotsWithCoords(spots).map((s) => s.id)).toEqual(["a"]);
    expect(spotGlyph({ type: "咖啡 · 动态场景" })).toBe("☕");
    expect(spotGlyph({ type: "街区 · 摄影" })).toBe("●");
  });

  it("loads spots through an injected fetch", async () => {
    const spots = await loadSceneSpots(
      async () => ({ ok: true, json: async () => ({ scenes: [{ id: "a", name: "A" }] }) }),
      "http://x/",
    );
    expect(spots).toEqual([{ id: "a", name: "A", type: "", category: "", area: "", imageUrl: "", latitude: NaN, longitude: NaN }]);
    await expect(loadSceneSpots(async () => ({ ok: false, json: async () => ({}) }), "http://x")).rejects.toThrow();
  });

  it("handles local date math", () => {
    expect(addDaysISO("2026-09-28", 3)).toBe("2026-10-01");
    expect(weekdayIndexISO("2026-09-28")).toBe(new Date(2026, 8, 28).getDay());
    expect(dayOfMonthISO("2026-09-28")).toBe(28);
  });
});
