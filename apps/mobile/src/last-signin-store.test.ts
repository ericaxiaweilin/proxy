import { describe, expect, it } from "vitest";
import {
  avatarLetterFor,
  createLastSignInStore,
  maskIdentifier,
  type LastSignIn
} from "./last-signin-store";
import { InMemorySecureStorageDriver } from "./secure-session";

describe("last-signin-store", () => {
  it("round-trips a valid entry", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = createLastSignInStore(driver);
    const value: LastSignIn = {
      channel: "EMAIL",
      identifier: "thanh@gmail.com",
      signedInAt: "2026-09-01T10:00:00.000Z"
    };
    await store.write(value);
    expect(await store.read()).toEqual(value);
  });

  it("returns undefined when nothing is written", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = createLastSignInStore(driver);
    expect(await store.read()).toBeUndefined();
  });

  it("clears the entry", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = createLastSignInStore(driver);
    await store.write({
      channel: "SMS",
      identifier: "+84912345678",
      signedInAt: "2026-09-01T10:00:00.000Z"
    });
    await store.clear();
    expect(await store.read()).toBeUndefined();
  });

  it("rejects an invalid write", async () => {
    const driver = new InMemorySecureStorageDriver();
    const store = createLastSignInStore(driver);
    await expect(
      store.write({ channel: "INVALID" as unknown as "EMAIL", identifier: "x", signedInAt: "2026-09-01" })
    ).rejects.toThrow();
  });

  it("auto-clears malformed JSON and returns undefined", async () => {
    const driver = new InMemorySecureStorageDriver();
    await driver.setItem("proxy.lastSignIn.v1", "{not json");
    const store = createLastSignInStore(driver);
    expect(await store.read()).toBeUndefined();
  });

  it("auto-clears a payload with the wrong shape", async () => {
    const driver = new InMemorySecureStorageDriver();
    await driver.setItem("proxy.lastSignIn.v1", JSON.stringify({ channel: "EMAIL" /* missing identifier */ }));
    const store = createLastSignInStore(driver);
    expect(await store.read()).toBeUndefined();
  });
});

describe("maskIdentifier", () => {
  it("masks an email: shows first 2 chars + dots + full domain", () => {
    expect(maskIdentifier("EMAIL", "thanh@gmail.com")).toBe("th••••@gmail.com");
    expect(maskIdentifier("EMAIL", "a@x.com")).toBe("a••••@x.com");
  });

  it("falls back to the full string when there is no @", () => {
    expect(maskIdentifier("EMAIL", "not-an-email")).toBe("not-an-email");
  });

  it("masks a Vietnamese phone starting with 84", () => {
    expect(maskIdentifier("SMS", "+84912345678")).toBe("+84 •••• 5678");
    expect(maskIdentifier("SMS", "84912345678")).toBe("+84 •••• 5678");
  });

  it("masks a Vietnamese phone starting with 0", () => {
    expect(maskIdentifier("SMS", "0912345678")).toBe("0•••• 5678");
  });

  it("leaves short numbers unchanged", () => {
    expect(maskIdentifier("SMS", "123")).toBe("123");
  });
});

describe("avatarLetterFor", () => {
  it("takes the first uppercase letter of an email local part", () => {
    expect(avatarLetterFor("EMAIL", "thanh@gmail.com")).toBe("T");
    expect(avatarLetterFor("EMAIL", "anna@example.com")).toBe("A");
  });

  it("falls back to 'U' on empty local part", () => {
    expect(avatarLetterFor("EMAIL", "@gmail.com")).toBe("U");
  });

  it("uses the 4th-from-last digit for SMS", () => {
    // 越南手机号末 4 位是 tail, 取 tail 的第 1 位
    expect(avatarLetterFor("SMS", "+84912345678")).toBe("5");
  });
});
