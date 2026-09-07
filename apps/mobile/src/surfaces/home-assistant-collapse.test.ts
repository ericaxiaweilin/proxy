import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./home-assistant.tsx", import.meta.url), "utf8");

describe("Home embedded assistant collapse contract", () => {
  it("keeps a resumable one-line state and an explicit collapse action", () => {
    expect(source).toContain('accessibilityLabel="收起 Home 对话"');
    expect(source).toContain('accessibilityLabel="继续和 Proxy 对话"');
    expect(source).toContain("numberOfLines={1}");
  });

  it("auto-collapses only after settled inactivity, never from keyboard position", () => {
    expect(source).toMatch(/!embedded \|\| collapsed \|\| inputFocused \|\| loading \|\| sending \|\| temporaryUI/);
    expect(source).toContain("}, 9000)");
    expect(source).not.toMatch(/keyboard.*height|screenY|pageY/i);
  });

  it("dismisses the keyboard after a follow-up send settles", () => {
    expect(source).toMatch(/finally \{[\s\S]*?setSending\(false\);[\s\S]*?Keyboard\.dismiss\(\)/);
  });
});
