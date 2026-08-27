import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileBackedDemandDraftStore,
  ExpoSqliteDemandDraftStore
} from "./demand-draft-store-sqlite";
import type { LocalDemandDraft } from "./demand-draft-store";

const draft: LocalDemandDraft = {
  localId: "local_draft_001",
  sourceInput: "周日河内美食",
  version: 1,
  changes: { scenario: "opening" },
  syncState: "LOCAL_ONLY",
  updatedAt: "2026-08-27T00:00:00.000Z"
};

let tempDir: string;
let filePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "draft-store-"));
  filePath = join(tempDir, "drafts.json");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileBackedDemandDraftStore", () => {
  it("round-trips save/get/list/remove", async () => {
    const store = new FileBackedDemandDraftStore(filePath);
    await store.save(draft);
    expect(existsSync(filePath)).toBe(true);
    const restored = await store.get(draft.localId);
    expect(restored?.sourceInput).toBe(draft.sourceInput);
    expect(restored?.syncState).toBe("LOCAL_ONLY");
    const list = await store.list();
    expect(list).toHaveLength(1);
    await store.remove(draft.localId);
    expect(await store.get(draft.localId)).toBeUndefined();
    expect(await store.list()).toHaveLength(0);
  });

  it("returns empty when the file does not exist", async () => {
    const store = new FileBackedDemandDraftStore(filePath);
    expect(await store.list()).toEqual([]);
  });

  it("returns empty when the file is corrupt (fail-closed)", async () => {
    const store = new FileBackedDemandDraftStore(filePath);
    // Write garbage by triggering save once then mutating on disk.
    await store.save(draft);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, "{not valid json", "utf8");
    expect(await store.list()).toEqual([]);
  });

  it("writes atomically (no half-written file observed)", async () => {
    const store = new FileBackedDemandDraftStore(filePath);
    await store.save(draft);
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).toContain(draft.localId);
    // The .tmp file should have been renamed away.
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});

describe("ExpoSqliteDemandDraftStore (contract skeleton)", () => {
  it("throws a clear error so call-sites know to wire the native module", () => {
    expect(() => new ExpoSqliteDemandDraftStore("drafts.db")).toThrow(/expo-sqlite/);
  });
});
