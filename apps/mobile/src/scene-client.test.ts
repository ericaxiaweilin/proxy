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
});
