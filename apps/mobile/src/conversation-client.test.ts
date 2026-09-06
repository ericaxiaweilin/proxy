import { describe, expect, it } from "vitest";
import { ConversationClient } from "./conversation-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

async function store(): Promise<SecureSessionStore> {
  const value = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-04T00:00:00Z"));
  await value.write({ userAccountId:"user_1", principal:{type:"INDIVIDUAL",id:"user_1"}, auth:{sessionId:"s1",userAccountId:"user_1",principal:{type:"INDIVIDUAL",id:"user_1"},accessToken:"a",refreshToken:"r",accessExpiresAt:"2026-09-05T00:00:00Z",refreshExpiresAt:"2026-10-04T00:00:00Z",rotation:1} });
  return value;
}

describe("UI-CHAT-001 image message wire", () => {
  it("sends IMAGE with the uploaded storage reference and optional caption", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendImageMessage("conv_1", "mobile_media_image_1.jpg", "现场照片");
    const payload = sent[0]?.payload as Record<string,unknown>;
    expect(payload.messageType).toBe("IMAGE");
    expect(payload.mediaRef).toBe("mobile_media_image_1.jpg");
    expect(payload.body).toBe("现场照片");
  });

  it("sends VIDEO with the persisted media asset reference", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendVideoMessage("conv_1", "media_asset_video_1", "现场视频");
    const payload = sent[0]?.payload as Record<string,unknown>;
    expect(payload.messageType).toBe("VIDEO");
    expect(payload.mediaRef).toBe("media_asset_video_1");
    expect(payload.body).toBe("现场视频");
  });

  it("sends AUDIO with the persisted media asset reference", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendAudioMessage("conv_1", "media_asset_audio_1");
    const payload = sent[0]?.payload as Record<string,unknown>;
    expect(payload.messageType).toBe("AUDIO");
    expect(payload.mediaRef).toBe("media_asset_audio_1");
  });
});

describe("UI-CHAT-BLOCK-001 persistent conversation blocking", () => {
  it("sends the conversation id and desired blocked state", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.setConversationBlocked("conv_1", true);
    expect(sent[0]?.commandType).toBe("SetConversationBlocked");
    expect(sent[0]?.target).toEqual({ type:"Conversation", id:"conv_1" });
    expect(sent[0]?.payload).toEqual({ blocked:true });
  });
});

// CHAT-PROXY-ACTIVITY-001: R17.x — conversation "活动" 按钮发出的
// proxyObject 必须引用 server 真实 activityId (不能 "act_westlake"
// 那种 hardcoded 不存在的 ID). server 侧 conversation service 不会
// 验证 objectId 存在 (proxyObject 只是 message payload 字段), 但
// 客户端发送逻辑 要接受真实的 activityId, 不能是 hardcoded placeholder.
// 防"点聊天活动按钮 → 我的活动页看不到" 的两路径不能对齐问题.
describe("CHAT-PROXY-ACTIVITY-001 activity proxy uses real server IDs", () => {
  it("sendProxyObject accepts a real activityId and forwards it in both wire shapes", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    const realId = "merchant_photo_day";
    await client.sendProxyObject("conv_1", { objectType:"activity", objectId: realId, snapshot:{title:"木光咖啡 · 周日下午拍照季", time:"周日 15:00–17:00"} });
    const payload = sent[0]?.payload as Record<string,unknown>;
    expect(payload.proxyObject).toBeDefined();
    expect((payload.proxyObject as Record<string,unknown>).objectType).toBe("activity");
    expect((payload.proxyObject as Record<string,unknown>).objectId).toBe(realId);
  });
  it("does not default to a hardcoded fallback ID when caller omits objectId", async () => {
    // 旧 sendProxyObject 实现有 hardcoded "act_westlake" fallback. R17.x 后
    // 不允许 silent fallback — 如果 caller 不传 objectId, 必须报错 /
    // 不发, 而不是发一个隐含 "act_westlake".
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    // caller 在不提供 objectId 时 应该报错. 使用 fake proxyObject 跳过
    //  compile-time 类型检查, 验证运行时表现。
    const badCall = async () => client.sendProxyObject("conv_1", { objectType:"activity", objectId:"", snapshot:{} });
    // 空 objectId 会传到 server — server 不验证, 但 client 不能隐性代它为
    // 某 个 fallback ID. 这次测试验证 empty objectId 走过后, 收到的不是
    // hardcoded "act_westlake".
    await badCall();
    expect(sent).toHaveLength(1);
    const proxyObject = (sent[0]?.payload as Record<string,unknown>).proxyObject as Record<string,unknown>;
    expect(proxyObject.objectId).not.toBe("act_westlake");
  });
});
