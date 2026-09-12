import type { ImageSourcePropType } from "react-native";
import type { PlatformAIAccount } from "./ai-account-client";
import { localApiBaseUrl } from "./native-clients";
import { aiPersonaBundledPhoto } from "./media/asset-sources";

// MEDIA-PIPELINE-001: 此模块保留历史导出名，实现转调统一资产层。
// 打包人像注册表唯一来源是 media/asset-sources（门禁钉住）。

export function aiPersonaPhoto(personaId: string): ImageSourcePropType {
  return aiPersonaBundledPhoto(personaId) as ImageSourcePropType;
}

/** Account/media data is authoritative. Bundled portraits are offline-only fallbacks. */
export function aiAccountPhoto(account: PlatformAIAccount): number | { uri: string } {
  if (account.avatarMediaAssetId) {
    const version = account.avatarVersion ?? 1;
    return { uri: `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(account.avatarMediaAssetId)}?v=${version}` };
  }
  if (/^https?:\/\//.test(account.avatarPath)) return { uri: account.avatarPath };
  if (account.avatarPath.startsWith("/")) return { uri: `${localApiBaseUrl}${account.avatarPath}` };
  return aiPersonaBundledPhoto(account.personaId) as number;
}
