import { describe, expect, it } from "vitest";
import { mapEngagementError } from "./feed-error-map";
import { OfflineFallbackSessionError, SignedOutSessionError } from "../secure-session";
import { EngagementProtocolError } from "../engagement-client";
import { SessionExpiredError } from "../auth-client";

describe("mapEngagementError", () => {
  const fallback = "互动没有提交成功，请检查连接后重试。";

  it("maps OfflineFallbackSessionError to a sign-in hint", () => {
    expect(mapEngagementError(new OfflineFallbackSessionError(), fallback)).toContain("请登录");
  });

  it("maps SignedOutSessionError to a sign-in hint (R15.39)", () => {
    expect(mapEngagementError(new SignedOutSessionError(), fallback)).toContain("请登录");
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

  it("maps signedOut-style error message to a sign-in hint (R15.39)", () => {
    const err = new Error("user is signed out — re-authenticate to perform write operations");
    expect(mapEngagementError(err, fallback)).toContain("请登录");
  });

  it("maps 'principal required' message to a sign-in hint (R15.38.1)", () => {
    // 刚从 R15.38 修过的: fresh guest 走 engagement-client requireSession,
    //   keychain 完全空, 抛 EngagementProtocolError("an authenticated principal is required")。
    //   之前的 mapEngagementError 没认识这个, 误判为 “网络问题”, 提示
    //   走错。补上这个判断。
    const err = new Error("an authenticated principal is required");
    expect(mapEngagementError(err, fallback)).toContain("请登录");
  });

  it("maps SessionExpiredError to a re-login hint (R15.38.2)", () => {
    // auth-client 在 server 拒接 (401/403) 且 refresh 失败后 扊 keychain,
    //   扊不掉走 authClient.request() 调 engagement 的时候。
    //   之前的 mapEngagementError 误为 “网络问题”。
    const err = new SessionExpiredError();
    expect(mapEngagementError(err, fallback)).toContain("重新登录");
  });

  it("maps server 500 'command_transaction_failed' to a server-error hint (R15.38.4)", () => {
    // R15.38.4: server 返回 500 + 非 commandResult 格式的 body
    //   {"error":"command_transaction_failed"}, engagement-client 抛
    //   EngagementProtocolError, 文案里含 "command_transaction_failed"。
    //   之前的 mapEngagementError 走到 fallback “检查连接” — 误导。
    const err = new Error("engagement command response was malformed (status=500): {\"error\":\"command_transaction_failed\"}");
    const result = mapEngagementError(err, fallback);
    expect(result).toContain("服务器");
    expect(result).not.toContain("请检查连接");
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
