import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// PROFILE-COPY-UID-001（2026-10-02，用户「帖文主页为什么不能手动复制用户ID，
// 支持长按复制」）：selectable 靠系统原生选词，时灵时不灵。改显式长按复制。
describe("PROFILE-COPY-UID-001 帖文主页长按复制用户 ID", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./surfaces/other-profile.tsx", import.meta.url)),
    "utf8"
  );

  it("handle 有显式长按复制，不是只靠 selectable", () => {
    expect(src).toContain("onLongPress");
    expect(src).toContain("Clipboard.setStringAsync(target.userId)");
    expect(src).toContain('accessibilityHint="长按复制"');
  });

  it("复制完有明确反馈，不靠猜", () => {
    expect(src).toContain("copiedUid");
    expect(src).toContain("已复制用户 ID");
  });

  it("反馈字号不低于 11pt（设计系统下限）", () => {
    expect(src).toMatch(/copiedHint:\{[^}]*fontSize: ?11/);
  });
});
