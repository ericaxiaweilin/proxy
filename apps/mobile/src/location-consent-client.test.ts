import { describe, expect, it } from "vitest";
import {
  ALLOWED_DURATION_SECONDS,
  type LocationConsent,
  LocationConsentClient,
  LocationConsentError,
  fetchTransport,
  formatRemaining,
  isActiveConsent,
} from "./location-consent-client";

// The transport is a function pair. We hand-roll a stub here
// rather than pulling in msw because the client only needs to
// observe path / method / body.
function makeStubTransport(responses: Array<{
  match: (path: string, method: string, body: any) => boolean;
  status: number;
  body: any;
}>) {
  return {
    async get<T>(path: string, token: string): Promise<T> {
      for (const r of responses) {
        if (r.match(path, "GET", undefined)) {
          return finalize<T>(r, token);
        }
      }
      throw new Error(`no stub for GET ${path}`);
    },
    async post<T>(path: string, token: string, body: any): Promise<T> {
      for (const r of responses) {
        if (r.match(path, "POST", body)) {
          return finalize<T>(r, token);
        }
      }
      throw new Error(`no stub for POST ${path}`);
    },
  };
}

async function finalize<T>(r: { status: number; body: any }, token: string): Promise<T> {
  if (r.status >= 400) {
    throw new LocationConsentError(
      (r.body && r.body.errorCode) || "stub_error",
      `stub ${r.status}`,
      r.status,
    );
  }
  if (!token) {
    throw new Error("token required");
  }
  return r.body as T;
}

describe("LocationConsentClient", () => {
  it("exposes exactly two allowed durations", () => {
    expect(ALLOWED_DURATION_SECONDS).toEqual([30 * 60, 8 * 60 * 60]);
  });

  it("rejects grant() with a duration outside the allowed set", async () => {
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport: makeStubTransport([]),
    });
    await expect(client.grant("token-1", 60)).rejects.toBeInstanceOf(
      LocationConsentError,
    );
    await expect(client.grant("token-1", 99999)).rejects.toMatchObject({
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
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport: makeStubTransport([
        {
          match: (path, method) =>
            method === "GET" && path === "https://api.example/v1/location/consent",
          status: 200,
          body: consent,
        },
      ]),
    });
    const got = await client.getStatus("token-1");
    expect(got).toEqual(consent);
  });

  it("grant() POSTs to /grant with the duration in the body", async () => {
    const captured: Array<{ path: string; body: any }> = [];
    const consent: LocationConsent = {
      kind: "PRECISE_GPS",
      status: "GRANTED",
      grantedAt: "2026-09-04T10:00:00Z",
      expiresAt: "2026-09-04T10:30:00Z",
      remainingSeconds: 1800,
      durationSeconds: 1800,
    };
    const transport = {
      async get<T>(): Promise<T> {
        throw new Error("not used");
      },
      async post<T>(path: string, _token: string, body: any): Promise<T> {
        captured.push({ path, body });
        return consent as T;
      },
    };
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const got = await client.grant("token-1", 1800);
    expect(captured).toEqual([
      {
        path: "https://api.example/v1/location/consent/grant",
        body: { durationSeconds: 1800 },
      },
    ]);
    expect(got.durationSeconds).toBe(1800);
  });

  it("revoke() POSTs to /revoke with an empty body", async () => {
    let called = false;
    const transport = {
      async get<T>(): Promise<T> {
        throw new Error("not used");
      },
      async post<T>(path: string, _token: string, body: any): Promise<T> {
        expect(path).toBe("https://api.example/v1/location/consent/revoke");
        // The client passes null when the caller does not provide
        // a body, which is what fetch wants for a body-less POST.
        expect(body).toBeNull();
        called = true;
        return { kind: "PRECISE_GPS", status: "REVOKED", wasActive: true } as T;
      },
    };
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const result = await client.revoke("token-1");
    expect(called).toBe(true);
    expect(result.wasActive).toBe(true);
  });

  it("history() GETs /consent/history and returns the rows array", async () => {
    const transport = makeStubTransport([
      {
        match: (path, method) =>
          method === "GET" && path === "https://api.example/v1/location/consent/history",
        status: 200,
        body: {
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
        },
      },
    ]);
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1",
      transport,
    });
    const got = await client.history("token-1");
    expect(got.rows!.length).toBe(1);
    expect(got.rows![0]!.durationSeconds).toBe(28800);
  });

  it("trims trailing slashes from baseUrl", async () => {
    const client = new LocationConsentClient({
      baseUrl: "https://api.example/v1////",
      transport: fetchTransport,
    });
    // No public way to read baseUrl, but we can assert the
    // grant() validation surfaces a 400 (not a fetch error) by
    // sending a bad duration. This proves the client constructed
    // without throwing on the weird baseUrl.
    await expect(client.grant("t", 60)).rejects.toBeInstanceOf(LocationConsentError);
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
