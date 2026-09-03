import { describe, expect, it } from "vitest";
import type { Transport, TransportRequest, TransportResponse } from "./auth-client";
import {
  isCategoryKilled,
  LegalStatusClient,
  resolveLegalStatusClient,
} from "./legal-status-client";

function makeTransport(responses: Array<{
  match: (req: TransportRequest) => boolean;
  response: TransportResponse;
}>): Transport {
  return async (req) => {
    for (const r of responses) {
      if (r.match(req)) return r.response;
    }
    throw new Error(`no stub for ${req.method} ${req.url}`);
  };
}

function okResponse(body: any, status = 200): TransportResponse {
  return {
    status,
    json: async () => body,
  };
}

describe("LegalStatusClient", () => {
  it("getStatus() returns an empty status when the server reports no kill switches", async () => {
    const transport = makeTransport([
      {
        match: (req) => req.method === "GET" && req.url === "https://api.example/v1/legal/status",
        response: okResponse({ killed: {}, checkedAt: "2026-09-04T10:00:00Z" }),
      },
    ]);
    const client = new LegalStatusClient({ baseUrl: "https://api.example/v1", transport });
    const status = await client.getStatus();
    expect(status.killed).toEqual({});
    expect(status.checkedAt).toBe("2026-09-04T10:00:00Z");
  });

  it("getStatus() projects the killed map keyed by category", async () => {
    const transport = makeTransport([
      {
        match: (req) => req.method === "GET" && req.url === "https://api.example/v1/legal/status",
        response: okResponse({
          killed: {
            AI_MEDIA: {
              category: "AI_MEDIA",
              reason: "AI law incident",
              setBy: "operator_1",
              setAt: "2026-09-04T09:00:00Z",
            },
            MARKETPLACE: {
              category: "MARKETPLACE",
              reason: "Payment outage",
              setBy: "operator_2",
              setAt: "2026-09-04T09:30:00Z",
              expiresAt: "2026-09-05T09:30:00Z",
            },
          },
          checkedAt: "2026-09-04T10:00:00Z",
        }),
      },
    ]);
    const client = new LegalStatusClient({ baseUrl: "https://api.example/v1", transport });
    const status = await client.getStatus();
    expect(Object.keys(status.killed).sort()).toEqual(["AI_MEDIA", "MARKETPLACE"]);
    expect(status.killed.AI_MEDIA?.reason).toBe("AI law incident");
    expect(status.killed.MARKETPLACE?.expiresAt).toBe("2026-09-05T09:30:00Z");
  });

  it("getStatus() is a GET with no Authorization header (public endpoint)", async () => {
    let captured: TransportRequest | undefined;
    const transport: Transport = async (req) => {
      captured = req;
      return okResponse({ killed: {}, checkedAt: "2026-09-04T10:00:00Z" });
    };
    const client = new LegalStatusClient({ baseUrl: "https://api.example/v1", transport });
    await client.getStatus();
    expect(captured?.method).toBe("GET");
    expect(captured?.url).toBe("https://api.example/v1/legal/status");
    expect(captured?.headers.Authorization).toBeUndefined();
  });

  it("trims trailing slashes from baseUrl", async () => {
    const transport = makeTransport([
      {
        match: (req) => req.url === "https://api.example/v1/legal/status",
        response: okResponse({ killed: {}, checkedAt: "2026-09-04T10:00:00Z" }),
      },
    ]);
    const client = new LegalStatusClient({
      baseUrl: "https://api.example/v1////",
      transport,
    });
    const status = await client.getStatus();
    expect(status.killed).toEqual({});
  });

  it("throws LegalStatusError on 5xx", async () => {
    const transport = makeTransport([
      {
        match: () => true,
        response: { status: 503, json: async () => ({ error: "service_unavailable" }) },
      },
    ]);
    const client = new LegalStatusClient({ baseUrl: "https://api.example/v1", transport });
    await expect(client.getStatus()).rejects.toMatchObject({ httpStatus: 503 });
  });

  it("resolveLegalStatusClient builds a usable client", async () => {
    const transport: Transport = async () =>
      okResponse({ killed: {}, checkedAt: "2026-09-04T10:00:00Z" });
    const client = resolveLegalStatusClient({ baseUrl: "https://api.example/v1", transport });
    const status = await client.getStatus();
    expect(status.killed).toEqual({});
  });
});

describe("isCategoryKilled", () => {
  const aiKilled = {
    killed: {
      AI_MEDIA: {
        category: "AI_MEDIA" as const,
        reason: "test",
        setBy: "op",
        setAt: "2026-09-04T09:00:00Z",
      },
    },
    checkedAt: "2026-09-04T10:00:00Z",
  };
  const empty = { killed: {}, checkedAt: "2026-09-04T10:00:00Z" };

  it("returns true when the category is in the killed map", () => {
    expect(isCategoryKilled(aiKilled, "AI_MEDIA")).toBe(true);
  });
  it("returns false when the category is not in the killed map", () => {
    expect(isCategoryKilled(aiKilled, "MARKETPLACE")).toBe(false);
  });
  it("returns false when the killed map is empty", () => {
    expect(isCategoryKilled(empty, "AI_MEDIA")).toBe(false);
  });
  it("returns false when status is null", () => {
    expect(isCategoryKilled(null, "GLOBAL")).toBe(false);
  });
});
