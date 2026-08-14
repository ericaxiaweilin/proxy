import type { SecureStorageDriver } from "./secure-session";
import type { SecureStoreOptions } from "expo-secure-store";

/**
 * Small surface of `expo-secure-store` used by the session boundary.
 *
 * The type is intentionally local so the contract package can be typechecked
 * before the Expo runtime is bootstrapped. The native entrypoint should pass
 * the imported `expo-secure-store` module to `createExpoSecureStorageDriver`.
 */
export type ExpoSecureStoreOptions = SecureStoreOptions;

export interface ExpoSecureStoreModule {
  getItemAsync(key: string, options?: ExpoSecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: ExpoSecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: ExpoSecureStoreOptions): Promise<void>;
}

/**
 * The native adapter supplies this policy from the Expo SecureStore constant
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. It is required at construction time
 * so a production host cannot silently fall back to the platform default.
 */
export class ExpoSecureStorageDriver implements SecureStorageDriver {
  public constructor(
    private readonly secureStore: ExpoSecureStoreModule,
    private readonly options: ExpoSecureStoreOptions
  ) {}

  public getItem(key: string): Promise<string | null> {
    return this.secureStore.getItemAsync(key, this.options);
  }

  public setItem(key: string, value: string): Promise<void> {
    return this.secureStore.setItemAsync(key, value, this.options);
  }

  public deleteItem(key: string): Promise<void> {
    return this.secureStore.deleteItemAsync(key, this.options);
  }
}

export function createExpoSecureStorageDriver(
  secureStore: ExpoSecureStoreModule,
  options: ExpoSecureStoreOptions
): SecureStorageDriver {
  return new ExpoSecureStorageDriver(secureStore, options);
}
