// R16.10-P1-F: privacy client unit tests. These tests run with a
// mock transport; the real /v1/privacy/* round-trip is covered by
// scripts/legal-e2e.sh + scripts/privacy-e2e.sh against a live
// server.
import { describe, expect, it } from "vitest";
import type { Transport, TransportRequest, TransportResponse } from "./auth-client";
import { PrivacyClient, PrivacyError } from "./privacy-client";

class FakeTransport {
  readonly calls: TransportRequest[] = [];
  private readonly scripts: Array<(req: TransportRequest) => TransportResponse> = [];
  enqueue(response: TransportResponse | ((req: TransportRequest) => TransportResponse)): void {
    if (typeof response === "function") {
      this.scripts.push(response);
    } else {
      this.scripts.push(() => response);
    }
  }
  readonly transport: Transport = async (req) => {
    this.calls.push(req);
    const next = this.scripts.shift();
    if (!next) {
      return { status: 599, json: async () => ({ error: "no_fake_response_queued" }) };
    }
    return next(req);
  };
}

function fakeResponse(status: number, body: unknown): TransportResponse {
  return { status, json: async () => body };
}

describe("PrivacyClient", () => {
  it("fetchMe issues GET /v1/privacy/me with no body", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(200, {
      data: { account: { id: "u1", status: "ACTIVE" }, generatedAt: "2026-09-03T00:00:00Z", formatVersion: "1.0", legalBasis: "PDP-91/2025/QH15-Art31" },
      formatVersion: "1.0",
      legalBasis: "PDP-91/2025/QH15-Art31",
      generatedAt: "2026-09-03T00:00:00Z",
      history: []
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    const result = await client.fetchMe();
    expect(result.formatVersion).toBe("1.0");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.method).toBe("GET");
    expect(fake.calls[0]!.url).toBe("http://127.0.0.1:4100/v1/privacy/me");
    expect(fake.calls[0]!.body).toBeUndefined();
  });

  it("requestExport issues POST with legalBasis payload", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(202, {
      request: {
        id: "preq_1",
        userId: "u1",
        kind: "export",
        status: "received",
        requestedAt: "2026-09-03T00:00:00Z",
        legalBasis: "PDP-91/2025/QH15-Art31",
        version: 1
      },
      retentionDays: 7
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    const result = await client.requestExport({ legalBasis: "PDP-91/2025/QH15-Art31" });
    expect(result.retentionDays).toBe(7);
    expect(result.request.kind).toBe("export");
    expect(fake.calls[0]!.method).toBe("POST");
    expect(fake.calls[0]!.url).toBe("http://127.0.0.1:4100/v1/privacy/export");
    expect(JSON.parse(fake.calls[0]!.body!)).toEqual({ legalBasis: "PDP-91/2025/QH15-Art31" });
  });

  it("requestDelete reports the 30-day grace window", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(202, {
      request: {
        id: "preq_2",
        userId: "u1",
        kind: "delete",
        status: "received",
        requestedAt: "2026-09-03T00:00:00Z",
        legalBasis: "PDP-91/2025/QH15-Art32",
        version: 1
      },
      gracePeriodDays: 30,
      erasedAt: "2026-10-03T00:00:00Z",
      cancelableUntil: "2026-10-03T00:00:00Z"
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    const result = await client.requestDelete({ reason: "user testing" });
    expect(result.gracePeriodDays).toBe(30);
    expect(result.erasedAt).toBe("2026-10-03T00:00:00Z");
  });

  it("cancelRequest sends requestId + reason", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(200, {
      request: {
        id: "preq_2",
        userId: "u1",
        kind: "delete",
        status: "cancelled",
        requestedAt: "2026-09-03T00:00:00Z",
        legalBasis: "PDP-91/2025/QH15-Art32",
        version: 2
      }
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    const result = await client.cancelRequest({ requestId: "preq_2", reason: "changed mind" });
    expect(result.request.status).toBe("cancelled");
    expect(JSON.parse(fake.calls[0]!.body!)).toEqual({ requestId: "preq_2", reason: "changed mind" });
  });

  it("fetchStatus encodes requestId in the query string", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(200, {
      request: {
        id: "preq_3",
        userId: "u1",
        kind: "export",
        status: "received",
        requestedAt: "2026-09-03T00:00:00Z",
        legalBasis: "PDP-91/2025/QH15-Art31",
        version: 1
      }
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100/", transport: fake.transport });
    const result = await client.fetchStatus("preq 3/with space");
    expect(result.request.id).toBe("preq_3");
    expect(fake.calls[0]!.url).toBe("http://127.0.0.1:4100/v1/privacy/status?requestId=preq%203%2Fwith%20space");
  });

  it("throws PrivacyError on non-2xx", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(409, { error: "PRIVACY_REQUEST_ACTIVE", correlationId: "corr-1" }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    await expect(client.requestExport()).rejects.toMatchObject({
      status: 409,
      code: "PRIVACY_REQUEST_ACTIVE",
      correlationId: "corr-1"
    });
  });

  it("cancelRequest refuses empty requestId before calling the server", async () => {
    const fake = new FakeTransport();
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    await expect(client.cancelRequest({ requestId: "" })).rejects.toBeInstanceOf(PrivacyError);
    expect(fake.calls).toHaveLength(0);
  });

  it("listRequests returns the history newest-first", async () => {
    const fake = new FakeTransport();
    fake.enqueue(fakeResponse(200, {
      count: 2,
      requests: [
        {
          id: "preq_2", userId: "u1", kind: "delete", status: "received",
          requestedAt: "2026-09-04T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art32", version: 1
        },
        {
          id: "preq_1", userId: "u1", kind: "export", status: "completed",
          requestedAt: "2026-09-03T00:00:00Z", legalBasis: "PDP-91/2025/QH15-Art31", version: 2
        }
      ]
    }));
    const client = new PrivacyClient({ baseUrl: "http://127.0.0.1:4100", transport: fake.transport });
    const result = await client.listRequests();
    expect(result.count).toBe(2);
    expect(result.requests[0]!.kind).toBe("delete");
    expect(result.requests[1]!.kind).toBe("export");
  });
});
