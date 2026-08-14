import type { TaskDraftChanges } from "@proxy/contracts";

export type LocalDraftSyncState = "LOCAL_ONLY" | "PENDING_UPLOAD" | "SYNCED" | "CONFLICT";

export type LocalDemandDraft = {
  localId: string;
  serverDraftId?: string;
  sourceInput: string;
  version: number;
  changes: TaskDraftChanges;
  syncState: LocalDraftSyncState;
  updatedAt: string;
};

export interface DemandDraftStore {
  get(localId: string): Promise<LocalDemandDraft | undefined>;
  save(draft: LocalDemandDraft): Promise<void>;
  remove(localId: string): Promise<void>;
  list(): Promise<LocalDemandDraft[]>;
}

/**
 * Test adapter for the App contract. Replace this with SQLite on native builds;
 * do not use it as the production persistence layer.
 */
export class InMemoryDemandDraftStore implements DemandDraftStore {
  private readonly drafts = new Map<string, LocalDemandDraft>();

  public async get(localId: string): Promise<LocalDemandDraft | undefined> {
    const draft = this.drafts.get(localId);
    return draft ? this.clone(draft) : undefined;
  }

  public async save(draft: LocalDemandDraft): Promise<void> {
    this.drafts.set(draft.localId, this.clone(draft));
  }

  public async remove(localId: string): Promise<void> {
    this.drafts.delete(localId);
  }

  public async list(): Promise<LocalDemandDraft[]> {
    return [...this.drafts.values()].map((draft) => this.clone(draft));
  }

  private clone(draft: LocalDemandDraft): LocalDemandDraft {
    return { ...draft, changes: { ...draft.changes } };
  }
}

export type PublishReadiness =
  | { allowed: true }
  | { allowed: false; reason: "ONLINE_REQUIRED" | "SERVER_ACK_REQUIRED" | "DRAFT_CONFLICT" };

export function evaluatePublishReadiness(input: {
  online: boolean;
  syncState: LocalDraftSyncState;
  hasServerDraftId: boolean;
}): PublishReadiness {
  if (!input.online) return { allowed: false, reason: "ONLINE_REQUIRED" };
  if (input.syncState === "CONFLICT") return { allowed: false, reason: "DRAFT_CONFLICT" };
  if (!input.hasServerDraftId || input.syncState !== "SYNCED") return { allowed: false, reason: "SERVER_ACK_REQUIRED" };
  return { allowed: true };
}
