import { describe, expect, it } from "vitest";
import { ActivityClient, ActivityCommandRejectedError, ActivityProtocolError, describeJoinError } from "./activity-client";
import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

function response(body: unknown): TransportResponse { return { status: 200, json: async () => body }; }

async function authenticatedStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-04T00:00:00Z"));
  await store.write({ userAccountId:"user_1", principal:{type:"INDIVIDUAL", id:"user_1"}, auth:{sessionId:"s1", userAccountId:"user_1", principal:{type:"INDIVIDUAL", id:"user_1"}, accessToken:"a", refreshToken:"r", accessExpiresAt:"2026-09-05T00:00:00Z", refreshExpiresAt:new Date(Date.now() + 2592000000).toISOString(), rotation:1} });
  return store;
}

describe("ACT-PUBLISH-001 activity client", () => {
  it("publishes the prototype activity fields and parses the real activity", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const activity = { activityId:"activity_1", origin:"USER", ownerId:"user_1", status:"PUBLISHED", title:"周六咖啡拍照局", time:"周六", people:"0 / 6 人", price:"0₫", moneyFlow:"FREE", priceLabel:"免费参加", consumption:"各自承担到店消费", consumptionTerm:"SPLIT", venueIcon:"☕", venueName:"木光咖啡", realitySceneId:"scene_1", venueSpend:"", venueType:"CAFE", venueTypeLabel:"咖啡店", desc:"共同参与", benefit:"", qaCount:0, interested:0, joined:0, capacity:6, shares:0, aiStatus:"NONE" };
    const client = new ActivityClient({ secureSessionStore: await authenticatedStore(), authClient:{ request:async (_path, init) => { sent.push(init.body as Record<string, unknown>); return response({commandId:"c", outcome:"ACCEPTED", aggregate:{type:"Activity", id:"activity_1", version:1, state:"PUBLISHED"}, eventRefs:[], correlationId:"x", operationRef:JSON.stringify({activity})}); } } });
    const result = await client.publish({title:activity.title, time:activity.time, capacity:6, venueName:activity.venueName, venueIcon:activity.venueIcon, venueType:"CAFE", realitySceneId:"scene_1", desc:"共同参与", consumptionTerm:"SPLIT"});
    expect(result.moneyFlow).toBe("FREE");
    expect(sent[0]?.commandType).toBe("PublishActivity");
    expect((sent[0]?.payload as { consumptionTerm:string }).consumptionTerm).toBe("SPLIT");
  });

  it("does not send writes from an offline fallback session", async () => {
    const store = await authenticatedStore();
    const saved = await store.read();
    await store.write({ ...saved!, serverSession:false });
    let called = false;
    const client = new ActivityClient({ secureSessionStore:store, authClient:{request:async()=>{ called=true; return response({}); }} });
    await expect(client.publish({title:"x", time:"周六", capacity:4, venueName:"店", venueIcon:"☕", venueType:"CAFE", realitySceneId:"scene", desc:"x", consumptionTerm:"SPLIT"})).rejects.toThrow(/offline fallback/);
    expect(called).toBe(false);
  });

  it("forwards merchantId for shop publishing (MERCHANT-PUBLISH-001)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const activity = { activityId:"activity_1", origin:"USER", title:"t", time:"周六", people:"0 / 6 人", price:"0₫", moneyFlow:"FREE", priceLabel:"免费参加", consumption:"x", venueIcon:"☕", venueName:"店", venueSpend:"", venueType:"CAFE", venueTypeLabel:"咖啡店", desc:"x", benefit:"", qaCount:0, interested:0, joined:0, shares:0, aiStatus:"NONE" };
    const client = new ActivityClient({ secureSessionStore: await authenticatedStore(), authClient:{ request:async (_path, init) => { sent.push(init.body as Record<string, unknown>); return response({commandId:"c", outcome:"ACCEPTED", aggregate:{type:"Activity", id:"activity_1", version:1, state:"PUBLISHED"}, eventRefs:[], correlationId:"x", operationRef:JSON.stringify({activity})}); } } });
    await client.publish({title:"t", time:"周六", capacity:6, venueName:"店", venueIcon:"☕", venueType:"CAFE", realitySceneId:"scene_1", desc:"x", consumptionTerm:"SPLIT", merchantId:"biz_1"});
    expect((sent[0]?.payload as { merchantId?: string }).merchantId).toBe("biz_1");
  });
});

describe("describeJoinError", () => {
  const rejected = (errorCode: string): ActivityCommandRejectedError =>
    new ActivityCommandRejectedError({
      commandId: "c",
      outcome: "REJECTED",
      eventRefs: [],
      correlationId: "x",
      error: {
        errorCode,
        category: "BUSINESS_STATE",
        retryability: "AFTER_USER_ACTION",
        messageKey: "activity.rejected",
        safeDetails: {},
        correlationId: "x"
      }
    } as CommandResult);

  it("names repeat joins instead of blaming login", () => {
    expect(describeJoinError(rejected("ACTIVITY_ALREADY_JOINED"))).toContain("已报过名");
  });

  it("names full and missing activities", () => {
    expect(describeJoinError(rejected("ACTIVITY_FULL"))).toContain("名额已满");
    expect(describeJoinError(rejected("ACTIVITY_NOT_FOUND"))).toContain("不存在或已结束");
  });

  it("asks for re-login only on auth failures", () => {
    expect(describeJoinError(rejected("ACTIVITY_ACTOR_REQUIRED"))).toContain("重新登录");
    expect(describeJoinError(new ActivityProtocolError("an authenticated principal is required"))).toBe("登录后可报名");
  });

  it("falls back to network hint for transport errors", () => {
    expect(describeJoinError(new Error("fetch failed"))).toContain("网络异常");
    expect(describeJoinError(rejected("ACTIVITY_JOIN_FAILED"))).toContain("稍后重试");
  });
});

describe("ORDER-NO-001 join returns the personal order number", () => {
  const activity = { activityId: "activity_1", origin: "USER", ownerId: "user_1", status: "PUBLISHED", title: "周六咖啡拍照局", time: "周六", people: "0 / 6 人", price: "0₫", moneyFlow: "FREE", priceLabel: "免费参加", consumption: "各自承担到店消费", consumptionTerm: "SPLIT", venueIcon: "☕", venueName: "木光咖啡", realitySceneId: "scene_1", venueSpend: "", venueType: "CAFE", venueTypeLabel: "咖啡店", desc: "共同参与", benefit: "", qaCount: 0, interested: 0, joined: 1, capacity: 6, shares: 0, aiStatus: "NONE" };
  async function joinWith(operationRef: unknown) {
    const client = new ActivityClient({ secureSessionStore: await authenticatedStore(), authClient: { request: async () => response({ commandId: "c", outcome: "ACCEPTED", aggregate: { type: "Activity", id: "activity_1", version: 1, state: "JOINED" }, eventRefs: [], correlationId: "x", operationRef: JSON.stringify(operationRef) }) } });
    return client.join("activity_1");
  }

  it("passes through orderNo when the server sends it", async () => {
    const result = await joinWith({ activity, joined: true, orderNo: "100260927143022000002" });
    expect(result.orderNo).toBe("100260927143022000002");
  });

  it("leaves orderNo undefined for old servers (UI falls back to activity code)", async () => {
    const result = await joinWith({ activity, joined: true });
    expect(result.orderNo).toBeUndefined();
  });
});
