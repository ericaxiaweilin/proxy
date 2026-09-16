// MEETUP-SHARE-001: 双人共享地址 + 地图导航回归钉。
import { describe, expect, it } from "vitest";
import {
  decodeMeetupLocation,
  encodeMeetupLocation,
  isValidLatLng,
  meetupDistanceMeters,
  meetupMidpoint,
  meetupMapsUrls,
  meetupPreview,
  meetupSummary,
  walkMinutesFor,
} from "./meetup-share";

describe("MEETUP-SHARE-001 isValidLatLng", () => {
  it("河内合法", () => {
    expect(isValidLatLng(21.0285, 105.8542)).toBe(true);
  });
  it("越界 fail-closed", () => {
    expect(isValidLatLng(91, 105)).toBe(false);
    expect(isValidLatLng(21, 181)).toBe(false);
  });
  it("NaN/Infinity fail-closed", () => {
    expect(isValidLatLng(NaN, 105)).toBe(false);
    expect(isValidLatLng(21, Infinity)).toBe(false);
  });
});

describe("MEETUP-SHARE-001 encode/decode roundtrip", () => {
  it("带标签往返", () => {
    const body = encodeMeetupLocation({ lat: 21.0285, lng: 105.8542, label: "还剑湖" });
    expect(body).toBe("还剑湖\n21.02850,105.85420");
    expect(decodeMeetupLocation(body!)).toEqual({ lat: 21.0285, lng: 105.8542, label: "还剑湖" });
  });
  it("无标签往返", () => {
    const body = encodeMeetupLocation({ lat: 10.7769, lng: 106.7009 });
    expect(body).toBe("10.77690,106.70090");
    expect(decodeMeetupLocation(body!)).toEqual({ lat: 10.7769, lng: 106.7009 });
  });
  it("非法坐标不发", () => {
    expect(encodeMeetupLocation({ lat: 91, lng: 0 })).toBeUndefined();
    expect(encodeMeetupLocation({ lat: NaN, lng: 0 })).toBeUndefined();
  });
  it("google 外链可解、无标签", () => {
    expect(decodeMeetupLocation("https://maps.google.com/?q=21.0285,105.8542")).toEqual({
      lat: 21.0285,
      lng: 105.8542,
    });
  });
  it("垃圾文本解不出（渲染原文，不猜）", () => {
    expect(decodeMeetupLocation("")).toBeUndefined();
    expect(decodeMeetupLocation("今晚见")).toBeUndefined();
    expect(decodeMeetupLocation("100,200")).toBeUndefined();
  });
});

describe("MEETUP-SHARE-001 maps urls", () => {
  it("三端外链", () => {
    expect(meetupMapsUrls({ lat: 21.0285, lng: 105.8542 })).toEqual({
      google: "https://maps.google.com/?q=21.0285,105.8542",
      apple: "https://maps.apple.com/?q=21.0285,105.8542",
      geo: "geo:21.0285,105.8542?q=21.0285,105.8542",
    });
  });
  it("非法不出链", () => {
    expect(meetupMapsUrls({ lat: 91, lng: 0 })).toBeUndefined();
  });
});

describe("MEETUP-SHARE-001 midpoint/distance/summary", () => {
  it("中点对称", () => {
    expect(meetupMidpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 2 })).toEqual({ lat: 0, lng: 1 });
  });
  it("同一点距离 0", () => {
    expect(meetupDistanceMeters({ lat: 21, lng: 105 }, { lat: 21, lng: 105 })).toBe(0);
  });
  it("河内—胡志明约 1100km（区间不断言精确值）", () => {
    const d = meetupDistanceMeters({ lat: 21.0285, lng: 105.8542 }, { lat: 10.7769, lng: 106.7009 })!;
    expect(d).toBeGreaterThan(1_000_000);
    expect(d).toBeLessThan(1_300_000);
  });
  it("步行耗时：5km≈60分钟，很近≈1", () => {
    expect(walkMinutesFor(5000)).toBe(60);
    expect(walkMinutesFor(10)).toBe(1);
    expect(walkMinutesFor(-1)).toBeUndefined();
  });
  it("小结非法返回 undefined", () => {
    expect(meetupSummary({ lat: 91, lng: 0 }, { lat: 21, lng: 105 })).toBeUndefined();
    const s = meetupSummary({ lat: 0, lng: 0 }, { lat: 0, lng: 2 })!;
    expect(s.walkMinutes).toBeGreaterThan(1000);
    expect(s.midpoint).toEqual({ lat: 0, lng: 1 });
  });
});

describe("MEETUP-SHARE-001 inbox preview", () => {
  it("位置消息显示 [位置]", () => {
    expect(meetupPreview("还剑湖\n21.02850,105.85420")).toBe("[位置] 还剑湖");
    expect(meetupPreview("10.77690,106.70090")).toBe("[位置]");
  });
  it("非位置回落 undefined（调用方显示原文）", () => {
    expect(meetupPreview("今晚见")).toBeUndefined();
  });
});
