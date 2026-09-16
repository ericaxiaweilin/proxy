// MEETUP-SHARE-001 (segment 2): LOCATION 收发接线回归钉。
// 发：sendLocationMessage 按可解析格式 + LOCATION 类型落线，非法坐标抛错不发。
// 收：decode/meetupPreview 已在 meetup-share.test.ts 覆盖；这里钉 wire 形状。
import { describe, expect, it } from "vitest";
import { ConversationClient } from "./conversation-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";
import { meetupPreview } from "./meetup-share";

async function store(): Promise<SecureSessionStore> {
  const value = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-04T00:00:00Z"));
  await value.write({ userAccountId:"user_1", principal:{type:"INDIVIDUAL",id:"user_1"}, auth:{sessionId:"s1",userAccountId:"user_1",principal:{type:"INDIVIDUAL",id:"user_1"},accessToken:"a",refreshToken:"r",accessExpiresAt:"2026-09-05T00:00:00Z",refreshExpiresAt:new Date(Date.now() + 2592000000).toISOString(),rotation:1} });
  return value;
}

describe("MEETUP-SHARE-001 sendLocationMessage wire", () => {
  it("sends LOCATION with encoded label+coords body", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendLocationMessage("conv_1", { lat: 21.0285, lng: 105.8542, label: "还剑湖" });
    const payload = sent[0]?.payload as Record<string,unknown>;
    expect(payload.messageType).toBe("LOCATION");
    expect(payload.body).toBe("还剑湖\n21.02850,105.85420");
    expect(payload.mediaRef).toBeUndefined();
  });

  it("invalid coords throw instead of sending a fake location", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await expect(client.sendLocationMessage("conv_1", { lat: 91, lng: 0 })).rejects.toThrow("invalid location");
    expect(sent).toHaveLength(0);
  });
});

describe("MEETUP-SHARE-001 inbox preview for LOCATION", () => {
  it("shows [位置] with label, falls back to raw body when undecodable", () => {
    expect(meetupPreview("还剑湖\n21.02850,105.85420")).toBe("[位置] 还剑湖");
    expect(meetupPreview("今晚见")).toBeUndefined();
  });
});
