import { describe, expect, it } from "vitest";
import { isOwnPost, resolveAuthorDisplayName } from "./feed-author";

describe("FEED-OWN-001 different accounts never share the own-post label", () => {
  it("labels only the author's own posts as 你", () => {
    const mine = { authorId: "user_a", authorDisplayName: "A" };
    const theirs = { authorId: "user_b", authorDisplayName: "B" };
    expect(resolveAuthorDisplayName(mine, "user_a")).toBe("你");
    expect(resolveAuthorDisplayName(theirs, "user_a")).toBe("B");
    expect(isOwnPost(mine, "user_a")).toBe(true);
    expect(isOwnPost(theirs, "user_a")).toBe(false);
  });

  it("never trusts a stored 你 from another author (legacy poisoned rows)", () => {
    const poisoned = { authorId: "user_dev", authorDisplayName: "你" };
    // Other viewers see a neutral label, never "你" and never a raw id.
    expect(resolveAuthorDisplayName(poisoned, "user_new")).toBe("用户");
    expect(isOwnPost(poisoned, "user_new")).toBe(false);
    // The real author still sees their own post as "你" via author id.
    expect(resolveAuthorDisplayName(poisoned, "user_dev")).toBe("你");
    expect(isOwnPost(poisoned, "user_dev")).toBe(true);
  });

  it("is fail-closed without a viewer (guest / unrestored session)", () => {
    const poisoned = { authorId: "user_dev", authorDisplayName: "你" };
    expect(resolveAuthorDisplayName(poisoned, undefined)).toBe("用户");
    expect(isOwnPost(poisoned, undefined)).toBe(false);
  });

  it("falls back to a neutral label when no stored name exists", () => {
    expect(resolveAuthorDisplayName({ authorId: "user_b" }, "user_a")).toBe("用户");
    expect(resolveAuthorDisplayName({ authorId: "user_b", authorDisplayName: "  " }, "user_a")).toBe("用户");
    expect(resolveAuthorDisplayName({ authorId: "m1", authorType: "MERCHANT" }, "user_a")).toBe("商家");
    expect(resolveAuthorDisplayName({ authorId: "market_owner:你" }, "user_a")).toBe("用户");
  });
});
