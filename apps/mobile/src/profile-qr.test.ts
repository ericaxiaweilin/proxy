// PROFILE-QR-002 tripwires: 二维码 payload 必须是 https 全量，坏 handle 不画坏码。
import { describe, expect, it } from "vitest";
import { inviteQrPayload, parseScannedQr, profileQrPayload, toQrPayload } from "./profile-qr";

describe("profileQrPayload", () => {
  it("PROFILE-QR-002: happy path emits https payload", () => {
    expect(profileQrPayload("linh")).toBe("https://proxy.app/@linh");
  });
  it("PROFILE-QR-002: strips leading @ and whitespace", () => {
    expect(profileQrPayload("  @linh  ")).toBe("https://proxy.app/@linh");
  });
  it("PROFILE-QR-002: empty handle fails closed", () => {
    expect(profileQrPayload("")).toBeNull();
    expect(profileQrPayload("   ")).toBeNull();
    expect(profileQrPayload("@@@")).toBeNull();
  });
  it("PROFILE-QR-002: illegal handle chars fail closed", () => {
    expect(profileQrPayload("a/b")).toBeNull();
    expect(profileQrPayload("x y")).toBeNull();
    expect(profileQrPayload("中文")).toBeNull();
  });
});

describe("toQrPayload", () => {  it("PROFILE-QR-002: bare proxy.app normalizes to https", () => {
    expect(toQrPayload("proxy.app/@linh")).toBe("https://proxy.app/@linh");
    expect(toQrPayload("proxy.app/store/m_1")).toBe("https://proxy.app/store/m_1");
  });
  it("PROFILE-QR-002: existing https passes through", () => {
    expect(toQrPayload("https://proxy.app/@linh")).toBe("https://proxy.app/@linh");
  });
  it("PROFILE-QR-002: unknown shapes pass through untouched", () => {
    expect(toQrPayload("proxy://x")).toBe("proxy://x");
  });
});

describe("inviteQrPayload", () => {
  it("PROFILE-QR-002: invite happy path emits https payload", () => {
    expect(inviteQrPayload("linh")).toBe("https://proxy.app/invite/linh");
  });
  it("PROFILE-QR-002: bad handle fails closed", () => {
    expect(inviteQrPayload("")).toBeNull();
    expect(inviteQrPayload("a/b")).toBeNull();
  });
});

describe("parseScannedQr", () => {
  it("PROFILE-QR-003: profile qr resolves to handle", () => {
    expect(parseScannedQr("https://proxy.app/@linh")).toEqual({ kind: "profile", handle: "linh", url: "https://proxy.app/@linh" });
  });
  it("PROFILE-QR-003: bare proxy.app normalizes before parse", () => {
    expect(parseScannedQr("proxy.app/@linh")?.handle).toBe("linh");
    expect(parseScannedQr("  proxy.app/invite/linh  ")?.kind).toBe("invite");
  });
  it("PROFILE-QR-003: non-proxy content fails closed, never null-crashes", () => {
    expect(parseScannedQr("")).toBeNull();
    expect(parseScannedQr("https://evil.com/@linh")).toBeNull();
    expect(parseScannedQr("https://proxy.app.evil.com/@linh")).toBeNull();
    expect(parseScannedQr("https://proxy.app/store/m_1")).toBeNull();
    expect(parseScannedQr("hello")).toBeNull();
  });
});
