import { describe, expect, it } from "vitest";
import { adviceMessage, fetchWeather, nextOccurrence, weatherLine } from "./weather";

describe("weather", () => {
  it("shows city, condition and rounded temperature", () => {
    expect(weatherLine("北宁", { tempC: 27.6, condition: "clear" })).toBe("北宁 · 晴 28°");
  });

  it("an unreadable forecast draws nothing (no default sunny day)", async () => {
    expect(await fetchWeather((async () => ({ ok: false })) as unknown as typeof fetch, "http://x", { lat: 21, lng: 106 })).toBeUndefined();
    expect(await fetchWeather((async () => { throw new Error("offline"); }) as unknown as typeof fetch, "http://x", { lat: 21, lng: 106 })).toBeUndefined();
  });

  it("a slot that already passed today means tomorrow", () => {
    const now = new Date(2026, 9, 9, 20, 0);
    expect(nextOccurrence("09:00", now).getDate()).toBe(10);
    expect(nextOccurrence("21:00", now).getDate()).toBe(9);
  });

  it("warns with tappable times only when they resolve to the same instant", () => {
    const now = new Date(2026, 9, 9, 10, 0);
    const at = new Date(2026, 9, 9, 15, 0);
    const same = new Date(2026, 9, 9, 18, 0).toISOString();
    const nextDay = new Date(2026, 9, 10, 18, 0).toISOString(); // 「18:00」会被解析成今天 18:00，不是明天
    const msg = adviceMessage({ level: "WARN", condition: "heavy_rain", maxPrecipProb: 90, suggestions: [same, nextDay] }, at, now);
    expect(msg?.tone).toBe("warn");
    expect(msg?.text).toContain("暴雨");
    expect(msg?.options[0]).toEqual({ label: "18:00", iso: same, slot: "18:00" });
    expect(msg?.options[1]).toEqual({ label: "明天 18:00", iso: nextDay });
  });

  it("ordinary rain is a reminder; dry or unknown says nothing", () => {
    const now = new Date(2026, 9, 9, 10, 0);
    const at = new Date(2026, 9, 9, 15, 0);
    expect(adviceMessage({ level: "CAUTION", condition: "rain", maxPrecipProb: 65, suggestions: [] }, at, now)?.tone).toBe("caution");
    expect(adviceMessage({ level: "OK", maxPrecipProb: 5, suggestions: [] }, at, now)).toBeUndefined();
    expect(adviceMessage({ level: "UNKNOWN", maxPrecipProb: 0, suggestions: [] }, at, now)).toBeUndefined();
    expect(adviceMessage(undefined, at, now)).toBeUndefined();
  });
});
