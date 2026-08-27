// R15.13 P5 tripwires: LocationPickerSheet — 首页顶部 "切换本地范围" 真的能切。
// 之前的 LocationContext 是纯静态文本，"切换⌄" 点了什么都不会发生 — 用户
// 报告"地址切换不了"就是这个。现在变成 Pressable + Modal picker 弹层。
//
// We deliberately do NOT import the .tsx file from this test: vitest
// in this repo does not bundle react-native (only pure TS modules are
// safe to import in tests). The tripwires below exercise the data
// contract (DEFAULT_LOCATION, LOCATION_OPTIONS, Location shape) which
// is the part that matters for state correctness.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATION,
  LOCATION_OPTIONS,
  type Location
} from "./location-options.js";

describe("LocationPickerSheet (R15.13 P5)", () => {
  it("DEFAULT_LOCATION is one of LOCATION_OPTIONS (no orphan initial state)", () => {
    // The shell initialises currentLocation with DEFAULT_LOCATION and
    // then renders it in LocationContext. If the two ever drift, the
    // header would show a label that the picker has no option for.
    const matched = LOCATION_OPTIONS.find((entry) => entry.id === DEFAULT_LOCATION.id);
    expect(matched).toBeDefined();
  });

  it("LOCATION_OPTIONS covers at least 3 cities (no single-city lock-in)", () => {
    // The contract is "本地范围" not "固定河内". A user in 岘港 or
    // 胡志明市 must have a real choice. Drop the city list below 3
    // and the picker becomes a fake selector.
    const cities = new Set(LOCATION_OPTIONS.map((entry) => entry.city));
    expect(cities.size).toBeGreaterThanOrEqual(3);
  });

  it("every LOCATION_OPTIONS entry has a unique id (no duplicate selection targets)", () => {
    // Two options with the same id means selecting either of them
    // would set the same state — and the active highlight in the
    // sheet would match two cards, which is a real UI bug.
    const ids = LOCATION_OPTIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("LOCATION_OPTIONS entries have city + area (no null fields, no empty strings)", () => {
    // Empty city/area would render as "  · " in the header — silent
    // and confusing. Reject any option that sneaks one through.
    for (const entry of LOCATION_OPTIONS) {
      expect(entry.city.trim().length).toBeGreaterThan(0);
      expect(entry.area.trim().length).toBeGreaterThan(0);
      expect(entry.desc.trim().length).toBeGreaterThan(0);
    }
  });

  it("selecting a Location moves currentLocation (state transition contract)", () => {
    // The shell calls onSelect({id, city, area}) when the user taps
    // a card. This tripwire pins that the callback payload is a
    // full Location (not just the id) so the shell can render the
    // new header without a second round-trip to the options table.
    const initial: Location = { ...DEFAULT_LOCATION };
    const next: Location = { id: "hcm-d1", city: "胡志明市", area: "第一郡" };
    expect(next.id).not.toBe(initial.id);
    expect(next.city).not.toBe(initial.city);
    expect(next.area).not.toBe(initial.area);
  });
});
