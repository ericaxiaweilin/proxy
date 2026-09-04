import type { SecureStorageDriver } from "./secure-session";
import type { SocialAccount } from "./surfaces/me-types";

const KEY = "proxy.social-settings.v1";
export type SocialSettingsRecord = { accounts: SocialAccount[]; merchant: boolean; profile: boolean; influence: boolean; collaborationEnabled?: boolean; collaborationTypes?: string[]; collaborationRate?: string; collaborationContact?: string };

export function createSocialSettingsStore(driver: SecureStorageDriver) {
  return {
    async read(): Promise<SocialSettingsRecord | undefined> {
      try {
        const raw = await driver.getItem(KEY);
        if (!raw) return undefined;
        const value = JSON.parse(raw) as SocialSettingsRecord;
        if (!Array.isArray(value.accounts) || typeof value.merchant !== "boolean" || typeof value.profile !== "boolean" || typeof value.influence !== "boolean") return undefined;
        return value;
      } catch { return undefined; }
    },
    async write(value: SocialSettingsRecord): Promise<void> { await driver.setItem(KEY, JSON.stringify(value)); }
  };
}
