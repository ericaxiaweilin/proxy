import { describe, expect, it } from "vitest";
import { LoginClient, LoginCommandRejectedError, LoginProtocolError, type TransportRequest, type TransportResponse } from "./login-client";
import type { Transport } from "./auth-client";
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
      deviceCredential: "a".repeat(64),
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
      deviceCredential: "a".repeat(64),
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
      deviceCredential: "a".repeat(64),
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

  it("resumes a remembered account only through the server trusted-device command", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = new SecureSessionStore(driver, () => new Date("2026-08-14T00:00:00.000Z"));
    let sent: TransportRequest | undefined;
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_001",
      deviceCredential: "a".repeat(64),
      secureSessionStore: store,
      transport: async (request) => {
        sent = request;
        return response(200, { commandId: "cmd_resume", outcome: "ACCEPTED", aggregate: { type: "Session", id: "session_001", version: 1, state: "ACTIVE" }, auth, eventRefs: [], correlationId: "corr_resume" });
      }
    });
    const session = await client.resumeTrustedDeviceSession();
    const envelope = JSON.parse(sent?.body ?? "{}");
    expect(envelope.commandType).toBe("ResumeTrustedDeviceSession");
    expect(envelope.payload).toEqual({ deviceId: "device_001", deviceCredential: "a".repeat(64) });
    expect(session.userAccountId).toBe("user_001");
  });
});

// R16.7-P0-A/B: signup consent + age gate guards. Client must refuse to
// even POST a CreateAnonymousSession if either Terms / Privacy consent
// is missing or if the supplied date of birth implies age < 18. Server
// will double-check (fail-closed defense in depth).
describe("mobile login client signup consent + age gate (R16.7-P0-A/B)", () => {
  function freshClient(now: () => Date = () => new Date("2026-09-03T00:00:00.000Z")): LoginClient {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), now);
    let transport: Transport = async () => response(200, { commandId: "cmd_anon", outcome: "ACCEPTED", aggregate: { type: "Session", id: "session_001", version: 1, state: "ACTIVE" }, auth, eventRefs: [], correlationId: "corr_anon" });
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_anon_001",
      deviceCredential: "a".repeat(64),
      secureSessionStore: store,
      now,
      transport
    });
    return client;
  }

  it("rejects when terms or privacy consent is missing", async () => {
    const client = freshClient();
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "1990-01-01", consents: { terms: false, privacy: true } })).rejects.toBeInstanceOf(LoginProtocolError);
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "1990-01-01", consents: { terms: true, privacy: false } })).rejects.toBeInstanceOf(LoginProtocolError);
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "1990-01-01", consents: { terms: false, privacy: false } })).rejects.toBeInstanceOf(LoginProtocolError);
    await expect(client.createAnonymousSession("IOS")).rejects.toBeInstanceOf(LoginProtocolError);
  });

  it("rejects when date of birth is malformed or under 18", async () => {
    const client = freshClient(() => new Date("2026-09-03T00:00:00.000Z"));
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "not-a-date", consents: { terms: true, privacy: true } })).rejects.toBeInstanceOf(LoginProtocolError);
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "2026-12-31", consents: { terms: true, privacy: true } })).rejects.toBeInstanceOf(LoginProtocolError); // future
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: "2010-01-01", consents: { terms: true, privacy: true } })).rejects.toBeInstanceOf(LoginProtocolError); // 16y
    // 17y 364d: just under 18
    const justUnder18 = new Date("2026-09-03T00:00:00.000Z");
    justUnder18.setUTCFullYear(justUnder18.getUTCFullYear() - 18);
    justUnder18.setUTCDate(justUnder18.getUTCDate() + 1);
    const dob17 = justUnder18.toISOString().slice(0, 10);
    await expect(client.createAnonymousSession("IOS", { dateOfBirth: dob17, consents: { terms: true, privacy: true } })).rejects.toBeInstanceOf(LoginProtocolError);
  });

  it("accepts and forwards payload when consents + 18+ DOB are present", async () => {
    let sent: TransportRequest | undefined;
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-03T00:00:00.000Z"));
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_anon_ok",
      deviceCredential: "a".repeat(64),
      secureSessionStore: store,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
      transport: async (request) => {
        sent = request;
        return response(200, { commandId: "cmd_anon_ok", outcome: "ACCEPTED", aggregate: { type: "Session", id: "session_001", version: 1, state: "ACTIVE" }, auth, eventRefs: [], correlationId: "corr_anon_ok" });
      }
    });
    await client.createAnonymousSession("ANDROID", { dateOfBirth: "1990-01-01", consents: { terms: true, privacy: true }, legalDocVersion: "1.1" });
    const envelope = JSON.parse(sent?.body ?? "{}");
    expect(envelope.payload).toEqual({
      deviceId: "device_anon_ok",
      platform: "ANDROID",
      deviceCredential: "a".repeat(64),
      dateOfBirth: "1990-01-01",
      consents: { terms: true, privacy: true },
      legalDocVersion: "1.1"
    });
  });
});

describe("AUTH-LOGIN-HINT-001 login existence probe", () => {
  function lookupClient(reply: unknown): { client: LoginClient; sent: () => TransportRequest | undefined } {
    let sent: TransportRequest | undefined;
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-10T00:00:00.000Z"));
    const client = new LoginClient({
      baseUrl: "https://api.proxy.test",
      deviceId: "device_lookup",
      deviceCredential: "a".repeat(64),
      secureSessionStore: store,
      now: () => new Date("2026-09-10T00:00:00.000Z"),
      transport: async (request) => {
        sent = request;
        return response(200, reply);
      }
    });
    return { client, sent: () => sent };
  }

  it("maps ACCEPTED to registered without sending credentials", async () => {
    const { client, sent } = lookupClient({ commandId: "cmd_lookup", outcome: "ACCEPTED", aggregate: { type: "LoginIdentity", id: "login_1", version: 1, state: "ACTIVE" }, eventRefs: [], correlationId: "corr_lookup" });
    await expect(client.lookupPasswordlessIdentity({ channel: "EMAIL", identifier: "a@example.com" })).resolves.toEqual({ registered: true });
    const envelope = JSON.parse(sent()?.body ?? "{}");
    expect(envelope.payload).toEqual({ channel: "EMAIL", identifier: "a@example.com" });
  });

  it("maps LOGIN_IDENTITY_NOT_FOUND to unregistered", async () => {
    const { client } = lookupClient({
      commandId: "cmd_lookup", outcome: "REJECTED", eventRefs: [], correlationId: "corr_lookup",
      error: { errorCode: "LOGIN_IDENTITY_NOT_FOUND", category: "AUTHENTICATION", retryability: "AFTER_USER_ACTION", messageKey: "identity.login_identity_not_found", safeDetails: {}, correlationId: "corr_lookup" }
    });
    await expect(client.lookupPasswordlessIdentity({ channel: "EMAIL", identifier: "nobody@example.com" })).resolves.toEqual({ registered: false });
  });

  it("rethrows unexpected failures so the caller can fall back to the challenge path", async () => {
    const { client } = lookupClient({
      commandId: "cmd_lookup", outcome: "REJECTED", eventRefs: [], correlationId: "corr_lookup",
      error: { errorCode: "RATE_LIMITED", category: "RESOURCE", retryability: "SAFE_RETRY", messageKey: "command.rate_limited", safeDetails: {}, correlationId: "corr_lookup" }
    });
    await expect(client.lookupPasswordlessIdentity({ channel: "EMAIL", identifier: "a@example.com" })).rejects.toBeInstanceOf(LoginCommandRejectedError);
  });
});
