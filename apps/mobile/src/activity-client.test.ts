import { describe, expect, it } from "vitest";
import { ActivityClient } from "./activity-client";
import type { TransportResponse } from "./auth-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

function response(body: unknown): TransportResponse { return { status: 200, json: async () => body }; }

async function authenticatedStore(): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-04T00:00:00Z"));
  await store.write({ userAccountId:"user_1", principal:{type:"INDIVIDUAL", id:"user_1"}, auth:{sessionId:"s1", userAccountId:"user_1", principal:{type:"INDIVIDUAL", id:"user_1"}, accessToken:"a", refreshToken:"r", accessExpiresAt:"2026-09-05T00:00:00Z", refreshExpiresAt:"2026-10-04T00:00:00Z", rotation:1} });
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
});
