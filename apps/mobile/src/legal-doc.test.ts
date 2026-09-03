import { describe, expect, it, vi } from "vitest";
import { LegalDocClient } from "./legal-doc";

// R16.9: the signup consent gate must NEVER call the user's checkbox
// "checked" if the legal doc body is empty or missing. These tests guard
// the client-side invariant: load() rejects on empty body and the kind
// returned by the server matches the kind we asked for.

function fakeFetch(respond: (url: string) => Promise<Response>): typeof fetch {
  return ((url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    return respond(u);
  }) as unknown as typeof fetch;
}

const FAKE_TERMS = {
  kind: "terms",
  version: "1.1",
  locale: "vi-VN",
  title: "PROXY 服务使用协议",
  effectiveAt: "[YYYY-MM-DD]",
  contentSha256: "abc123",
  updatedAt: "2026-08-31T00:00:00.000Z",
  content: "PROXY 服务使用协议\n\n版本：1.1\n...".padEnd(2000, "·")
};

const FAKE_PRIVACY = { ...FAKE_TERMS, kind: "privacy" as const, title: "PROXY 隐私政策及个人数据处理通知", content: "PROXY 隐私政策及个人数据处理通知\n\n版本：1.1\n...".padEnd(2000, "·") };

describe("LegalDocClient (R16.9)", () => {
  it("returns the parsed legal doc on a 200 response", async () => {
    const client = new LegalDocClient({
      baseUrl: "https://api.proxy.test",
      fetchImpl: fakeFetch(async (url) => {
        expect(url).toBe("https://api.proxy.test/v1/legal/terms");
        return new Response(JSON.stringify(FAKE_TERMS), { status: 200 });
      })
    });
    const doc = await client.load("terms");
    expect(doc.kind).toBe("terms");
    expect(doc.version).toBe("1.1");
    expect(doc.content.length).toBeGreaterThan(200);
  });

  it("strips a trailing slash from baseUrl before composing the request", async () => {
    const client = new LegalDocClient({
      baseUrl: "https://api.proxy.test/",
      fetchImpl: fakeFetch(async (url) => {
        expect(url).toBe("https://api.proxy.test/v1/legal/privacy");
        return new Response(JSON.stringify(FAKE_PRIVACY), { status: 200 });
      })
    });
    const doc = await client.load("privacy");
    expect(doc.kind).toBe("privacy");
  });

  it("rejects when the server returns 404", async () => {
    const client = new LegalDocClient({
      baseUrl: "https://api.proxy.test",
      fetchImpl: fakeFetch(async () => new Response("not found", { status: 404 }))
    });
    await expect(client.load("terms")).rejects.toThrow(/legal doc fetch failed/);
  });

  it("rejects when the envelope kind does not match the requested kind", async () => {
    const client = new LegalDocClient({
      baseUrl: "https://api.proxy.test",
      fetchImpl: fakeFetch(async () => new Response(JSON.stringify({ ...FAKE_TERMS, kind: "privacy" }), { status: 200 }))
    });
    await expect(client.load("terms")).rejects.toThrow(/kind mismatch/);
  });

  it("rejects when the body is too short — refuse to allow a checkbox on an empty doc", async () => {
    const client = new LegalDocClient({
      baseUrl: "https://api.proxy.test",
      fetchImpl: fakeFetch(async () => new Response(JSON.stringify({ ...FAKE_TERMS, content: "tiny" }), { status: 200 }))
    });
    await expect(client.load("terms")).rejects.toThrow(/body is empty/);
  });
});
