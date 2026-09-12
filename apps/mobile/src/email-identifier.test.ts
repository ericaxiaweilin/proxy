import { describe, expect, it } from "vitest";
import { MAX_LOGIN_EMAIL_LENGTH, normalizeLoginEmail } from "./email-identifier";

describe("AUTH-EMAIL-LENGTH-001 registration and login email boundary", () => {
  it("accepts a complete email of exactly 50 characters", () => {
    const email = `${"a".repeat(38)}@example.com`;
    expect(email).toHaveLength(MAX_LOGIN_EMAIL_LENGTH);
    expect(normalizeLoginEmail(email)).toBe(email);
  });

  it("rejects a complete email longer than 50 characters", () => {
    expect(normalizeLoginEmail(`${"a".repeat(39)}@example.com`)).toBeUndefined();
  });

  it("counts the automatically appended Gmail suffix in the limit", () => {
    expect(normalizeLoginEmail("proxy.user")).toBe("proxy.user@gmail.com");
    expect(normalizeLoginEmail("a".repeat(41))).toBeUndefined();
  });
});
