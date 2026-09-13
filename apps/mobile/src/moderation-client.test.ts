import { describe, expect, it } from "vitest";
import { ModerationClient, REPORT_REASONS, activityReportTargets, opportunityReportTarget } from "./moderation-client";
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

// COMP-REPORT-002（续）: 活动 / 商家 / 机会 / 邀约 四类入口。
// 判定「这一类对象该报成哪一类」抽成纯函数就是为了在这里钉住 ——
// 入口越加越多，靠肉眼看 JSX 迟早会漏。
describe("report target selection for activity / merchant / opportunity / invite", () => {
  it("always offers the activity itself, and the host merchant only when it is merchant-run", () => {
    const plain = activityReportTargets({ activityId: "act_1", origin: "USER", ownerId: "user_9" });
    expect(plain.map((t) => t.targetType)).toEqual(["ACTIVITY"]);

    const merchantRun = activityReportTargets({ activityId: "act_2", origin: "MERCHANT", ownerId: "biz_9" });
    expect(merchantRun.map((t) => t.targetType)).toEqual(["ACTIVITY", "MERCHANT"]);
    expect(merchantRun[1]?.targetId).toBe("biz_9");

    // 商家主办但没有 ownerId 时不列 —— 报上去一条查不到的 id 等于白报。
    expect(activityReportTargets({ activityId: "act_3", origin: "MERCHANT" }).map((t) => t.targetType)).toEqual(["ACTIVITY"]);
    expect(activityReportTargets({ activityId: "act_4", origin: "MERCHANT", ownerId: "   " }).map((t) => t.targetType)).toEqual(["ACTIVITY"]);
  });

  it("reports a targeted opportunity as INVITE and a public one as OPPORTUNITY", () => {
    expect(opportunityReportTarget({ id: "opp_1" })).toMatchObject({ targetType: "OPPORTUNITY", targetId: "opp_1" });
    expect(opportunityReportTarget({ id: "opp_2", targetAccountId: "user_7" })).toMatchObject({ targetType: "INVITE", targetId: "opp_2" });
    // 空白 targetAccountId 视为公开。
    expect(opportunityReportTarget({ id: "opp_3", targetAccountId: "  " }).targetType).toBe("OPPORTUNITY");
  });

  // 界面上那个 PX-O-… 编号是客户端随机生成的展示号，服务端不认。
  // 这里钉住「用服务端主键」这件事，防止以后有人顺手把展示编号传进来。
  it("targets the server opportunity id, not the client-side PX-O display code", () => {
    const target = opportunityReportTarget({ id: "opp_server_1", targetAccountId: "user_7" });
    expect(target.targetId).toBe("opp_server_1");
    expect(target.targetId).not.toMatch(/^PX-/);
  });

  // 入口算出来的每一类都要真能发出去 —— 这是「界面有按钮」和
  // 「举报真的落库」之间的那道缝。
  it("sends every target the new entry points offer", async () => {
    const store = await signedInStore();
    const envelopes: Array<Record<string, unknown>> = [];
    const client = clientWith(store, envelopes);
    const offered = [
      ...activityReportTargets({ activityId: "act_2", origin: "MERCHANT", ownerId: "biz_9" }),
      opportunityReportTarget({ id: "opp_1" }),
      opportunityReportTarget({ id: "opp_2", targetAccountId: "user_7" })
    ];
    for (const target of offered) {
      await client.reportTarget(target.targetType, target.targetId, "SOLICITATION");
    }
    expect(envelopes.map((item) => (item.payload as { targetType: string }).targetType)).toEqual(["ACTIVITY", "MERCHANT", "OPPORTUNITY", "INVITE"]);
    expect(envelopes.map((item) => (item.payload as { targetId: string }).targetId)).toEqual(["act_2", "biz_9", "opp_1", "opp_2"]);
  });
});
