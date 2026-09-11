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
      return JSON.parse(files["feeds"] ?? "null");
    }
    write(content: string): void {
      files["feeds"] = content;
      exists = true;
    }
  },
}));

import { readCustomFeedsAsync, parseCustomFeedsSnapshot, writeCustomFeeds } from "./expo-custom-feed-store";
import type { CustomFeed } from "./surfaces/custom-feed";

const FALLBACK: CustomFeed[] = [{ id: "friends", name: "朋友", desc: "关注的人", icon: "♥", pinned: true }];

describe("expo-custom-feed-store", () => {
  beforeEach(() => {
    for (const key of Object.keys(files)) delete files[key];
    exists = false;
  });

  it("returns fallback when nothing is stored", async () => {
    expect(await readCustomFeedsAsync(FALLBACK)).toEqual(FALLBACK);
  });

  it("round-trips pins and custom channels", async () => {
    writeCustomFeeds([
      { id: "friends", name: "朋友", desc: "关注的人", icon: "♥", pinned: false },
      { id: "ai_x", name: "摄影精选", desc: "河内摄影", icon: "◯", pinned: true, aiGenerated: true },
    ]);
    const restored = await readCustomFeedsAsync(FALLBACK);
    expect(restored).toHaveLength(2);
    expect(restored[0]?.pinned).toBe(false);
    expect(restored[1]?.aiGenerated).toBe(true);
  });

  it("drops malformed rows and falls back on corrupt files", async () => {
    files["feeds"] = JSON.stringify({ version: 1, feeds: [{ id: "", name: "" }, { id: "ok", name: "好" }, 42] });
    exists = true;
    expect(await readCustomFeedsAsync(FALLBACK)).toEqual([{ id: "ok", name: "好", desc: "", icon: "▣", pinned: false }]);
    files["feeds"] = "not-json{{{";
    expect(await readCustomFeedsAsync(FALLBACK)).toEqual(FALLBACK);
  });

  it("SYNC-FS-001: an un-awaited json Promise parses to fallback", () => {
    expect(parseCustomFeedsSnapshot(Promise.resolve({ version: 1 }), FALLBACK)).toEqual(FALLBACK);
  });
});
