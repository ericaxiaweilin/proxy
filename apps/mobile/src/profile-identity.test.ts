import { describe, expect, it } from "vitest";
import { deriveProfileFromIdentifier } from "./profile-identity";

describe("PROFILE-READ-001 fresh accounts derive identity from their own identifier", () => {
  it("derives name and handle from an email login", () => {
    expect(deriveProfileFromIdentifier("nguyenthanhhuyen@gmail.com", "EMAIL")).toEqual({
      name: "nguyenthanhhuyen",
      handle: "@nguyenthanhhuyen",
      bio: "",
      city: "河内"
    });
  });

  it("never shows the hardcoded demo identity", () => {
    const derived = deriveProfileFromIdentifier("nguyenthanhhuyen@gmail.com", "EMAIL");
    expect(derived.name).not.toBe("Huyen");
    expect(derived.handle).not.toBe("huyen.hanoi");
  });

  it("keeps phone identifiers out of the public name", () => {
    const derived = deriveProfileFromIdentifier("0912345678", "SMS");
    expect(derived.name).toBe("用户");
    expect(derived.handle).toBe("@user5678");
    expect(derived.handle).not.toContain("0912345678");
  });

  it("falls back to neutral without an identifier", () => {
    expect(deriveProfileFromIdentifier(undefined, undefined)).toEqual({
      name: "用户",
      handle: "@user",
      bio: "",
      city: "河内"
    });
  });
});
