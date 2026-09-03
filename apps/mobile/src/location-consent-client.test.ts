import { describe, expect, it } from "vitest";
import type { Transport, TransportRequest, TransportResponse } from "./auth-client";
import {
  ALLOWED_DURATION_SECONDS,
  type LocationConsent,
  LocationConsentClient,
  LocationConsentError,
  formatRemaining,
  isActiveConsent,
  resolveLocationConsentClient,
} from "./location-consent-client";

interface StubResponse extends TransportResponse {
  status: number;
  body: any;
}

function makeStub(responses: Array<{
  match: (req: TransportRequest) => boolean;
  response: StubResponse;
}>): Transport {
  return async (req: TransportRequest): Promise<TransportResponse> => {
    for (const r of responses) {
      if (r.match(req)) return r.response;
    }
    throw new Error(`no stub for ${req.method} ${req.url}`);
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
      baseUrl: "https://api.example/v1",
      transport: makeStub([]),
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
        match: (req) =>
          req.method === "GET" &&
          req.url === "https://api.example/v1/location/consent",
        response: okResponse(consent),
      },
    ]);
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const got = await client.getStatus();
    expect(got).toEqual(consent);
  });

  it("grant() POSTs to /grant with the duration in the body", async () => {
    const captured: TransportRequest[] = [];
    const consent: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T10:30:00Z",
      remainingSeconds: 1800,
      durationSeconds: 1800,
    };
    const transport: Transport = async (req) => {
      captured.push(req);
      return okResponse(consent);
    };
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const got = await client.grant(1800);
    expect(captured).toEqual([
      {
        method: "POST",
        url: "https://api.example/v1/location/consent/grant",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ durationSeconds: 1800 }),
      },
    ]);
    expect(got.durationSeconds).toBe(1800);
  });

  it("revoke() POSTs to /revoke with no body", async () => {
    let captured: TransportRequest | undefined;
    const transport: Transport = async (req) => {
      captured = req;
      return okResponse({ kind: "PRECISE_GPS", status: "REVOKED", wasActive: true });
    };
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const result = await client.revoke();
    expect(captured?.url).toBe("https://api.example/v1/location/consent/revoke");
    expect(captured?.method).toBe("POST");
    expect(captured?.body).toBeUndefined();
    expect(result.wasActive).toBe(true);
  });

  it("history() GETs /consent/history and returns the rows array", async () => {
    const transport = makeStub([
      {
        match: (req) =>
          req.method === "GET" &&
          req.url === "https://api.example/v1/location/consent/history",
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
      baseUrl: "https://api.example/v1",
      transport,
    });
    const got = await client.history();
    expect(got.rows).toHaveLength(1);
    expect(got.rows[0]?.durationSeconds).toBe(28800);
  });

  it("trims trailing slashes from baseUrl", async () => {
    const transport = makeStub([
      {
        match: (req) =>
          req.method === "GET" &&
          req.url === "https://api.example/v1/location/consent",
        response: okResponse({ kind: "PRECISE_GPS", status: "NONE", remainingSeconds: 0, durationSeconds: 0 }),
      },
    ]);
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1////",
      transport,
    });
    const got = await client.getStatus();
    expect(got.status).toBe("NONE");
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
      baseUrl: "https://api.example/v1",
      transport,
    });
    await expect(client.grant(1800)).rejects.toMatchObject({
      code: "INVALID_LOCATION_CONSENT_DURATION",
      httpStatus: 400,
    });
  });

  it("resolveLocationConsentClient builds a usable client", async () => {
    const transport: Transport = async (req) => {
      expect(req.url).toBe("https://api.example/v1/location/consent");
      return okResponse({ kind: "PRECISE_GPS", status: "NONE", remainingSeconds: 0, durationSeconds: 0 });
    };
    const client = resolveLocationConsentClient({ baseUrl: "https://api.example/v1", transport });
    const got = await client.getStatus();
    expect(got.status).toBe("NONE");
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
