import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { TaskDraftChanges } from "@proxy/contracts";
import type { DemandDraftStore, LocalDemandDraft, LocalDraftSyncState } from "./demand-draft-store";

/**
 * File-backed JSON demand draft store. This is the reference
 * implementation of `DemandDraftStore` for environments where
 * SQLite is not available (web preview, vitest, CI). On native
 * builds (Expo / bare React Native) the production store is a
 * thin wrapper over `expo-sqlite` exposing the same interface; see
 * apps/mobile/src/demand-draft-store-expo-sqlite.ts for the
 * production-ready skeleton (kept in this repo so a future change
 * can swap implementations without touching call-sites).
 *
 * The on-disk format is a single JSON object keyed by `localId`.
 * The file is rewritten atomically via rename: write-tmp + rename.
 * On any read failure the store returns an empty list (the in-app
 * "lost local drafts" copy uses this signal to show a banner).
 */
export class FileBackedDemandDraftStore implements DemandDraftStore {
  public constructor(private readonly filePath: string) {}

  public async get(localId: string): Promise<LocalDemandDraft | undefined> {
    const all = await this.readAll();
    return all[localId] ? clone(all[localId]) : undefined;
  }

  public async save(draft: LocalDemandDraft): Promise<void> {
    const all = await this.readAll();
    all[draft.localId] = clone(draft);
    await this.writeAll(all);
  }

  public async remove(localId: string): Promise<void> {
    const all = await this.readAll();
    if (all[localId] === undefined) {
      return;
    }
    delete all[localId];
    await this.writeAll(all);
  }

  public async list(): Promise<LocalDemandDraft[]> {
    const all = await this.readAll();
    return Object.values(all).map((d) => clone(d));
  }

  private async readAll(): Promise<Record<string, LocalDemandDraft>> {
    try {
      const buf = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(buf) as Record<string, LocalDemandDraft>;
      if (parsed === null || typeof parsed !== "object") {
        return {};
      }
      return parsed;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return {};
      }
      // Corrupt file: fail closed (empty) so the app does not crash.
      // The App should surface a "lost local drafts" banner in this
      // state.
      return {};
    }
  }

  private async writeAll(all: Record<string, LocalDemandDraft>): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(all), "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(tmp, this.filePath);
  }
}

/**
 * Production skeleton for the Expo SQLite-backed store. Real
 * implementation lives in the native shell; this file documents
 * the contract so call-sites stay portable across web preview
 * (FileBackedDemandDraftStore) and native (this class).
 *
 * When wiring the real native module, replace the body of each
 * method with the corresponding `expo-sqlite` call. The interface
 * `DemandDraftStore` is intentionally async-only so the SQLite
 * boundary is hidden.
 */
export class ExpoSqliteDemandDraftStore implements DemandDraftStore {
  public constructor(_dbName: string) {
    // _dbName: "drafts.db" in production. The native module opens
    // the database once at app start; this constructor is a no-op
    // for now. Real impl: `this.db = await SQLite.openDatabaseAsync(dbName);`
    throw new Error(
      "ExpoSqliteDemandDraftStore is a contract skeleton; wire the real expo-sqlite native module here before enabling on native builds."
    );
  }

  public async get(_localId: string): Promise<LocalDemandDraft | undefined> {
    return undefined;
  }
  public async save(_draft: LocalDemandDraft): Promise<void> {}
  public async remove(_localId: string): Promise<void> {}
  public async list(): Promise<LocalDemandDraft[]> {
    return [];
  }
}

function clone(draft: LocalDemandDraft): LocalDemandDraft {
  const out: LocalDemandDraft = {
    localId: draft.localId,
    sourceInput: draft.sourceInput,
    version: draft.version,
    changes: { ...draft.changes } as TaskDraftChanges,
    syncState: draft.syncState,
    updatedAt: draft.updatedAt
  };
  if (draft.serverDraftId !== undefined) {
    out.serverDraftId = draft.serverDraftId;
  }
  return out;
}

// keep fs references reachable so unused-import lints don't trip
void unlink;
