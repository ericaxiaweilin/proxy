import { describe, expect, it } from "vitest";
import { googleAuthConfigured } from "./google-auth-config";

describe("googleAuthConfigured", () => {
  it("fails closed when the native client id is absent", () => {
    expect(googleAuthConfigured("ios", { webClientId: "web" })).toBe(false);
    expect(googleAuthConfigured("android", { webClientId: "web" })).toBe(false);
  });

  it("requires the web client id used to exchange the identity token", () => {
    expect(googleAuthConfigured("ios", { iosClientId: "ios" })).toBe(false);
  });

  it("enables only a completely configured platform", () => {
    expect(googleAuthConfigured("ios", { iosClientId: "ios", webClientId: "web" })).toBe(true);
    expect(googleAuthConfigured("android", { androidClientId: "android", webClientId: "web" })).toBe(true);
  });
});
