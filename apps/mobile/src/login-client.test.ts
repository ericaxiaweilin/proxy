import { describe, expect, it } from "vitest";
import { LoginClient, LoginCommandRejectedError, LoginProtocolError, type TransportRequest, type TransportResponse } from "./login-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

function response(status: number, body: unknown): TransportResponse {
  return { status, json: async () => body };
}

const auth = {
  sessionId: "session_001",
	userAccountId: "user_001",
	principal: { type: "INDIVIDUAL" as const, id: "user_001" },
  accessToken: "access_secret",
  refreshToken: "refresh_secret",
  accessExpiresAt: "2026-08-14T00:15:00.000Z",
  refreshExpiresAt: "2026-09-13T00:00:00.000Z",
  rotation: 1
};

describe("mobile login challenge client", () => {
  it("runs challenge, verification, and first-session bootstrap without sending bearer credentials", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const requests: TransportRequest[] = [];
    let step = 0;
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_001",
      secureSessionStore: store,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      transport: async (request) => {
        requests.push(request);
        step += 1;
        if (step === 1) return response(202, { commandId: "cmd_1", outcome: "PENDING", operationRef: "challenge_001", eventRefs: [], correlationId: "corr_1" });
        if (step === 2) return response(200, { commandId: "cmd_2", outcome: "ACCEPTED", aggregate: { type: "LoginChallenge", id: "challenge_001", version: 2, state: "VERIFIED" }, eventRefs: ["evt_2"], correlationId: "corr_2" });
        return response(200, { commandId: "cmd_3", outcome: "ACCEPTED", aggregate: { type: "Session", id: "session_001", version: 1, state: "ACTIVE" }, auth, eventRefs: ["evt_3"], correlationId: "corr_3" });
      }
    });

    const requested = await client.requestChallenge({ loginIdentityId: "login_001", channel: "EMAIL" });
    expect(requested.challengeId).toBe("challenge_001");
    await client.verifyChallenge(requested.challengeId, "123456");
    const session = await client.createSession({
      userAccountId: "user_001",
      loginIdentityId: "login_001",
      challengeId: requested.challengeId,
      requestedPrincipal: { type: "INDIVIDUAL", id: "user_001" }
    });

		expect(session.auth.sessionId).toBe("session_001");
		expect(session.userAccountId).toBe("user_001");
    expect((await store.read())?.principal).toEqual({ type: "INDIVIDUAL", id: "user_001" });
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.url).toContain("/v1/commands/");
    }
    const firstEnvelope = JSON.parse(requests[0]?.body ?? "{}");
    expect(firstEnvelope.payload).toEqual({ loginIdentityId: "login_001", deviceId: "device_001", channel: "EMAIL" });
    expect(firstEnvelope.purpose).toBe("passwordless_login");
  });

  it("exposes only the server rejection and never writes a session", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_001",
      secureSessionStore: store,
      transport: async () => response(409, {
        commandId: "cmd_1",
        outcome: "REJECTED",
        eventRefs: [],
        correlationId: "corr_1",
        error: {
          errorCode: "LOGIN_PROVIDER_NOT_CONFIGURED",
          category: "PROVIDER",
          retryability: "SAFE_RETRY",
          messageKey: "identity.login_provider_not_configured",
          safeDetails: {},
          correlationId: "corr_1"
        }
      })
    });

    await expect(client.requestChallenge({ loginIdentityId: "login_001", channel: "SMS" })).rejects.toMatchObject({
      name: "LoginCommandRejectedError",
      result: { error: { errorCode: "LOGIN_PROVIDER_NOT_CONFIGURED" } }
    });
    expect(await store.read()).toBeUndefined();
  });

  it("fails closed when the session result has malformed tokens", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_001",
      secureSessionStore: store,
      transport: async () => response(200, { commandId: "cmd_1", outcome: "ACCEPTED", auth: { accessToken: "not-enough" }, eventRefs: [], correlationId: "corr_1" })
    });

    await expect(client.createSession({
      userAccountId: "user_001",
      loginIdentityId: "login_001",
      challengeId: "challenge_001",
      requestedPrincipal: { type: "INDIVIDUAL", id: "user_001" }
    })).rejects.toBeInstanceOf(LoginProtocolError);
    expect(await store.read()).toBeUndefined();
  });
});
