import { describe, expect, it } from "vitest";
import { DemandClient, DemandCommandRejectedError, type AuthenticatedCommandTransport } from "./demand-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import type { TransportResponse } from "./auth-client";

function response(status: number, body: unknown): TransportResponse {
  return { status, json: async () => body };
}

describe("requester demand client", () => {
  it("uses the secure session identity and carries aggregate versions", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001",
        accessToken: "access_001",
        refreshToken: "refresh_001",
        accessExpiresAt: "2026-08-14T00:15:00.000Z",
        refreshExpiresAt: "2026-09-14T00:00:00.000Z",
        rotation: 1
      }
    });
    const bodies: Record<string, unknown>[] = [];
    const responses = [
      response(200, { commandId: "1", outcome: "ACCEPTED", aggregate: { type: "TaskDraft", id: "draft_001", version: 1, state: "DRAFT" }, eventRefs: [], correlationId: "c1" }),
      response(200, { commandId: "2", outcome: "ACCEPTED", aggregate: { type: "TaskDraft", id: "draft_001", version: 2, state: "DRAFT" }, eventRefs: [], correlationId: "c2" }),
      response(200, { commandId: "3", outcome: "ACCEPTED", aggregate: { type: "DemandPreview", id: "draft_001", version: 2, state: "READY" }, eventRefs: [], correlationId: "c3" })
    ];
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        bodies.push(init.body as Record<string, unknown>);
        return responses.shift()!;
      }
    };
    const client = new DemandClient({ authClient: transport, secureSessionStore: store, now: () => new Date("2026-08-14T00:00:00.000Z") });
    const created = await client.createDraft("Need two greeters");
    await client.updateDraft(created.aggregate!.id, created.aggregate!.version, { scenario: "opening" });
    await client.previewDraft("draft_001", 2);

    expect(bodies[0]?.actor).toEqual({ type: "USER", id: "user_001" });
    expect(bodies[0]?.principal).toEqual({ type: "INDIVIDUAL", id: "user_001" });
    expect(bodies[1]?.expectedAggregateVersion).toBe(1);
    expect(bodies[2]?.payload).toEqual({ expectedVersion: 2 });
  });

  it("surfaces canonical server rejections", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-08-14T00:00:00.000Z"));
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001", accessToken: "access", refreshToken: "refresh",
        accessExpiresAt: "2026-08-14T00:15:00.000Z", refreshExpiresAt: "2026-09-14T00:00:00.000Z", rotation: 1
      }
    });
    const client = new DemandClient({
      secureSessionStore: store,
      authClient: {
        request: async () => response(409, {
          commandId: "1", outcome: "REJECTED", eventRefs: [], correlationId: "c1",
          error: { errorCode: "TASK_DRAFT_VERSION_CONFLICT", category: "CONCURRENCY", retryability: "SAFE_RETRY", messageKey: "demand.draft_version_conflict", safeDetails: {}, correlationId: "c1" }
        })
      }
    });
    await expect(client.previewDraft("draft_001", 2)).rejects.toBeInstanceOf(DemandCommandRejectedError);
  });
});
