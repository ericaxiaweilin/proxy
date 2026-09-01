import { describe, expect, it } from "vitest";
import { mapEngagementError } from "./feed-error-map";
import { OfflineFallbackSessionError } from "../secure-session";
import { EngagementProtocolError } from "../engagement-client";

describe("mapEngagementError", () => {
  const fallback = "互动没有提交成功，请检查连接后重试。";

  it("maps OfflineFallbackSessionError to a sign-in hint", () => {
    expect(mapEngagementError(new OfflineFallbackSessionError(), fallback)).toContain("请登录");
  });

  it("maps EngagementProtocolError with offline-fallback message to a sign-in hint", () => {
    // 之前 R15.34.1 阶段 engagement-client 抛的是
    // EngagementProtocolError, message 含 "offline session cannot"。
    // R15.38 改为抛 OfflineFallbackSessionError, 但老路径 (老 bundle
    // / 其他 client) 仍可能送来这类 message — message-based fallback 覆盖。
    const err = new EngagementProtocolError("engagement actions require a real sign-in (offline session cannot react)");
    expect(mapEngagementError(err, fallback)).toContain("请登录");
  });

  it("maps LocalNetProtocolError 'publishing requires a real sign-in' to a sign-in hint", () => {
    // 发帖路径的 fallback message。
    const err = new Error("publishing requires a real sign-in (offline session cannot post)");
    expect(mapEngagementError(err, fallback)).toContain("请登录");
  });

  it("falls back to original message for unknown errors", () => {
    expect(mapEngagementError(new Error("network timeout"), fallback)).toBe(fallback);
  });

  it("falls back for non-Error throws (string)", () => {
    expect(mapEngagementError("weird string", fallback)).toBe(fallback);
  });

  it("falls back for null/undefined", () => {
    expect(mapEngagementError(null, fallback)).toBe(fallback);
    expect(mapEngagementError(undefined, fallback)).toBe(fallback);
  });
});
