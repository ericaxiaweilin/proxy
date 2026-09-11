import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

describe("two-account conversation live sync", () => {
  it("refreshes an open conversation while foregrounded and on resume", () => {
    const source = readFileSync(join(root, "surfaces", "conversation.tsx"), "utf8");
    // 切片基线对齐：refresh 路径改为 listMessages(convId, activeConvo?.id)
    // （Convo 分支读要带分支 id）。断言保留"刷新读的是当前会话消息"的意图，
    // 不钉死可选参数。
    expect(source).toContain("conversationClient.listMessages(convId");
    expect(source).toContain("setInterval(() => void refresh(), 3_000)");
    expect(source).toContain('AppState.addEventListener("change"');
    expect(source).toContain("clearInterval(timer)");
  });

  it("never lets polling erase a message while its AI reply is pending", () => {
    const source = readFileSync(join(root, "surfaces", "conversation.tsx"), "utf8");
    expect(source).toContain("if (!foreground || sendingRef.current) return");
    expect(source).toContain("await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))");
    expect(source).toContain("正在回复…");
  });

  it("refreshes the inbox without requiring navigation", () => {
    const source = readFileSync(join(root, "surfaces", "messages.tsx"), "utf8");
    expect(source).toContain("setInterval(() => { if (foreground) void refreshInbox(); }, 5_000)");
    expect(source).toContain('AppState.addEventListener("change"');
  });
});
