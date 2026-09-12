import { beforeEach, describe, expect, it, vi } from "vitest";

const files: Record<string, string> = {};
let exists = false;

vi.mock("expo-file-system", () => ({
  Paths: { document: { uri: "file:///doc/" } },
  Directory: class {
    constructor(
      public readonly base: unknown,
      public readonly name: string
    ) {}
    create(): void {}
  },
  File: class {
    constructor(
      public readonly directory: unknown,
      public readonly name: string
    ) {}
    get exists(): boolean {
      return exists;
    }
    // SYNC-FS-001: the real File.json() is async — mocks must match.
    async json(): Promise<unknown> {
      return JSON.parse(files["prefs"] ?? "null");
    }
    write(content: string): void {
      files["prefs"] = content;
      exists = true;
    }
  },
}));

import { DEFAULT_FEED_PREFS, parseFeedPrefsSnapshot, readFeedPrefsAsync, writeFeedPrefs } from "./expo-feed-prefs-store";

describe("expo-feed-prefs-store", () => {
  beforeEach(() => {
    for (const key of Object.keys(files)) delete files[key];
    exists = false;
  });

  it("returns defaults when nothing is stored", async () => {
    const prefs = await readFeedPrefsAsync();
    expect(prefs.weights).toEqual(DEFAULT_FEED_PREFS.weights);
    expect(prefs.scope).toBe("PERSISTENT");
    expect(prefs.muted).toEqual([]);
    expect(prefs.algoApplied).toBeNull();
  });

  // FEED-SCOPE-001 — 逃逸于 2026-09-12。
  //
  // 现象：动态帖文数量「丢失严重」。后端没丢：库里 39 篇，接口也返回 39 篇，
  // 分页 25 + 14 无重复。真正的原因是客户端默认时间范围 scope = "7D"，
  // 而窗口相对 Date.now() 滚动 —— 实测 39 篇里 24 篇（62%）被静默隐藏，
  // 时间线上又完全没有「正在筛选」的提示，看起来就是数据丢了。
  //
  // 默认必须是长期。时间范围退化成一个用户主动选择的筛选项。
  it("FEED-SCOPE-001: the default time scope never hides posts on its own", () => {
    expect(DEFAULT_FEED_PREFS.scope).toBe("PERSISTENT");
    expect(parseFeedPrefsSnapshot(null).scope).toBe("PERSISTENT");
    expect(parseFeedPrefsSnapshot({ version: 1 }).scope).toBe("PERSISTENT");
  });

  it("FEED-SCOPE-001: an explicitly saved 7D/30D choice survives a default change", () => {
    // 旧实现把 "7D" 当非法值，于是改默认值时会静默覆盖用户已经做的选择。
    expect(parseFeedPrefsSnapshot({ version: 1, scope: "7D" }).scope).toBe("7D");
    expect(parseFeedPrefsSnapshot({ version: 1, scope: "30D" }).scope).toBe("30D");
    expect(parseFeedPrefsSnapshot({ version: 1, scope: "PERSISTENT" }).scope).toBe("PERSISTENT");
  });

  it("round-trips weights, scope, muted, and algo text", async () => {
    writeFeedPrefs({
      weights: { opportunity: 90, people: 10 },
      scope: "30D",
      muted: ["商业内容"],
      algoApplied: "多看摄影",
    });
    const prefs = await readFeedPrefsAsync();
    expect(prefs.weights.opportunity).toBe(90);
    expect(prefs.weights.people).toBe(10);
    expect(prefs.weights.commercial).toBe(DEFAULT_FEED_PREFS.weights.commercial);
    expect(prefs.scope).toBe("30D");
    expect(prefs.muted).toEqual(["商业内容"]);
    expect(prefs.algoApplied).toBe("多看摄影");
  });

  it("clamps out-of-range weights and drops malformed rows", async () => {
    files["prefs"] = JSON.stringify({
      version: 1,
      weights: { opportunity: 500, people: -20, commercial: "high" },
      scope: "FOREVER",
      muted: ["a", 42],
      algoApplied: 7,
    });
    exists = true;
    const prefs = await readFeedPrefsAsync();
    expect(prefs.weights.opportunity).toBe(100);
    expect(prefs.weights.people).toBe(0);
    expect(prefs.weights.commercial).toBe(DEFAULT_FEED_PREFS.weights.commercial);
    // FEED-SCOPE-001: only a missing/illegal value falls back to the default.
    expect(prefs.scope).toBe("PERSISTENT");
    expect(prefs.muted).toEqual(["a"]);
    expect(prefs.algoApplied).toBeNull();
  });

  it("SYNC-FS-001: an un-awaited json Promise parses to defaults", () => {
    expect(parseFeedPrefsSnapshot(Promise.resolve({ version: 1 })).weights)
      .toEqual(DEFAULT_FEED_PREFS.weights);
  });
});
