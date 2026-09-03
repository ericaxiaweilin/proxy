import * as Crypto from "expo-crypto";
import type { SecureStorageDriver } from "./secure-session";

export const INSTALLATION_DEVICE_ID_KEY = "proxy.installation.device-id.v1";
export const INSTALLATION_DEVICE_CREDENTIAL_KEY = "proxy.installation.device-credential.v1";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateDeviceIdentity(driver: SecureStorageDriver): Promise<{
  deviceId: string;
  deviceCredential: string;
}> {
  let deviceId = await driver.getItem(INSTALLATION_DEVICE_ID_KEY);
  let deviceCredential = await driver.getItem(INSTALLATION_DEVICE_CREDENTIAL_KEY);
  if (!deviceId) {
    deviceId = `device_${Crypto.randomUUID()}`;
    await driver.setItem(INSTALLATION_DEVICE_ID_KEY, deviceId);
  }
  if (!deviceCredential) {
    deviceCredential = bytesToHex(await Crypto.getRandomBytesAsync(32));
    await driver.setItem(INSTALLATION_DEVICE_CREDENTIAL_KEY, deviceCredential);
  }
  return { deviceId, deviceCredential };
}

export async function rotateDeviceIdentity(driver: SecureStorageDriver): Promise<void> {
  await driver.setItem(INSTALLATION_DEVICE_ID_KEY, `device_${Crypto.randomUUID()}`);
  await driver.setItem(INSTALLATION_DEVICE_CREDENTIAL_KEY, bytesToHex(await Crypto.getRandomBytesAsync(32)));
}
