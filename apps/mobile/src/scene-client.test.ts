import { describe, expect, it } from "vitest";
import { SceneClient } from "./scene-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import type { AuthenticatedCommandTransport } from "./demand-client";
import type { TransportResponse } from "./auth-client";
import type { StoredSession } from "./secure-session";

function response(status: number, body: unknown): TransportResponse {
  return { status, json: async () => body };
}

async function writeSession(store: SecureSessionStore): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
  const session: StoredSession = {
    userAccountId: "user_001",
    principal: { type: "INDIVIDUAL", id: "user_001" },
    auth: {
      sessionId: "session_001",
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      accessToken: "access_001",
      refreshToken: "refresh_001",
      accessExpiresAt: "2026-08-14T00:15:00.000Z",
      refreshExpiresAt: "2026-09-14T00:00:00.000Z",
      rotation: 1,
    },
  };
  await store.write(session);
  // After write/read the session is preserved; the type assertion below
  // is for the principal-presence guarantee we control in the test fixture.
  return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
}

describe("scene client", () => {
  it("fails closed when no session is stored", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    const sent: unknown[] = [];
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        sent.push(init.body);
        return response(200, { commandId: "x", outcome: "ACCEPTED", aggregate: { type: "Scene", id: "s1", version: 1, state: "DRAFT" }, eventRefs: [], correlationId: "c" });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    await expect(client.createScene("PHOTO", "西湖拍照", "OPEN_SIGNUP", "HOST_SPONSORED", "2026-09-05T16:00:00.000Z")).rejects.toThrow(/principal required/);
    expect(sent).toEqual([]);
  });

  it("buildEnvelope pins the canonical shape (actor/principal/target/idempotency key)", () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    const client = new SceneClient({ authClient: {} as AuthenticatedCommandTransport, secureSessionStore: store, now: () => new Date("2026-08-27T10:00:00.000Z") });
    const session: StoredSession & { principal: NonNullable<StoredSession["principal"]> } = {
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001",
        userAccountId: "user_001",
        principal: { type: "INDIVIDUAL", id: "user_001" },
        accessToken: "a",
        refreshToken: "r",
        accessExpiresAt: "2026-08-14T00:15:00.000Z",
        refreshExpiresAt: "2026-09-14T00:00:00.000Z",
        rotation: 1,
      },
    };
    const env = client.buildEnvelope({
      session,
      commandType: "CreateScene",
      target: { type: "Scene", id: "new" },
      payload: { tool: "PHOTO", intent: "西湖拍照" },
      now: () => new Date("2026-08-27T10:00:00.000Z"),
    });
    expect(env.commandType).toBe("CreateScene");
    expect(env.actor).toEqual({ type: "USER", id: "user_001" });
    expect(env.principal).toEqual({ type: "INDIVIDUAL", id: "user_001" });
    expect(env.target).toEqual({ type: "Scene", id: "new" });
    expect(typeof env.commandId).toBe("string");
    expect(typeof env.idempotencyKey).toBe("string");
    expect(typeof env.correlationId).toBe("string");
    expect((env.commandId as string).startsWith("mobile_scene_cmd_")).toBe(true);
    expect((env.idempotencyKey as string).startsWith("mobile_scene_idem_")).toBe(true);
    expect((env.correlationId as string).startsWith("mobile_scene_corr_")).toBe(true);
    expect(env.expectedAggregateVersion).toBeUndefined();
  });

  it("two envelopes built in the same millisecond never share an id", () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    const client = new SceneClient({ authClient: {} as AuthenticatedCommandTransport, secureSessionStore: store, now: () => new Date("2026-08-27T10:00:00.000Z") });
    const session: StoredSession & { principal: NonNullable<StoredSession["principal"]> } = {
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001",
        userAccountId: "user_001",
        principal: { type: "INDIVIDUAL", id: "user_001" },
        accessToken: "a",
        refreshToken: "r",
        accessExpiresAt: "2026-08-14T00:15:00.000Z",
        refreshExpiresAt: "2026-09-14T00:00:00.000Z",
        rotation: 1,
      },
    };
    const a = client.buildEnvelope({ session, commandType: "CreateScene", target: { type: "Scene", id: "new" }, payload: {}, now: () => new Date("2026-08-27T10:00:00.000Z") });
    const b = client.buildEnvelope({ session, commandType: "CreateInvitation", target: { type: "Scene", id: "s1" }, payload: {}, now: () => new Date("2026-08-27T10:00:00.000Z") });
    // commandId/idempotencyKey/correlationId must all differ between the two.
    expect(a.commandId).not.toBe(b.commandId);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.correlationId).not.toBe(b.correlationId);
  });

  it("createScene sends the right envelope and parses the accepted result", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const bodies: Record<string, unknown>[] = [];
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        bodies.push(init.body as Record<string, unknown>);
        return response(200, { commandId: "1", outcome: "ACCEPTED", aggregate: { type: "Scene", id: "s1", version: 1, state: "DRAFT" }, eventRefs: [], correlationId: "c1" });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store, now: () => new Date("2026-08-27T10:00:00.000Z") });
    const out = await client.createScene("PHOTO", "西湖拍照", "OPEN_SIGNUP", "HOST_SPONSORED", "2026-09-05T16:00:00.000Z");
    expect(out.outcome).toBe("ACCEPTED");
    expect(out.aggregate?.state).toBe("DRAFT");
    expect(bodies[0]?.commandType).toBe("CreateScene");
    expect(bodies[0]?.actor).toEqual({ type: "USER", id: "user_001" });
    expect(bodies[0]?.principal).toEqual({ type: "INDIVIDUAL", id: "user_001" });
    expect(bodies[0]?.target).toEqual({ type: "Scene", id: "new" });
    expect((bodies[0]?.payload as { tool: string }).tool).toBe("PHOTO");
  });

  it("createScene surfaces server rejection with the message key", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const transport: AuthenticatedCommandTransport = {
      request: async () => response(200, {
        commandId: "1", outcome: "REJECTED", eventRefs: [], correlationId: "c",
        error: { errorCode: "SCENE_GUARD_REJECTED", category: "BUSINESS_STATE", retryability: "AFTER_USER_ACTION", messageKey: "scene.guard_rejected", safeDetails: { guard: "HIGH_TRANSACTION_FEELING" }, correlationId: "c" },
      }),
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    await expect(client.createScene("PHOTO", "x", "OPEN_SIGNUP", "HOST_PAY", "2026-09-05T16:00:00.000Z")).rejects.toThrow(/scene\.guard_rejected/);
  });

  it("respondInvitation sends the decision and parses the accepted result", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const bodies: Record<string, unknown>[] = [];
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        bodies.push(init.body as Record<string, unknown>);
        return response(200, { commandId: "1", outcome: "ACCEPTED", aggregate: { type: "Invitation", id: "inv_001", version: 2, state: "ACCEPTED" }, eventRefs: [], correlationId: "c1" });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    const out = await client.respondInvitation("inv_001", "ACCEPTED");
    expect(out.outcome).toBe("ACCEPTED");
    expect(out.aggregate?.state).toBe("ACCEPTED");
    expect(bodies[0]?.commandType).toBe("RespondInvitation");
    expect(bodies[0]?.target).toEqual({ type: "Invitation", id: "inv_001" });
    expect((bodies[0]?.payload as { decision: string }).decision).toBe("ACCEPTED");
  });

  // ── R15.13 P2: Memory domain tripwires ──────────────────────

  it("listMyMemories sends ListMyMemories and parses the OperationRef list", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const bodies: Record<string, unknown>[] = [];
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        bodies.push(init.body as Record<string, unknown>);
        return response(200, {
          commandId: "1", outcome: "ACCEPTED", aggregate: { type: "MyMemories", id: "user_001", version: 1, state: "LISTED" },
          eventRefs: [],
          operationRef: JSON.stringify({
            actorId: "user_001",
            limit: 10,
            memories: [
              { memoryId: "mem_a", sceneId: "s1", sceneType: "ROOFTOP_PHOTO", actualSpend: 50000, currency: "VND", durationMin: 90, rating: 0.78, createdAt: "2026-08-27T10:00:00.000Z", role: "HOST" },
              { memoryId: "mem_b", sceneId: "s2", sceneType: "BRUNCH", actualSpend: 200000, currency: "VND", durationMin: 120, rating: 0.91, createdAt: "2026-08-26T10:00:00.000Z", role: "GUEST" },
            ],
          }),
          correlationId: "c1",
        });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    const memories = await client.listMyMemories();
    expect(memories).toHaveLength(2);
    expect(memories[0]?.role).toBe("HOST");
    expect(memories[1]?.role).toBe("GUEST");
    expect(bodies[0]?.commandType).toBe("ListMyMemories");
    expect(bodies[0]?.target).toEqual({ type: "MyMemories", id: "unused" });
  });

  it("listMyMemories with limit overrides the payload limit field", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    let captured: Record<string, unknown> | undefined;
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        captured = init.body as Record<string, unknown>;
        return response(200, { commandId: "1", outcome: "ACCEPTED", aggregate: { type: "MyMemories", id: "x", version: 1, state: "LISTED" }, eventRefs: [], operationRef: "{\"actorId\":\"x\",\"limit\":3,\"memories\":[]}", correlationId: "c1" });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    await client.listMyMemories(3);
    expect((captured?.payload as { limit: number }).limit).toBe(3);
  });

  it("getMemory parses OperationRef and infers HOST role for the host", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        expect((init.body as Record<string, unknown>).commandType).toBe("GetMemory");
        return response(200, {
          commandId: "1", outcome: "ACCEPTED", aggregate: { type: "Memory", id: "scene_001", version: 1, state: "READ" },
          eventRefs: [],
          operationRef: JSON.stringify({
            memoryId: "mem_x", sceneId: "scene_001", hostId: "user_001", guestId: "guest_x",
            sceneType: "BRUNCH", fundingMode: "SPLIT", plannedBudget: 60000, actualSpend: 55000,
            currency: "VND", durationMin: 90, rating: 0.81, notes: "good", createdAt: "2026-08-27T10:00:00.000Z",
          }),
          correlationId: "c1",
        });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    const mem = await client.getMemory("scene_001");
    expect(mem.role).toBe("HOST");
    expect(mem.actualSpend).toBe(55000);
    expect(mem.plannedBudget).toBe(60000);
  });

  it("getMemory infers GUEST role when the viewer is the guest", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    // Use a different viewer.
    const session: StoredSession = {
      userAccountId: "guest_viewer",
      principal: { type: "INDIVIDUAL", id: "guest_viewer" },
      auth: {
        sessionId: "session_001", userAccountId: "guest_viewer",
        principal: { type: "INDIVIDUAL", id: "guest_viewer" },
        accessToken: "a", refreshToken: "r",
        accessExpiresAt: "2026-08-14T00:15:00.000Z", refreshExpiresAt: "2026-09-14T00:00:00.000Z",
        rotation: 1,
      },
    };
    await store.write(session);
    const transport: AuthenticatedCommandTransport = {
      request: async () => response(200, {
        commandId: "1", outcome: "ACCEPTED", aggregate: { type: "Memory", id: "scene_001", version: 1, state: "READ" },
        eventRefs: [],
        operationRef: JSON.stringify({
          memoryId: "mem_x", sceneId: "scene_001", hostId: "host_user", guestId: "guest_viewer",
          sceneType: "BRUNCH", fundingMode: "SPLIT", plannedBudget: 60000, actualSpend: 55000,
          currency: "VND", durationMin: 90, rating: 0.81, createdAt: "2026-08-27T10:00:00.000Z",
        }),
        correlationId: "c1",
      }),
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    const mem = await client.getMemory("scene_001");
    expect(mem.role).toBe("GUEST");
  });

  it("recordOutcome sends RecordOutcome with guestId/actualSpend/duration/notes", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    let captured: Record<string, unknown> | undefined;
    const transport: AuthenticatedCommandTransport = {
      request: async (_path, init) => {
        captured = init.body as Record<string, unknown>;
        return response(200, {
          commandId: "1", outcome: "ACCEPTED", aggregate: { type: "Memory", id: "scene_001", version: 1, state: "RECORDED" },
          eventRefs: [],
          operationRef: JSON.stringify({
            memoryId: "mem_z", sceneId: "scene_001", hostId: "user_001", guestId: "guest_u",
            sceneType: "PHOTO", fundingMode: "HOST", plannedBudget: 0, actualSpend: 40000,
            currency: "VND", durationMin: 60, rating: 0.5, createdAt: "2026-08-27T10:00:00.000Z",
          }),
          correlationId: "c1",
        });
      },
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    const mem = await client.recordOutcome("scene_001", {
      guestId: "guest_u", actualSpend: 40000, durationMin: 60, notes: "loved it",
    });
    expect(captured?.commandType).toBe("RecordOutcome");
    expect(captured?.target).toEqual({ type: "Outcome", id: "scene_001" });
    const payload = captured?.payload as { guestId: string; actualSpend: number; durationMin: number; notes: string };
    expect(payload.guestId).toBe("guest_u");
    expect(payload.actualSpend).toBe(40000);
    expect(payload.durationMin).toBe(60);
    expect(payload.notes).toBe("loved it");
    expect(mem.role).toBe("HOST");
  });

  it("listMyMemories surfaces server rejection with the result attached", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date());
    await writeSession(store);
    const transport: AuthenticatedCommandTransport = {
      request: async () => response(200, {
        commandId: "1", outcome: "REJECTED", eventRefs: [],
        error: { errorCode: "INVALID_ACCESS_TOKEN", category: "AUTHENTICATION", retryability: "AFTER_REAUTH", messageKey: "command.invalid_access_token", safeDetails: {}, correlationId: "c1" },
        correlationId: "c1",
      }),
    };
    const client = new SceneClient({ authClient: transport, secureSessionStore: store });
    await expect(client.listMyMemories()).rejects.toThrow(/invalid_access_token/);
  });
});
