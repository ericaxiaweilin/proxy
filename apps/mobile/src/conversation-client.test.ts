import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConversationClient, standInDraftFromList } from "./conversation-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

async function store(): Promise<SecureSessionStore> {
  const value = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-09-04T00:00:00Z"));
  await value.write({ userAccountId:"user_1", principal:{type:"INDIVIDUAL",id:"user_1"}, auth:{sessionId:"s1",userAccountId:"user_1",principal:{type:"INDIVIDUAL",id:"user_1"},accessToken:"a",refreshToken:"r",accessExpiresAt:"2026-09-05T00:00:00Z",refreshExpiresAt:new Date(Date.now() + 2592000000).toISOString(),rotation:1} });
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

describe("CONVO-001 message branch commands", () => {
  async function authedStore() { return store(); }

  it("creates a convo from a seed message", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await authedStore(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED",operationRef:JSON.stringify({convo:{id:"convo_1",parentDialogId:"conv_1",seedMessageId:"msg_1",title:"周六"}})})};}} });
    const convo = await client.createConvo("msg_1");
    expect(sent[0]?.commandType).toBe("CreateConvo");
    expect(sent[0]?.target).toEqual({ type:"Message", id:"msg_1" });
    expect(convo.id).toBe("convo_1");
  });

  it("lists my convos", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await authedStore(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED",operationRef:JSON.stringify({convos:[{convo:{id:"convo_1"},seedPreview:"hi",latestBody:"yo",latestAt:"2026-09-09",messageCount:2}]})})};}} });
    const convos = await client.listMyConvos();
    expect(sent[0]?.commandType).toBe("ListMyConvos");
    expect(convos).toHaveLength(1);
    expect(convos[0]?.latestBody).toBe("yo");
  });

  it("passes convoId through send and list", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await authedStore(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendMessage("conv_1", "branch reply", undefined, undefined, undefined, undefined, undefined, undefined, "convo_9");
    expect((sent[0]?.payload as Record<string,unknown>).convoId).toBe("convo_9");
    await client.listMessages("conv_1", "convo_9");
    expect((sent[1]?.payload as Record<string,unknown>).convoId).toBe("convo_9");
  });
});

// CONVO-INBOX-SWALLOW-001: listConversations 以前把读不出来的 payload 吞成 []。
// [] 和「真的没有会话」在 UI 上是同一件事 —— 加载失败会显示成「还没有对话」。
describe("CONVO-INBOX-SWALLOW-001", () => {
  it("a malformed inbox payload raises instead of looking empty", async () => {
    const client = new ConversationClient({
      baseUrl: "http://127.0.0.1:4100",
      secureSessionStore: await store(),
      authClient: { request: async () => ({ status: 200, json: async () => ({ outcome: "ACCEPTED", operationRef: "{not json" }) }) },
    });
    await expect(client.listConversations()).rejects.toThrow("list conversations response malformed");
  });

  it("a payload with no conversations array raises instead of looking empty", async () => {
    const client = new ConversationClient({
      baseUrl: "http://127.0.0.1:4100",
      secureSessionStore: await store(),
      authClient: { request: async () => ({ status: 200, json: async () => ({ outcome: "ACCEPTED", operationRef: JSON.stringify({ unexpected: 1 }) }) }) },
    });
    await expect(client.listConversations()).rejects.toThrow("list conversations response malformed");
  });

  it("a genuinely empty inbox is still an empty list, not an error", async () => {
    // 反向钉：修这个 bug 不能把「空的」也变成「坏的」。
    const client = new ConversationClient({
      baseUrl: "http://127.0.0.1:4100",
      secureSessionStore: await store(),
      authClient: { request: async () => ({ status: 200, json: async () => ({ outcome: "ACCEPTED", operationRef: JSON.stringify({ conversations: [] }) }) }) },
    });
    await expect(client.listConversations()).resolves.toEqual([]);
  });

  it("the client has no swallowing catch left and raises at every bad-payload path", () => {
    const source = readFileSync(fileURLToPath(new URL("./conversation-client.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("catch { return []; }");
    // 三处坏 payload 都要抛：没有 ref / JSON 坏了 / 解析出来不是数组。
    expect((source.match(/list conversations response malformed/g) ?? []).length).toBe(3);
  });

  it("the inbox screen does not render a failed load as 'no conversations'", () => {
    const screen = readFileSync(fileURLToPath(new URL("./surfaces/messages.tsx", import.meta.url)), "utf8");
    expect(screen).toContain(") : inboxError ? (");
    expect(screen).toContain("会话列表没读出来");
  });
});

// AI-MANAGE-013：每次确认的草稿 —— 只认 PENDING；发送时改过才带 body，没改就原样发。
describe("AI-MANAGE-013 stand-in drafts", () => {
  it("reads only a pending draft from the message list", () => {
    const draft = { draftId: "sid_1", conversationId: "c", ownerId: "user_1", inReplyTo: "m", body: "晚点回你", status: "PENDING", createdAt: "x" };
    expect(standInDraftFromList({ operationRef: JSON.stringify({ messages: [], standInDraft: draft }) })?.draftId).toBe("sid_1");
    expect(standInDraftFromList({ operationRef: JSON.stringify({ messages: [], standInDraft: null }) })).toBeUndefined();
    expect(standInDraftFromList({ operationRef: JSON.stringify({ standInDraft: { ...draft, status: "SENT" } }) })).toBeUndefined();
    expect(standInDraftFromList({ operationRef: "not json" })).toBeUndefined();
  });

  it("sends the draft as-is or with the owner's edit, and can discard it", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new ConversationClient({ baseUrl:"http://127.0.0.1:4100", secureSessionStore:await store(), authClient:{request:async (_path, init)=>{sent.push(init.body as Record<string,unknown>);return {status:200,json:async()=>({outcome:"ACCEPTED"})};}} });
    await client.sendStandInDraft("conv_1", "sid_1");
    await client.sendStandInDraft("conv_1", "sid_1", "  改过的  ");
    await client.discardStandInDraft("conv_1", "sid_2");
    expect(sent.map((c) => c.commandType)).toEqual(["SendStandInDraft", "SendStandInDraft", "DiscardStandInDraft"]);
    expect(sent[0]?.payload).toEqual({ draftId: "sid_1" });
    expect(sent[1]?.payload).toEqual({ draftId: "sid_1", body: "改过的" });
    expect(sent[2]?.payload).toEqual({ draftId: "sid_2" });
  });
});
