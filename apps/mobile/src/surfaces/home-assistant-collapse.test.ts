import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./home-assistant.tsx", import.meta.url), "utf8");
const keyboardSafe = readFileSync(new URL("../components/use-keyboard-safe-inset.ts", import.meta.url), "utf8");

describe("Home embedded assistant persistence contract", () => {
  it("closes explicitly without leaving a redundant received-message strip", () => {
    expect(source).toContain('accessibilityLabel="收起 Home 对话"');
    expect(source).not.toContain('accessibilityLabel="总结并结束 Home 会话"');
    expect(source).not.toContain("finishEvent");
    expect(source).not.toContain('accessibilityLabel="继续和 Proxy 对话"');
    expect(source).not.toContain("collapsedBar");
  });

  it("uses one send action and a compact default window", () => {
    expect(source).toContain("height: 350");
    expect(source).not.toContain("请把本次 Home 事件整理成一段简洁总结");
  });

  it("hydrates the same durable timeline including Home dividers", () => {
    expect(source).toContain("conversationClient.listMessages(payload.conversationId)");
    expect(source).toContain("readAssistantHistory(historyResult)");
    expect(source).toContain('messageType === "SYSTEM_CONTEXT"');
    expect(source).toContain("styles.timelineDivider");
  });

  it("dismisses the keyboard after a follow-up send settles", () => {
    expect(source).toMatch(/finally \{[\s\S]*?setSending\(false\);[\s\S]*?Keyboard\.dismiss\(\)/);
  });

  it("keeps one durable Proxy AI origin without timed clearing", () => {
    expect(source).toContain('originId: "proxy_ai_home"');
    expect(source).not.toContain("}, 6000)");
    expect(source).not.toContain("}, 9000)");
  });

  it("uses the shared keyboard overlap source so the composer stays visible", () => {
    expect(source).toContain("useKeyboardSafeInset()");
    expect(source).toContain("keyboardInset > 0 && { paddingBottom: keyboardInset }");
    expect(keyboardSafe).toContain('Keyboard.addListener("keyboardWillChangeFrame"');
    expect(keyboardSafe).toContain("windowHeight - event.endCoordinates.screenY");
  });
});
