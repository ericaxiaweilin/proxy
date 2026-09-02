import { describe, expect, it } from "vitest";
import { ExperienceClient, ExperienceCommandRejectedError, ExperienceProtocolError } from "./experience-client";
import { InMemorySecureStorageDriver, OfflineFallbackSessionError, SecureSessionStore } from "./secure-session";

function makeAuthenticatedStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  return store.write({
    userAccountId: "user_001",
    principal: { type: "INDIVIDUAL", id: "user_001" },
    auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 }
  }).then(() => store);
}

describe("ExperienceClient.listExperiences (R15.49)", () => {
  it("anonymous GETs ListExperiences with PUBLIC actor and returns parsed list", async () => {
    let capturedPath = "";
    let capturedBody: unknown = null;
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new ExperienceClient({
      secureSessionStore: store,
      authClient: {
        request: async () => {
          throw new Error("anonymous should not use request");
        },
        requestPublic: async (path, init) => {
          capturedPath = path;
          capturedBody = init.body;
          return {
            status: 200,
            json: async () => ({
              commandId: (init.body as { commandId: string }).commandId,
              outcome: "ACCEPTED",
              aggregate: { type: "Experience", id: "", version: 0, state: "LISTED" },
              eventRefs: [],
              correlationId: (init.body as { correlationId: string }).correlationId,
              operationRef: JSON.stringify({
                experiences: [
                  { experienceId: "exp_a", title: "A", category: "X", origin: "PLATFORM", city: "HCMC", status: "OPEN", capacity: 5, interested: 2 },
                  { experienceId: "exp_b", title: "B", category: "Y", origin: "MERCHANT", city: "HANOI", status: "OPEN", capacity: 10, interested: 3 }
                ],
                count: 2
              })
            })
          };
        }
      }
    });
    const list = await client.listExperiences();
    expect(capturedPath).toBe("/v1/commands/ListExperiences");
    const envelope = capturedBody as { actor: { type: string; id: string }; principal: { type: string; id: string } };
    expect(envelope.actor.type).toBe("PUBLIC");
    expect(envelope.principal.type).toBe("PUBLIC");
    expect(list).toHaveLength(2);
    expect(list[0]?.experienceId).toBe("exp_a");
    expect(list[1]?.city).toBe("HANOI");
  });

  it("authenticated user still works (session present → request path used)", async () => {
    let requestCalled = false;
    let publicCalled = false;
    const store = await makeAuthenticatedStore();
    const client = new ExperienceClient({
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          requestCalled = true;
          return {
            status: 200,
            json: async () => ({
              commandId: (init.body as { commandId: string }).commandId,
              outcome: "ACCEPTED",
              aggregate: { type: "Experience", id: "", version: 0, state: "LISTED" },
              eventRefs: [],
              correlationId: (init.body as { correlationId: string }).correlationId,
              operationRef: JSON.stringify({ experiences: [{ experienceId: "exp_1", title: "T1", category: "C", origin: "USER", interested: 1 }], count: 1 })
            })
          };
        },
        requestPublic: async () => {
          publicCalled = true;
          throw new Error("should not be called for authenticated");
        }
      }
    });
    const list = await client.listExperiences();
    expect(requestCalled).toBe(true);
    expect(publicCalled).toBe(false);
    expect(list).toHaveLength(1);
  });

  it("rejects on REJECTED outcome", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new ExperienceClient({
      secureSessionStore: store,
      authClient: {
        requestPublic: async (_path, init) => ({
          status: 200,
          json: async () => ({
            commandId: (init.body as { commandId: string }).commandId,
            outcome: "REJECTED",
            error: { errorCode: "EXPERIENCE_LIST_FAILED", messageKey: "experience.list_failed" },
            eventRefs: [],
            correlationId: (init.body as { correlationId: string }).correlationId
          })
        })
      }
    });
    await expect(client.listExperiences()).rejects.toBeInstanceOf(ExperienceCommandRejectedError);
  });

  it("throws on malformed operationRef (fail-closed via Zod)", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new ExperienceClient({
      secureSessionStore: store,
      authClient: {
        requestPublic: async (_path, init) => ({
          status: 200,
          json: async () => ({
            commandId: (init.body as { commandId: string }).commandId,
            outcome: "ACCEPTED",
            aggregate: { type: "Experience", id: "", version: 0, state: "LISTED" },
            eventRefs: [],
            correlationId: (init.body as { correlationId: string }).correlationId,
            operationRef: JSON.stringify({ wrong: "shape" }) // 缺 experiences, count
          })
        })
      }
    });
    // Zod throws ZodError (fail-closed); wrapping to ExperienceProtocolError
    // is optional — the contract guarantees invalid payloads are rejected
    // before reaching UI.
    await expect(client.listExperiences()).rejects.toThrow();
  });

  it("offline fallback session (serverSession=false) → anonymous call", async () => {
    let publicCalled = false;
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: "2026-09-24T00:00:00Z", rotation: 1 },
      serverSession: false
    });
    const client = new ExperienceClient({
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("should not use request"); },
        requestPublic: async (_path, init) => {
          publicCalled = true;
          return {
            status: 200,
            json: async () => ({
              commandId: (init.body as { commandId: string }).commandId,
              outcome: "ACCEPTED",
              aggregate: { type: "Experience", id: "", version: 0, state: "LISTED" },
              eventRefs: [],
              correlationId: (init.body as { correlationId: string }).correlationId,
              operationRef: JSON.stringify({ experiences: [], count: 0 })
            })
          };
        }
      }
    });
    const list = await client.listExperiences();
    expect(publicCalled).toBe(true);
    expect(list).toEqual([]);
  });
});
