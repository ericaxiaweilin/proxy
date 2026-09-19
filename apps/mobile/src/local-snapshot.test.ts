import { describe, expect, it } from "vitest";
import { parseCreatorSnapshot, parseFolders, parseHiddenChatIds, parseHiddenChatTimes, shouldResurfaceHidden } from "./local-snapshot";

describe("SYNC-FS-001 local snapshot parsers", () => {
  it("parses hidden chat ids, dropping non-strings", () => {
    expect(parseHiddenChatIds(["a", "b"])).toEqual(["a", "b"]);
    expect(parseHiddenChatIds(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(parseHiddenChatIds({})).toEqual([]);
    expect(parseHiddenChatIds(undefined)).toEqual([]);
    // Regression: an un-awaited File.json() yields a Promise, which must
    // parse to empty (never crash, never leak).
    expect(parseHiddenChatIds(Promise.resolve(["a"]))).toEqual([]);
  });

  it("parses hidden chat times, migrating legacy id arrays to 0", () => {
    expect(parseHiddenChatTimes(["a", "b"])).toEqual({ a: 0, b: 0 });
    expect(parseHiddenChatTimes([{ id: "a", at: 100 }, { id: "b", at: -5 }, "c"])).toEqual({ a: 100, c: 0 });
    expect(parseHiddenChatTimes({ a: 100, b: "x", c: -1 })).toEqual({ a: 100 });
    expect(parseHiddenChatTimes({})).toEqual({});
    expect(parseHiddenChatTimes(undefined)).toEqual({});
    expect(parseHiddenChatTimes(Promise.resolve(["a"]))).toEqual({});
  });

  it("resurfaces hidden threads only on strictly newer activity", () => {
    expect(shouldResurfaceHidden(undefined, 999)).toBe(false);
    expect(shouldResurfaceHidden(100, 100)).toBe(false);
    expect(shouldResurfaceHidden(100, 99)).toBe(false);
    expect(shouldResurfaceHidden(100, 101)).toBe(true);
    expect(shouldResurfaceHidden(0, 1)).toBe(true);
  });

  it("parses folders, dropping malformed entries", () => {
    expect(parseFolders([
      { id: "f1", name: "朋友", dialogIds: ["a", 1, "b"] },
      { id: 2, name: "坏" },
      "nope"
    ])).toEqual([{ id: "f1", name: "朋友", dialogIds: ["a", "b"] }]);
    expect(parseFolders(undefined)).toEqual([]);
  });

  it("parses creator snapshots with safe defaults", () => {
    expect(parseCreatorSnapshot(undefined)).toBeUndefined();
    expect(parseCreatorSnapshot({})).toMatchObject({ accepted: false, primaryCategory: "Beauty" });
    expect(parseCreatorSnapshot({ accepted: true, categories: ["X"], primaryCategory: "P", city: "C", channels: {}, collaborations: [], collabNote: "", rates: {}, rateVisibility: "询价" }))
      .toMatchObject({ accepted: true, rateVisibility: "询价" });
  });
});
