import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SEND-NONBLOCK-001: 发完位置/图片必须等 AI 回复才能说下一句 —— 错的。
// 根因是 sending 按住 composer 直到长轮询返回（含 AI 生成）。修法：乐观
// 气泡上屏就放行 composer；在途回复只驱动"正在回复…"（计数器，多条并发
// 不早灭）；3s 轮询暂停保留到 settle（全量 hydrate 会闪掉乐观气泡）。
// 注释先剥掉再断言，只认代码。
const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const convoCode = stripComments(convo);

describe("SEND-NONBLOCK-001 sending never blocks the composer on AI replies", () => {
  it("canSend does not depend on any in-flight request", () => {
    // canSend 里一旦出现 !sending 之类的在途条件，输入框又会被按住。
    expect(convoCode).not.toContain("!sending");
    expect(convoCode).toContain("const canSend = (!!draft.trim()");
  });

  it("the typing indicator is driven by a pending-reply counter, not the composer lock", () => {
    // 布尔量会在两条并发发送时早灭，计数器不会。
    expect(convoCode).toContain("pendingReplies > 0 && aiAccount");
    expect(convoCode).toContain("setPendingReplies((n) => Math.max(0, n - 1))");
  });

  it("the 3s poll stays paused until each send settles", () => {
    // hydrate 是全量替换：在途时放轮询进来，乐观气泡会被闪掉、失败撤回会找错 id。
    expect(convoCode).toContain("if (!foreground || syncPausedRef.current) return;");
    expect(convoCode).toContain("syncPausedRef.current = true;");
  });

  it("image and video paint the optimistic bubble before uploading", () => {
    // 以前是上传+AI 全回来才上屏：发送端长时间空白、输入框还被锁。
    expect(convoCode).toContain("imageUri:picked.uri");
    expect(convoCode).toContain("videoUri:picked.uri");
  });
});
