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
    json(): unknown {
      return JSON.parse(files["prefs"] ?? "null");
    }
    write(content: string): void {
      files["prefs"] = content;
      exists = true;
    }
  },
}));

import { DEFAULT_FEED_PREFS, readFeedPrefs, writeFeedPrefs } from "./expo-feed-prefs-store";

describe("expo-feed-prefs-store", () => {
  beforeEach(() => {
    for (const key of Object.keys(files)) delete files[key];
    exists = false;
  });

  it("returns defaults when nothing is stored", () => {
    const prefs = readFeedPrefs();
    expect(prefs.weights).toEqual(DEFAULT_FEED_PREFS.weights);
    expect(prefs.scope).toBe("7D");
    expect(prefs.muted).toEqual([]);
    expect(prefs.algoApplied).toBeNull();
  });

  it("round-trips weights, scope, muted, and algo text", () => {
    writeFeedPrefs({
      weights: { opportunity: 90, people: 10 },
      scope: "30D",
      muted: ["商业内容"],
      algoApplied: "多看摄影",
    });
    const prefs = readFeedPrefs();
    expect(prefs.weights.opportunity).toBe(90);
    expect(prefs.weights.people).toBe(10);
    expect(prefs.weights.commercial).toBe(DEFAULT_FEED_PREFS.weights.commercial);
    expect(prefs.scope).toBe("30D");
    expect(prefs.muted).toEqual(["商业内容"]);
    expect(prefs.algoApplied).toBe("多看摄影");
  });

  it("clamps out-of-range weights and drops malformed rows", () => {
    files["prefs"] = JSON.stringify({
      version: 1,
      weights: { opportunity: 500, people: -20, commercial: "high" },
      scope: "FOREVER",
      muted: ["a", 42],
      algoApplied: 7,
    });
    exists = true;
    const prefs = readFeedPrefs();
    expect(prefs.weights.opportunity).toBe(100);
    expect(prefs.weights.people).toBe(0);
    expect(prefs.weights.commercial).toBe(DEFAULT_FEED_PREFS.weights.commercial);
    expect(prefs.scope).toBe("7D");
    expect(prefs.muted).toEqual(["a"]);
    expect(prefs.algoApplied).toBeNull();
  });
});
