import { describe, expect, it } from "vitest";
import type { TransportResponse } from "./auth-client";
import {
  ALLOWED_DURATION_SECONDS,
  type LocationConsent,
  LocationConsentClient,
  LocationConsentError,
  formatRemaining,
  isActiveConsent,
  resolveLocationConsentClient,
} from "./location-consent-client";

type AuthCall = { path: string; init: { method: "POST" | "GET"; body?: unknown } };

interface StubResponse extends TransportResponse {
  status: number;
  body: any;
}

function makeStub(responses: Array<{
  match: (call: AuthCall) => boolean;
  response: StubResponse;
}>): { request(path: string, init: { method: "POST" | "GET"; body?: unknown }): Promise<TransportResponse>; calls: AuthCall[] } {
  const calls: AuthCall[] = [];
  return {
    calls,
    request: async (path, init) => {
      calls.push({ path, init });
      for (const r of responses) {
        if (r.match({ path, init })) return r.response;
      }
      throw new Error(`no stub for ${init.method} ${path}`);
    },
  };
}

function okResponse(body: any, status = 200): StubResponse {
  return {
    status,
    body,
    json: async () => body,
  };
}

function errorResponse(body: any, status: number): StubResponse {
  return {
    status,
    body,
    json: async () => body,
  };
}

describe("LocationConsentClient", () => {
  it("exposes exactly two allowed durations", () => {
    expect(ALLOWED_DURATION_SECONDS).toEqual([30 * 60, 8 * 60 * 60]);
  });

  it("rejects grant() with a duration outside the allowed set", async () => {
    const client = new LocationConsentClient({
      authClient: makeStub([]),
    });
    await expect(client.grant(60)).rejects.toBeInstanceOf(LocationConsentError);
    await expect(client.grant(99999)).rejects.toMatchObject({
      code: "INVALID_DURATION",
    });
  });

  it("getStatus() returns the consent object the server sent", async () => {
    const consent: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T18:00:00Z",
      remainingSeconds: 28790,
      durationSeconds: 28800,
    };
    const transport = makeStub([
      {
        match: (call) =>
          call.init.method === "GET" &&
          call.path === "/v1/location/consent",
        response: okResponse(consent),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: transport,
    });
    const got = await client.getStatus();
    expect(got).toEqual(consent);
  });

  it("grant() POSTs to /grant with the duration in the body", async () => {
    const consent: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T10:30:00Z",
      remainingSeconds: 1800,
      durationSeconds: 1800,
    };
    const stub = makeStub([
      {
        match: (call) =>
          call.init.method === "POST" &&
          call.path === "/v1/location/consent/grant",
        response: okResponse(consent),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: stub,
    });
    const got = await client.grant(1800);
    expect(stub.calls).toEqual([
      {
        path: "/v1/location/consent/grant",
        init: { method: "POST", body: { durationSeconds: 1800 } },
      },
    ]);
    expect(got.durationSeconds).toBe(1800);
  });

  it("revoke() POSTs to /revoke with no body", async () => {
    const stub = makeStub([
      {
        match: () => true,
        response: okResponse({ kind: "PRECISE_GPS", status: "REVOKED", wasActive: true }),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: stub,
    });
    const result = await client.revoke();
    expect(stub.calls[0]?.path).toBe("/v1/location/consent/revoke");
    expect(stub.calls[0]?.init.method).toBe("POST");
    expect(stub.calls[0]?.init.body).toBeUndefined();
    expect(result.wasActive).toBe(true);
  });

  it("history() GETs /consent/history and returns the rows array", async () => {
    const transport = makeStub([
      {
        match: (call) =>
          call.init.method === "GET" &&
          call.path === "/v1/location/consent/history",
        response: okResponse({
          rows: [
            {
              kind: "PRECISE_GPS",
              status: "GRANTED",
              grantedAt: "2026-09-04T10:00:00Z",
              expiresAt: "2026-09-04T18:00:00Z",
              remainingSeconds: 28790,
              durationSeconds: 28800,
            },
          ],
        }),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: transport,
    });
    const got = await client.history();
    expect(got.rows).toHaveLength(1);
    expect(got.rows[0]?.durationSeconds).toBe(28800);
  });

  it("calls the /v1-prefixed path the server mux expects", async () => {
    // LOCATION-CONSENT-PATH-001: the old client built `${baseUrl}/location/…`
    // (no /v1) while the server only serves /v1/location/… — every call 404'd
    // on device. Paths are now literals, not baseUrl arithmetic.
    const stub = makeStub([
      {
        match: (call) =>
          call.init.method === "GET" &&
          call.path === "/v1/location/consent",
        response: okResponse({ kind: "PRECISE_GPS", status: "NONE", remainingSeconds: 0, durationSeconds: 0 }),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: stub,
    });
    const got = await client.getStatus();
    expect(got.status).toBe("NONE");
    expect(stub.calls[0]?.path).toBe("/v1/location/consent");
  });

  it("wraps a 4xx response in LocationConsentError with the server code", async () => {
    const transport = makeStub([
      {
        match: () => true,
        response: errorResponse(
          { errorCode: "INVALID_LOCATION_CONSENT_DURATION", message: "bad duration" },
          400,
        ),
      },
    ]);
    const client = new LocationConsentClient({
      authClient: transport,
    });
    await expect(client.grant(1800)).rejects.toMatchObject({
      code: "INVALID_LOCATION_CONSENT_DURATION",
      httpStatus: 400,
    });
  });

  it("resolveLocationConsentClient routes through the injected authClient", async () => {
    // LOCATION-CONSENT-AUTH-001: same disease as PRIVACY-AUTH-001 — the
    // endpoints need a Bearer token, so the client must go through the
    // authenticated SessionAuthClient, never a raw fetch.
    const stub = makeStub([
      {
        match: () => true,
        response: okResponse({ kind: "PRECISE_GPS", status: "NONE", remainingSeconds: 0, durationSeconds: 0 }),
      },
    ]);
    const client = resolveLocationConsentClient({ authClient: stub });
    const got = await client.getStatus();
    expect(got.status).toBe("NONE");
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.path).toBe("/v1/location/consent");
  });
});

describe("isActiveConsent", () => {
  it("returns true for a GRANTED row with a future expiresAt", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      expiresAt: future,
      remainingSeconds: 60,
      durationSeconds: 1800,
    };
    expect(isActiveConsent(c)).toBe(true);
  });

  it("returns false for an EXPIRED status", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 1).toISOString(),
      remainingSeconds: 0,
      durationSeconds: 1800,
    };
    expect(isActiveConsent(c)).toBe(false);
  });

  it("returns false for a missing expiresAt", () => {
    const c: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      remainingSeconds: 60,
      durationSeconds: 1800,
    };
    expect(isActiveConsent(c)).toBe(false);
  });

  it("returns false for null / undefined", () => {
    expect(isActiveConsent(null)).toBe(false);
    expect(isActiveConsent(undefined)).toBe(false);
  });
});

describe("formatRemaining", () => {
  it("renders seconds in vi", () => {
    expect(formatRemaining(45, "vi")).toBe("còn 45 giây");
  });
  it("renders minutes in vi", () => {
    expect(formatRemaining(900, "vi")).toBe("còn 15 phút");
  });
  it("renders hours in vi", () => {
    expect(formatRemaining(7200, "vi")).toBe("còn 2 giờ");
  });
  it("renders expired in vi", () => {
    expect(formatRemaining(0, "vi")).toBe("đã hết hạn");
  });
  it("renders minutes in zh", () => {
    expect(formatRemaining(900, "zh")).toBe("剩余 15 分钟");
  });
  it("renders hours in zh", () => {
    expect(formatRemaining(28800, "zh")).toBe("剩余 8 小时");
  });
});
