import { describe, expect, it, vi } from "vitest";
import {
  ExpoSecureStorageDriver,
  type ExpoSecureStoreModule
} from "./expo-secure-storage";

describe("Expo SecureStore driver", () => {
  it("maps the session driver to native SecureStore calls", async () => {
    const native: ExpoSecureStoreModule = {
      getItemAsync: vi.fn(async () => "stored-session"),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined)
    };
    const options = { keychainAccessible: 7 };
    const driver = new ExpoSecureStorageDriver(native, options);

    await expect(driver.getItem("proxy.secure.session.v1")).resolves.toBe("stored-session");
    await driver.setItem("proxy.secure.session.v1", "next-session");
    await driver.deleteItem("proxy.secure.session.v1");

    expect(native.getItemAsync).toHaveBeenCalledWith("proxy.secure.session.v1", options);
    expect(native.setItemAsync).toHaveBeenCalledWith(
      "proxy.secure.session.v1",
      "next-session",
      options
    );
    expect(native.deleteItemAsync).toHaveBeenCalledWith(
      "proxy.secure.session.v1",
      options
    );
  });

  it("allows a host to provide an explicit native accessibility policy", async () => {
    const native: ExpoSecureStoreModule = {
      getItemAsync: vi.fn(async () => null),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined)
    };
    const options = { keychainAccessible: 11 } as const;
    const driver = new ExpoSecureStorageDriver(native, options);

    await driver.setItem("proxy.secure.session.v1", "session");

    expect(native.setItemAsync).toHaveBeenCalledWith("proxy.secure.session.v1", "session", options);
  });
});
