import { describe, expect, it } from "vitest";
import { avatarFileName, createProfileStore, DEFAULT_PROFILE, isProfileRecord, profileKeyFor } from "./profile-store";
import { InMemorySecureStorageDriver } from "./secure-session";

describe("isProfileRecord", () => {
  it("PROFILE-READ-001: fresh accounts never inherit the demo Huyen identity", () => {
    expect(DEFAULT_PROFILE.name.toLowerCase()).not.toBe("huyen");
    expect(DEFAULT_PROFILE.handle.toLowerCase()).not.toContain("huyen");
  });
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

  it("PROFILE-READ-001: scoped stores isolate accounts on one device", async () => {
    const driver = new InMemorySecureStorageDriver();
    const storeA = createProfileStore(driver, "user_a");
    const storeB = createProfileStore(driver, "user_b");
    await storeA.write({ ...DEFAULT_PROFILE, name: "A" });
    expect(await storeB.read()).toBeUndefined();
    expect((await storeA.read())?.name).toBe("A");
    expect(profileKeyFor("user_a")).toBe("proxy.profile.v1.user_a");
    expect(profileKeyFor(undefined)).toBe("proxy.profile.v1");
  });
});

// AVATAR-001: 头像只存文件名。iOS 重装 App 会换 container UUID，
// 绝对 file:// URI 下次必死； hydration 用不存在的 file.exists 还恒
// 为 falsy —— 之前每次冷启动都丢头像只剩字母头，名字简介却都在。
describe("avatarFileName", () => {
  it("strips a legacy absolute file URI down to the basename", () => {
    expect(
      avatarFileName("file:///var/mobile/Containers/Data/Application/UUID-OLD/Documents/proxy-profile/avatar-123.jpg")
    ).toBe("avatar-123.jpg");
  });

  it("keeps an already-relative stored name as-is", () => {
    expect(avatarFileName("avatar-456.jpg")).toBe("avatar-456.jpg");
  });

  it("falls back to the raw value when nothing parseable remains", () => {
    expect(avatarFileName("")).toBe("");
    expect(avatarFileName("///")).toBe("///");
  });
});

// AVATAR-SAVE-001: 「个人主页头像保存不上」的守门用例。
// 现象：选完照片头像看着变了，离开页面/重启回到字母头，且不报错。
// 根因面：me.tsx 外层 catch 静默吞错 + 本地落盘链路没有可验证的往返断言。
describe("AVATAR-SAVE-001 avatar persist round-trip", () => {
  it("keeps the avatar across write → read (survives relaunch)", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    await store.write({
      name: "Huyen",
      handle: "huyen.hanoi",
      bio: "hi",
      city: "河内",
      avatarPath: "avatar-777.jpg",
      updatedAt: "2026-09-12T00:00:00.000Z"
    });
    const read = await store.read();
    expect(read?.avatarPath).toBe("avatar-777.jpg");
  });

  it("normalizes a previously stored absolute sandbox URI to a bare file name", () => {
    expect(
      avatarFileName("file:///var/mobile/Containers/Data/Application/ABC/Documents/proxy-avatar-me.jpg")
    ).toBe("proxy-avatar-me.jpg");
  });

  it("clear() drops the persisted avatar so sign-out cannot leave a stale one", async () => {
    const store = createProfileStore(new InMemorySecureStorageDriver());
    await store.write({
      name: "Huyen",
      handle: "hanoi",
      bio: "hi",
      city: "河内",
      avatarPath: "avatar-999.jpg",
      updatedAt: "2026-09-12T00:00:00.000Z"
    });
    await store.clear();
    expect(await store.read()).toBeUndefined();
  });
});
