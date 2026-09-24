import { describe, it, expect } from "vitest";
import { TwinInsightClient, TwinInsightProtocolError } from "./twin-insight-client";
import type { TransportResponse } from "./auth-client";

function makeRequester(
  handler: (path: string, init: { method: string; body?: unknown }) => TransportResponse,
): { requestPublic: (path: string, init: { method: "GET" | "POST"; body?: unknown }) => Promise<TransportResponse> } {
  return { requestPublic: async (path, init) => handler(path, init) };
}

function ok(body: unknown): TransportResponse {
  return { status: 200, json: async () => body };
}

const INSIGHT = {
  targetId: "alex",
  displayName: "Alex",
  initial: "A",
  avatarUrl: "",
  signal: "hot",
  verdict: "worth",
  verdictLabel: "值得运营",
  summaryHint: "7 天访问 12 次 · 互动深",
  score: 82,
  signals: { views7d: 12, messages7d: 48, avgStaySec: 180, likes7d: 9 },
  advices: [{ type: "good", text: "兴趣明确。" }],
  summaryText: "聊过 2 次。",
  timeline: [{ text: "访问了你的主页", time: "2 小时前", gray: false }],
};

const LIST_PAYLOAD = {
  twinId: "twin_01",
  insights: [INSIGHT],
  totalTargets: 6,
  thresholds: { operateAt: 60, observeAt: 40, configVersion: 3 },
};

describe("TwinInsightClient (TWIN-INSIGHT-001)", () => {
  it("lists insights from the anonymous endpoint", async () => {
    const client = new TwinInsightClient({
      requester: makeRequester((path) => {
        expect(path).toBe("/v1/ai/twins/twin_01/insights?window=7d");
        return ok(LIST_PAYLOAD);
      }),
      baseUrl: "http://localhost:3000",
    });
    const out = await client.listInsights("twin_01");
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]!.score).toBe(82);
  });

  it("rejects non-2xx with TwinInsightProtocolError", async () => {
    const client = new TwinInsightClient({
      requester: makeRequester(() => ({ status: 503, json: async () => ({}) })),
      baseUrl: "http://localhost:3000",
    });
    await expect(client.listInsights("twin_01")).rejects.toBeInstanceOf(TwinInsightProtocolError);
  });

  it("rejects malformed payload (fail-closed)", async () => {
    const client = new TwinInsightClient({
      requester: makeRequester(() => ok({ twinId: "twin_01", totalTargets: 0 })),
      baseUrl: "http://localhost:3000",
    });
    await expect(client.listInsights("twin_01")).rejects.toThrow();
  });

  it("operate requires auth channel and translates 401", async () => {
    const authed = {
      request: async () => ({ status: 401, json: async () => ({}) }) as TransportResponse,
    };
    const client = new TwinInsightClient({
      requester: makeRequester(() => ok({})),
      baseUrl: "http://localhost:3000",
      authedRequester: authed,
    });
    await expect(client.operate("twin_01", "alex", "operate")).rejects.toThrowError(/请登录后重试/);
  });

  it("operate returns audit result on success", async () => {
    const authed = {
      request: async () => ok({ targetId: "alex", action: "operate", actedAt: "2026-09-21T00:00:00Z" }) as TransportResponse,
    };
    const client = new TwinInsightClient({
      requester: makeRequester(() => ok({})),
      baseUrl: "http://localhost:3000",
      authedRequester: authed,
    });
    const out = await client.operate("twin_01", "alex", "operate");
    expect(out.action).toBe("operate");
  });
});

describe("TwinInsightClient 403 mapping (TWIN-INSIGHT-ENTITLEMENT-001)", () => {
  function forbidden(code: string): TransportResponse {
    return { status: 403, json: async () => ({ error: code }) };
  }

  it("list says creator-only for insight_viewer_forbidden", async () => {
    const client = new TwinInsightClient({
      requester: makeRequester(() => forbidden("insight_viewer_forbidden")),
      baseUrl: "http://localhost:3000",
    });
    await expect(client.listInsights("twin_01")).rejects.toThrowError(/仅向认证创作者开放/);
  });

  it("list keeps the age message for unknown 403 codes", async () => {
    const client = new TwinInsightClient({
      requester: makeRequester(() => forbidden("companion_minor_forbidden")),
      baseUrl: "http://localhost:3000",
    });
    await expect(client.listInsights("twin_01")).rejects.toThrowError(/确认账号年龄信息/);
  });

  it("operate says creator-only for insight_viewer_forbidden", async () => {
    const authed = {
      request: async () => forbidden("insight_viewer_forbidden") as TransportResponse,
    };
    const client = new TwinInsightClient({
      requester: makeRequester(() => ok({})),
      baseUrl: "http://localhost:3000",
      authedRequester: authed,
    });
    await expect(client.operate("twin_01", "alex", "operate")).rejects.toThrowError(/仅向认证创作者开放/);
  });
});
