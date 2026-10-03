import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// STORE-SHARE-001（用户「分享店铺功能现在很弱，不能分享给系统内的用户」）：
// 以前只有一个系统分享（一段"去 Proxy 搜店名"的文字），站内好友收不到。
// 现在：店铺 vCard（X-PROXY-STORE）走 CONTACT 消息发到选中的站内会话，
// 对方在对话里看到同一张店名片（CONTACT-CARD-001 的渲染本来就认店卡）。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

describe("STORE-SHARE-001 分享店铺给站内好友", () => {
  it("店铺页有选人面板，走 CONTACT 发店名片", () => {
    const ui = read("./surfaces/merchant-storefront.tsx");
    expect(ui).toContain("发给站内好友");
    expect(ui).toContain("listConversations");
    expect(ui).toContain("sendContactMessage");
    // 发的是店铺 vCard，不是个人名片。
    expect(ui).toContain("buildContactCard({ name: storeName, storeId })");
    // hub 进来的作用域页（头图被 scope 藏掉）也有同一份入口和面板。
    expect(ui).toContain("renderSharePanel");
  });

  it("conversation client 从外壳一路透传下来", () => {
    expect(read("./shell/app-shell.tsx")).toContain("conversationClient={conversation}");
    const me = read("./surfaces/me.tsx");
    expect(me).toContain("conversationClient?: ConversationClient | undefined");
    const hub = read("./surfaces/my-stores-hub.tsx");
    expect(hub).toContain("conversationClient?: ConversationClient | undefined");
    expect(hub).toContain("conversationClient");
  });
});
