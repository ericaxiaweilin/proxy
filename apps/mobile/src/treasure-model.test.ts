import { describe, expect, it } from "vitest";
import { TreasureClient, TreasureError } from "./treasure-client";
import { bearingDeg, canOpenAt, compassLabel, distanceText, holdProgress, radarPoint, radarRadius, reasonText, remainingText } from "./treasure-model";

describe("treasure model", () => {
  it("bearings point the right way and read as compass words", () => {
    expect(Math.round(bearingDeg(21, 105.8, 21.01, 105.8))).toBe(0); // 正北
    expect(Math.round(bearingDeg(21, 105.8, 21, 105.81))).toBe(90); // 正东
    expect(compassLabel(0)).toBe("北");
    expect(compassLabel(92)).toBe("东");
    expect(compassLabel(225)).toBe("西南");
    expect(compassLabel(359)).toBe("北");
  });

  it("the radar zooms in on what is close and keeps far things on the rim", () => {
    expect(radarRadius(0)).toBe(0);
    expect(radarRadius(5000)).toBeCloseTo(1, 5);
    expect(radarRadius(9999)).toBeCloseTo(1, 5);
    expect(radarRadius(100)).toBeGreaterThan(0.2); // 100 米不挤在圆心
    expect(radarRadius(100)).toBeLessThan(radarRadius(500));
    const east = radarPoint(90, 500);
    expect(east.x).toBeGreaterThan(0);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    const north = radarPoint(0, 500);
    expect(north.y).toBeLessThan(0); // 屏幕上北在上方
  });

  it("formats distance, countdown and the hold progress", () => {
    expect(distanceText(33)).toBe("33 米");
    expect(distanceText(1530)).toBe("1.5 公里");
    const now = new Date("2026-10-09T10:00:00Z");
    expect(remainingText("2026-10-09T12:05:00Z", now)).toBe("2 小时 5 分");
    expect(remainingText("2026-10-09T10:35:00Z", now)).toBe("35 分钟");
    expect(remainingText("2026-10-09T09:00:00Z", now)).toBe("");
    expect(holdProgress(450)).toBe(0.5);
    expect(holdProgress(5000)).toBe(1);
    expect(canOpenAt(100)).toBe(true);
    expect(canOpenAt(101)).toBe(false);
  });

  it("turns server reason codes into plain words, never raw codes", () => {
    expect(reasonText("TOO_FAR", 350)).toContain("250 米");
    for (const code of ["ACCURACY_TOO_LOW", "ALREADY_OPENED", "CHEST_GONE", "DAILY_CAP", "SPEED_IMPLAUSIBLE", "NOT_ELIGIBLE", "BAD_LOCATION"]) {
      expect(reasonText(code)).not.toMatch(/[A-Z_]{6,}/);
    }
    expect(reasonText("something_new")).toBe("没开成，请稍后再试");
  });
});

describe("treasure client", () => {
  const fix = { lat: 21, lng: 105.8, accuracy: 12 };
  it("sends the fix with the open and surfaces server reason codes", async () => {
    let sent: unknown;
    const ok = new TreasureClient({ request: async (_p, init) => { sent = init.body; return { status: 200, json: async () => ({ kind: "SOLO", points: 10, sceneName: "x", distanceM: 30, totalPoints: 10 }) }; } });
    expect((await ok.openSolo("c1", fix)).points).toBe(10);
    expect(sent).toEqual({ kind: "SOLO", chestId: "c1", lat: 21, lng: 105.8, accuracy: 12 });
    const far = new TreasureClient({ request: async () => ({ status: 422, json: async () => ({ error: "TOO_FAR", distanceM: 250 }) }) });
    await expect(far.openSolo("c1", fix)).rejects.toMatchObject({ code: "TOO_FAR", distanceM: 250 });
    const down = new TreasureClient({ request: async () => { throw new Error("offline"); } });
    await expect(down.nearby(fix)).rejects.toBeInstanceOf(TreasureError);
  });
});
