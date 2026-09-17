import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// UNREAD-PIPELINE-001: 未读徽标和在线圆点在真实数据流里永远不亮 ——
// toDialog 根本不给 unread 赋值，打开会话也不上报已读。
// 修法：服务端算未读数下发（cursor 阅读位），端上映射＋打开标已读。
// 在线圆点没有数据源（全仓无在线设施），诚实方案是删掉它而不是编一个，
// 见本文件第二个 describe。注释先剥掉再断言，只认代码。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const messagesCode = stripComments(readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8"));
const convoCode = stripComments(readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8"));
const clientCode = stripComments(readFileSync(fileURLToPath(new URL("../conversation-client.ts", import.meta.url)), "utf8"));

describe("UNREAD-PIPELINE-001 unread badge finally has real data", () => {
  it("maps the server unread count onto the badge, hiding zero and unknown", () => {
    // >0 才挂 —— 0 和缺席（老服务端没算）都不画，不把“没有”画成“0 条未读”。
    expect(messagesCode).toContain("item.unreadCount !== undefined && item.unreadCount > 0");
    expect(clientCode).toContain("unreadCount?: number;");
  });

  it("reports read once after the first load, not on every poll", () => {
    // 跟着 3 秒轮询一起写等于每个用户每 3 秒写一次 cursor，而且正看着
    // 进来的新消息会被立刻灭掉。失败静默，下次打开重试。
    expect(clientCode).toContain("markDialogRead(conversationId: string)");
    expect(convoCode).toContain("markDialogRead(convId)");
  });

  it("drops the online dot instead of faking presence", () => {
    // 全仓没有任何在线设施（只有场景到场聚合，那是另一回事）。
    // 没数据源的圆点删掉，不留着装样子 —— presence 系统另立项。
    expect(messagesCode).not.toContain("online");
  });
});
