import { describe, expect, it } from "vitest";
import {
  coverForStore, filterHubShops, formatHoursLines, formatMonthDay,
  satisfactionRate, satisfactionRateText, satisfactionText,
} from "./my-store-hub-model";

describe("STORE-HUB-001 hub pure functions", () => {
  it("cover is stable per seed", () => {
    expect(coverForStore("咖啡厅")).toEqual(coverForStore("咖啡厅"));
    expect(coverForStore("").from).toMatch(/^#/);
  });

  it("satisfaction rate only from rated orders", () => {
    expect(satisfactionRate(0, 0)).toBeUndefined();
    expect(satisfactionRateText(0, 0)).toBe("暂无评价");
    expect(satisfactionRate(3, 1)).toBe(75);
    expect(satisfactionRateText(3, 1)).toBe("满意 75%");
  });

  it("satisfaction codes map to plain words", () => {
    expect(satisfactionText("FULL")).toBe("满意");
    expect(satisfactionText("PARTIAL")).toBe("还行");
    expect(satisfactionText("NONE")).toBe("不满意");
    expect(satisfactionText("")).toBe("待评价");
  });

  it("month-day formats or hides", () => {
    expect(formatMonthDay("2026-09-22T10:00:00Z")).toBe("09-22");
    expect(formatMonthDay("")).toBe("");
    expect(formatMonthDay("not-a-date")).toBe("");
  });

  it("hours blob renders lines or nothing", () => {
    expect(formatHoursLines('{"每天":"09:00-22:00"}')).toEqual(["每天 09:00-22:00"]);
    expect(formatHoursLines("{}")).toEqual([]);
    expect(formatHoursLines("oops")).toEqual([]);
  });

  it("search plus category plus rate sort", () => {
    const shops = [
      { id: "a", name: "云顶咖啡", address: "西湖区", category: "咖啡厅", orderCount: 12, fullCount: 9, partialCount: 1 },
      { id: "b", name: "Hana 美甲", address: "还剑区", category: "美甲", orderCount: 8, fullCount: 0, partialCount: 0 },
      { id: "c", name: "光影摄影", address: "二征区", category: "摄影", orderCount: 6, fullCount: 5, partialCount: 0 },
    ];
    expect(filterHubShops(shops, "咖啡", "", false).map((s) => s.id)).toEqual(["a"]);
    expect(filterHubShops(shops, "", "美甲", false).map((s) => s.id)).toEqual(["b"]);
    expect(filterHubShops(shops, "", "", true).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});
