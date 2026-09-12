import { describe, expect, it } from "vitest";
import { parseCreatorSnapshot, parseFolders, parseHiddenChatIds } from "./local-snapshot";

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
