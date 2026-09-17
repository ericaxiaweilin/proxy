import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NOTIF-INVITE-OFFER-001（移动端一半）：邀请卡片的“询问”按钮是个空壳 ——
// 点它只是把状态从 PENDING 改成 ASK，用户根本没有地方输入“想问什么”，
// 跟拒绝没有实质区别。按死按钮纪律删掉（PLACEHOLDER-001 同款处理），
// 而不是留着骗人。真要“先问问”，走开聊那条真链路。
// 服务端仍接受 ASK（已有邀请走这条路不能炸），只是客户端不再发送。
const me = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(me);

describe("NOTIF-INVITE-OFFER-001 the ask button is gone, accept/decline stay wired", () => {
  it("offers no dead ask action on invitations", () => {
    expect(meCode).not.toContain('respond(row.invitationId, "ASK")');
    expect(meCode).not.toContain(">询问</Text>");
  });

  it("keeps accept and decline sending real decisions", () => {
    expect(meCode).toContain('respond(row.invitationId, "ACCEPTED")');
    expect(meCode).toContain('respond(row.invitationId, "DECLINED")');
  });
});
