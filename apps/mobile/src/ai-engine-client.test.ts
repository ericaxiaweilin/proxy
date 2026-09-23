import { describe, expect, it } from "vitest";
import type { TransportResponse } from "./auth-client";
import { AiEngineClient, type AiEngineSnapshot } from "./ai-engine-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

function response(body: unknown): TransportResponse {
  return { status: 200, json: async () => body };
}

function storeWithSession(): SecureSessionStore {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  return store;
}

async function seededStore(): Promise<SecureSessionStore> {
  const store = storeWithSession();
  await store.write({
    userAccountId: "user_1",
    principal: { type: "INDIVIDUAL", id: "user_1" },
    auth: {
      sessionId: "session_1",
      userAccountId: "user_1",
      principal: { type: "INDIVIDUAL", id: "user_1" },
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2026-09-04T01:00:00.000Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1,
    },
  });
  return store;
}

describe("AI-MANAGE-002 — AI engine client", () => {
  it("reads server settings and token usage with actor ownership", async () => {
    const store = await seededStore();
    const requests: Record<string, unknown>[] = [];
    const snapshot: AiEngineSnapshot = {
      exists: true,
      settings: {
        userAccountId: "user_1",
        paused: true,
        chatTone: "cool",
        chatReplyLength: "short",
        chatEmoji: "sometimes",
        chatRhythm: "human_3_5",
        chatPermission: "off",
        imageScene: "cafe",
        imagePose: "",
        imageCamera: "static",
        imagePrompt: "",
        imagePromptHistory: [],
        imageAspect: "3:4",
        imageQuality: "1536",
        imageVendorPref: "platform_default",
        imageModelPref: "",
        postPace: "every_3_days",
        postTopics: ["胶片"],
        postPermission: "off",
        version: 3,
      },
      usage: { userAccountId: "user_1", period: "2026-09", promptTokens: 120000, outputTokens: 4000 },
      period: "2026-09",
    };
    const client = new AiEngineClient({
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          requests.push(init.body as Record<string, unknown>);
          return response({
            commandId: "cmd",
            outcome: "ACCEPTED",
            aggregate: { type: "AiEngineSettings", id: "user_1", version: 3, state: "READ" },
            eventRefs: [],
            operationRef: JSON.stringify(snapshot),
            correlationId: "corr",
          });
        },
      },
    });
    const got = await client.read();
    expect(got.exists).toBe(true);
    expect(got.settings.paused).toBe(true);
    expect(got.settings.chatPermission).toBe("off");
    expect(got.usage.promptTokens).toBe(120000);
    expect(got.usage.period).toBe("2026-09");
    expect(requests[0]?.actor).toEqual({ type: "USER", id: "user_1" });
    expect(requests[0]?.commandType).toBe("GetAiEngineSettings");
  });

  it("round-trips pause toggle through UpdateAiEngineSettings", async () => {
    const store = await seededStore();
    const payloads: Record<string, unknown>[] = [];
    const client = new AiEngineClient({
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          const body = init.body as { commandType: string; payload: Record<string, unknown> };
          payloads.push(body.payload);
          return response({
            commandId: "cmd",
            outcome: "ACCEPTED",
            aggregate: { type: "AiEngineSettings", id: "user_1", version: 2, state: "UPDATED" },
            eventRefs: [],
            operationRef: JSON.stringify({ settings: { userAccountId: "user_1", paused: body.payload.paused, version: 2, ...body.payload } }),
            correlationId: "corr",
          });
        },
      },
    });
    const saved = await client.togglePaused(false);
    expect(payloads[0]?.paused).toBe(true);
    expect(saved.paused).toBe(true);
  });

  it("reports missing server row as exists=false with safe defaults", async () => {
    const store = await seededStore();
    const client = new AiEngineClient({
      secureSessionStore: store,
      authClient: {
        request: async () =>
          response({
            commandId: "cmd",
            outcome: "ACCEPTED",
            aggregate: { type: "AiEngineSettings", id: "user_1", version: 0, state: "READ" },
            eventRefs: [],
            operationRef: JSON.stringify({ exists: false, settings: null, usage: null, period: "2026-09" }),
            correlationId: "corr",
          }),
      },
    });
    const got = await client.read();
    expect(got.exists).toBe(false);
    expect(got.settings.paused).toBe(false);
    expect(got.settings.chatPermission).toBe("confirm");
    expect(got.usage.promptTokens).toBe(0);
    expect(got.usage.period).toBe("2026-09");
  });
});
