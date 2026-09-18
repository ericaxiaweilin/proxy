import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// QUOTE-REPLY-001: 引用以前只是本地文字快照 —— SendMessage 根本没往服务端
// 发，对方收不到引用、AI 拿不到上下文。改成 ID 引用：发送带 replyToMessageId，
// 服务端落库 reply_to 并校验同会话，hydrate 按 ID 解析、找不到就不画引用块。
// 注释先剥掉再断言，只认代码。
const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const convoCode = stripComments(convo);
const client = readFileSync(fileURLToPath(new URL("../conversation-client.ts", import.meta.url)), "utf8");
const clientCode = stripComments(client);

describe("QUOTE-REPLY-001 quotes travel by message ID, not by copied text", () => {
  it("sends the quoted message ID to the server", () => {
    expect(clientCode).toContain("replyToMessageId");
    expect(convoCode).toContain("replyTo ? replyTo.id : undefined");
    // 快照随身带只做乐观显示和降级，ID 才是契约。
    expect(convoCode).toContain("replyToMessageId: replyTo.id");
  });

  it("resolves quote blocks by ID against the hydrated list and hides the unresolvable", () => {
    expect(convoCode).toContain("byId.get(m.replyToMessageId)");
    // 被删/窗口外：保持 undefined，引用块直接不画 —— 不猜不藏。
    expect(convoCode).toContain("if (!quoted) return m;");
  });

  it("translates server quote rejections and keeps the quote for retry", () => {
    expect(convoCode).toContain("reply_target_not_found");
    expect(convoCode).toContain("reply_target_foreign");
    expect(convoCode).toContain("if (replyTo) setReplyTo(replyTo)");
  });
});
