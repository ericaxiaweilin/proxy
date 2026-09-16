// SCENE-CHECKIN-100M-001: 100 米打卡门禁回归钉。
import { describe, expect, it } from "vitest";
import { CHECKIN_RADIUS_METERS, checkinEligibility, checkinHint, formatCheckinDistance } from "./scene-checkin";

describe("SCENE-CHECKIN-100M-001 eligibility", () => {
  it("半径就是 100 米", () => {
    expect(CHECKIN_RADIUS_METERS).toBe(100);
  });
  it("圈内可打（含边界）", () => {
    expect(checkinEligibility(0)).toEqual({ eligible: true, reason: "ok" });
    expect(checkinEligibility(100)).toEqual({ eligible: true, reason: "ok" });
    expect(checkinEligibility(99.9)).toEqual({ eligible: true, reason: "ok" });
  });
  it("圈外拒绝", () => {
    expect(checkinEligibility(100.1)).toEqual({ eligible: false, reason: "too_far" });
    expect(checkinEligibility(5000)).toEqual({ eligible: false, reason: "too_far" });
  });
  it("没定位/非法值 = 没证据 = 不能打", () => {
    expect(checkinEligibility(undefined)).toEqual({ eligible: false, reason: "no_fix" });
    expect(checkinEligibility(NaN)).toEqual({ eligible: false, reason: "no_fix" });
    expect(checkinEligibility(-1)).toEqual({ eligible: false, reason: "no_fix" });
  });
});

describe("SCENE-CHECKIN-100M-001 hint copy", () => {
  it("已打卡说清有效期和取消", () => {
    expect(checkinHint(true, 10)).toContain("90 分钟");
  });
  it("太远报距离", () => {
    expect(checkinHint(false, 350)).toContain("约 350 米");
    expect(checkinHint(false, 1500)).toContain("约 1.5 公里");
  });
  it("没定位指路去定位", () => {
    expect(checkinHint(false, undefined)).toContain("需要定位");
  });
  it("圈内请打卡", () => {
    expect(checkinHint(false, 50)).toContain("点一下打卡");
  });
  it("距离格式化", () => {
    expect(formatCheckinDistance(50)).toBe("约 50 米");
    expect(formatCheckinDistance(NaN)).toBe("距离未知");
  });
});
