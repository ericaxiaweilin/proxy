import { describe, expect, it } from "vitest";
import { AIAccountClient } from "./ai-account-client";

// AI-RECOMMEND-001: recommendations come from addressable server accounts.
describe("AIAccountClient", () => {
  it("loads active platform AI accounts", async () => {
    const client = new AIAccountClient({ requestPublic: async () => ({ status: 200, json: async () => ({ accounts: [{ accountId: "ai_account_001", personaId: "ai_001", handle: "xiaomei.qingqing", displayName: "晴晴", avatarPath: "ai-personas/photos/ai_001.png", description: "元气陪伴", role: "元气陪伴型", personality: "开朗", welcomeMessage: "你好", suggestedPrompts: ["陪我聊会儿", "分享开心小事"], ugcSamples: ["晚风很甜。", "认真喜欢生活。"], personaType: "PLATFORM_AI", status: "ACTIVE", aiStatus: "AI" }] }) }) });
    await expect(client.listRecommended()).resolves.toMatchObject([{ accountId: "ai_account_001", personaId: "ai_001" }]);
  });
});
