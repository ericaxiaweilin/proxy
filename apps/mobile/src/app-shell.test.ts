import { describe, expect, it } from "vitest";
import { resolveInitialRoute } from "./app-shell";

describe("mobile app shell", () => {
  it("fails closed for restricted sessions", () => {
    expect(resolveInitialRoute({ hasSession: true, isRestricted: true, isOffline: false })).toEqual({
      status: "RESTRICTED",
      initialRoute: "restricted"
    });
  });

  it("keeps an authenticated offline user in the offline shell", () => {
    expect(resolveInitialRoute({ hasSession: true, isRestricted: false, isOffline: true })).toEqual({
      status: "OFFLINE",
      initialRoute: "offline"
    });
  });
});
