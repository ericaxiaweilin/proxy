import { describe, expect, it } from "vitest";
import { evaluatePublishReadiness, InMemoryDemandDraftStore, type LocalDemandDraft } from "./demand-draft-store";

const draft: LocalDemandDraft = {
  localId: "local_draft_001",
  sourceInput: "Need a greeter",
  version: 1,
  changes: { scenario: "opening" },
  syncState: "LOCAL_ONLY",
  updatedAt: "2026-08-14T00:00:00.000Z"
};

describe("mobile demand draft persistence contract", () => {
  it("restores a locally saved draft without treating it as server success", async () => {
    const store = new InMemoryDemandDraftStore();
    await store.save(draft);
    const restored = await store.get("local_draft_001");
    expect(restored?.sourceInput).toBe("Need a greeter");
    expect(restored?.syncState).toBe("LOCAL_ONLY");
    expect(evaluatePublishReadiness({ online: true, syncState: "LOCAL_ONLY", hasServerDraftId: false })).toEqual({
      allowed: false,
      reason: "SERVER_ACK_REQUIRED"
    });
  });

  it("fails closed for offline, pending, and conflict states", () => {
    expect(evaluatePublishReadiness({ online: false, syncState: "SYNCED", hasServerDraftId: true })).toEqual({
      allowed: false,
      reason: "ONLINE_REQUIRED"
    });
    expect(evaluatePublishReadiness({ online: true, syncState: "PENDING_UPLOAD", hasServerDraftId: true })).toEqual({
      allowed: false,
      reason: "SERVER_ACK_REQUIRED"
    });
    expect(evaluatePublishReadiness({ online: true, syncState: "CONFLICT", hasServerDraftId: true })).toEqual({
      allowed: false,
      reason: "DRAFT_CONFLICT"
    });
    expect(evaluatePublishReadiness({ online: true, syncState: "SYNCED", hasServerDraftId: true })).toEqual({ allowed: true });
  });
});
