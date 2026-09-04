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
});
