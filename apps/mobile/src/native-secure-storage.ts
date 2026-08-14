import * as SecureStore from "expo-secure-store";
import { createExpoSecureStorageDriver } from "./expo-secure-storage";

/**
 * Production App driver. Expo maps this to iOS Keychain and Android Keystore.
 * The accessibility value is supplied by the native module rather than
 * duplicated as a magic number in the shared adapter.
 */
export const nativeSecureStorageDriver = createExpoSecureStorageDriver(SecureStore, {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
});
