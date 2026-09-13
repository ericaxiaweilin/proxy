import { describe, expect, it } from "vitest";
import { ModerationClient, REPORT_REASONS } from "./moderation-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

// COMP-REPORT-002: 举报入口接得上。
// 服务端 COMP-REPORT-001 已经能受理八类目标，但用户真正能碰到哪几类，
// 取决于移动端有没有入口。这里钉住客户端本身：命令名、目标类型、
// 理由、以及「空目标 / 未登录」必须报错而不是静默吞掉。

async function signedInStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  await store.write({
    userAccountId: "user_001",
    principal: { type: "INDIVIDUAL", id: "user_001" },
    auth: { sessionId: "session_001", userAccountId: "user_001", principal: { type: "INDIVIDUAL", id: "user_001" }, accessToken: "access", refreshToken: "refresh", accessExpiresAt: "2026-08-25T00:00:00Z", refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(), rotation: 1 }
  });
  return store;
}

function clientWith(store: SecureSessionStore, envelopes: Array<Record<string, unknown>>): ModerationClient {
  return new ModerationClient({ secureSessionStore: store, authClient: { request: async (_path, init) => {
    const envelope = init.body as Record<string, unknown>;
    envelopes.push(envelope);
    return { status: 200, json: async () => ({ commandId: envelope.commandId, outcome: "ACCEPTED", eventRefs: [], correlationId: envelope.correlationId }) };
  } } });
}

describe("ModerationClient report intake", () => {
  it("sends every target type the terms promise as a ReportTarget command", async () => {
    const store = await signedInStore();
    const envelopes: Array<Record<string, unknown>> = [];
    const client = clientWith(store, envelopes);
    const targets = ["POST", "MESSAGE", "ACCOUNT", "ACTIVITY", "OPPORTUNITY", "MERCHANT", "INVITE", "TRANSACTION"] as const;
    for (const targetType of targets) {
      await client.reportTarget(targetType, `${targetType.toLowerCase()}_1`, "SPAM");
    }
    expect(envelopes.map((item) => item.commandType)).toEqual(new Array(targets.length).fill("ReportTarget"));
    expect(envelopes.map((item) => (item.payload as { targetType: string }).targetType)).toEqual([...targets]);
  });

  it("reports a message with the solicitation reason", async () => {
    const store = await signedInStore();
    const envelopes: Array<Record<string, unknown>> = [];
    const client = clientWith(store, envelopes);
    await client.reportTarget("MESSAGE", "msg_42", "SOLICITATION", " 对方提出线下付费见面 ");
    expect(envelopes[0]?.payload).toEqual({ targetType: "MESSAGE", targetId: "msg_42", reason: "SOLICITATION", note: "对方提出线下付费见面" });
    expect(envelopes[0]?.target).toEqual({ type: "Message", id: "msg_42" });
  });

  it("offers the two highest-risk reasons explicitly", () => {
    const reasons = REPORT_REASONS.map((item) => item.reason);
    expect(reasons).toContain("SOLICITATION");
    expect(reasons).toContain("MINOR_SAFETY");
  });

  // 写不进去必须报错：UI 要让用户知道没提交成功，不能显示「已受理」。
  it("surfaces a rejected report instead of reporting success", async () => {
    const store = await signedInStore();
    const client = new ModerationClient({ secureSessionStore: store, authClient: { request: async () => ({ status: 200, json: async () => ({ outcome: "REJECTED", error: { messageKey: "moderation.invalid_report_target" } }) }) } });
    await expect(client.reportTarget("ACCOUNT", "acct_1", "FRAUD")).rejects.toThrow();
  });

  it("refuses an empty target id locally", async () => {
    const store = await signedInStore();
    const envelopes: Array<Record<string, unknown>> = [];
    const client = clientWith(store, envelopes);
    await expect(client.reportTarget("POST", "   ", "SPAM")).rejects.toThrow();
    expect(envelopes).toHaveLength(0);
  });
});
