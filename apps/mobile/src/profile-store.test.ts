import { describe, expect, it } from "vitest";
import { createProfileStore, DEFAULT_PROFILE, isProfileRecord } from "./profile-store";
import { InMemorySecureStorageDriver } from "./secure-session";

describe("isProfileRecord", () => {
  it("accepts a valid record", () => {
    const ok = {
      name: "Huyen",
      handle: "huyen.hanoi",
      bio: "hi",
      city: "河内",
      avatarPath: "avatars/me.jpg",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    expect(isProfileRecord(ok)).toBe(true);
  });

  it("accepts a record with no avatar", () => {
    const ok = {
      name: "Huyen",
      handle: "huyen.hanoi",
      bio: "hi",
      city: "河内",
      avatarPath: undefined,
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    expect(isProfileRecord(ok)).toBe(true);
  });

  it("rejects non-object / missing fields / oversize", () => {
    expect(isProfileRecord(null)).toBe(false);
    expect(isProfileRecord("string")).toBe(false);
    expect(isProfileRecord({ ...DEFAULT_PROFILE, name: "" })).toBe(false);
    expect(isProfileRecord({ ...DEFAULT_PROFILE, name: "x".repeat(61) })).toBe(false);
    expect(isProfileRecord({ ...DEFAULT_PROFILE, avatarPath: "" })).toBe(false);
    expect(isProfileRecord({ ...DEFAULT_PROFILE, avatarPath: 123 })).toBe(false);
    expect(isProfileRecord({ ...DEFAULT_PROFILE, updatedAt: "" })).toBe(false);
  });
});

describe("createProfileStore", () => {
  it("returns undefined when nothing stored", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    expect(await store.read()).toBeUndefined();
  });

  it("round-trips a record", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    const record = {
      name: "Linh",
      handle: "linh.hn",
      bio: "西湖见",
      city: "Hanoi",
      avatarPath: "avatars/u1.jpg",
      updatedAt: "2026-09-01T12:00:00.000Z"
    };
    await store.write(record);
    expect(await store.read()).toEqual(record);
  });

  it("rejects invalid record on write", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    await expect(store.write({ ...DEFAULT_PROFILE, name: "" })).rejects.toThrow();
  });

  it("drops malformed stored data and returns undefined", async () => {
    const driver = new InMemorySecureStorageDriver();
    await driver.setItem("proxy.profile.v1", "{not json");
    const store = createProfileStore(driver);
    expect(await store.read()).toBeUndefined();
  });

  it("clear removes the record", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    await store.write({ ...DEFAULT_PROFILE, name: "X" });
    await store.clear();
    expect(await store.read()).toBeUndefined();
  });
});
