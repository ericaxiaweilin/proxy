import { describe, expect, it } from "vitest";
import { combineDayAndTime, dayOptions, scheduleRecapLabel, timeSlotOptions } from "./direct-invite-schedule";

describe("DIRECT-INVITE-SCHEDULE-001", () => {
  it("labels the first two days as 今天/明天, the rest as 周X · M月D日", () => {
    const now = new Date(2026, 2, 14); // 2026-03-14, a Saturday
    const days = dayOptions(now, 4);
    expect(days.map((d) => d.label)).toEqual(["今天", "明天", "周一 · 3月16日", "周二 · 3月17日"]);
    expect(days.map((d) => d.iso)).toEqual(["2026-03-14", "2026-03-15", "2026-03-16", "2026-03-17"]);
  });

  it("crosses a month boundary correctly", () => {
    const now = new Date(2026, 2, 30); // 2026-03-30
    const days = dayOptions(now, 3);
    expect(days.map((d) => d.iso)).toEqual(["2026-03-30", "2026-03-31", "2026-04-01"]);
  });

  it("exposes a fixed, evenly-spaced set of time slots (no free-typed minutes)", () => {
    const slots = timeSlotOptions();
    expect(slots.map((s) => s.label)).toEqual(["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"]);
    for (const slot of slots) expect(slot.minute).toBe(0);
  });

  it("combines a day and a slot into a local-time ISO string that round-trips through scheduleRecapLabel", () => {
    const iso = combineDayAndTime("2026-03-16", { hour: 15, minute: 0, label: "15:00" });
    expect(scheduleRecapLabel(iso)).toBe("周一 · 3月16日 · 15:00");
  });

  it("round-trips every generated day+slot combination without drifting a day or an hour", () => {
    const days = dayOptions(new Date(2026, 2, 14), 7);
    const slots = timeSlotOptions();
    for (const day of days) {
      for (const slot of slots) {
        const iso = combineDayAndTime(day.iso, slot);
        const recap = scheduleRecapLabel(iso);
        expect(recap.endsWith(slot.label)).toBe(true);
        // offset 2+ 的 label 是 "周X · M月D日"，那半段必须原样出现在 recap 里
        // （今天/明天没有 " · "，跳过这条断言）。
        const monthDay = day.label.split(" · ")[1];
        if (monthDay !== undefined) expect(recap).toContain(monthDay);
      }
    }
  });
});
