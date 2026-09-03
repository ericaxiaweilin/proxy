import { describe, expect, it } from "vitest";
import {
  ALLOWED_DURATION_SECONDS,
  labelForDuration,
  summariseConsent,
  type LocationConsent,
} from "./precise-location-toggle-helpers";

const NOW = Date.parse("2026-09-04T10:00:00Z");

describe("labelForDuration", () => {
  it("renders 30 minutes in vi", () => {
    expect(labelForDuration(30 * 60, "vi")).toBe("30 phút");
  });
  it("renders 8 hours in vi", () => {
    expect(labelForDuration(8 * 60 * 60, "vi")).toBe("8 giờ");
  });
  it("renders 30 minutes in zh", () => {
    expect(labelForDuration(30 * 60, "zh")).toBe("30 分钟");
  });
  it("renders 8 hours in zh", () => {
    expect(labelForDuration(8 * 60 * 60, "zh")).toBe("8 小时");
  });
  it("falls back to minutes for unknown values", () => {
    expect(labelForDuration(5 * 60, "vi")).toBe("5m");
  });
  it("matches every value exposed by the client", () => {
    for (const d of ALLOWED_DURATION_SECONDS) {
      // No throw, no empty string. We don't pin the exact
      // wording because the client owns the canonical list.
      expect(labelForDuration(d, "vi").length).toBeGreaterThan(0);
    }
  });
});

describe("summariseConsent", () => {
  it("returns the loading placeholder when consent is null", () => {
    expect(summariseConsent(null, NOW, "vi")).toBe("Đang tải...");
    expect(summariseConsent(undefined, NOW, "vi")).toBe("Đang tải...");
  });
  it("returns Đang tắt when status is REVOKED", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "REVOKED",
      remainingSeconds: 0,
      durationSeconds: 1800,
    };
    expect(summariseConsent(c, NOW, "vi")).toBe("Đang tắt");
  });
  it("returns the active summary with remaining for a GRANTED row", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T10:30:00Z",
      remainingSeconds: 1800,
      durationSeconds: 1800,
    };
    const summary = summariseConsent(c, NOW, "vi");
    expect(summary.startsWith("Đang bật")).toBe(true);
    expect(summary).toContain("30 phút");
  });
  it("falls back to expiresAt when remainingSeconds is 0", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T10:30:00Z",
      remainingSeconds: 0, // server hasn't run the sweep yet
      durationSeconds: 1800,
    };
    const summary = summariseConsent(c, NOW, "vi");
    expect(summary).toContain("30 phút");
  });
  it("renders zh output for zh locale", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T18:00:00Z",
      remainingSeconds: 28800,
      durationSeconds: 28800,
    };
    const summary = summariseConsent(c, NOW, "zh");
    expect(summary.startsWith("已开启")).toBe(true);
    expect(summary).toContain("8 小时");
  });
});
