import type { ImageSourcePropType } from "react-native";
import type { PlatformAIAccount } from "./ai-account-client";
import { localApiBaseUrl } from "./native-clients";

// Project-bound assets generated for the five Proxy AI accounts. The visible
// AI badge is rendered by surfaces rather than embedded into a photographic
// portrait, so it stays readable in every crop and accessibility context.
const photos: Record<string, ImageSourcePropType> = {
  ai_001: require("../assets/ai-personas/photos/ai_001.png"),
  ai_002: require("../assets/ai-personas/photos/ai_002.png"),
  ai_003: require("../assets/ai-personas/photos/ai_003.png"),
  ai_004: require("../assets/ai-personas/photos/ai_004.png"),
  ai_005: require("../assets/ai-personas/photos/ai_005.png")
};

export function aiPersonaPhoto(personaId: string): ImageSourcePropType {
  return photos[personaId] ?? photos.ai_001!;
}

/** Account/media data is authoritative. Bundled portraits are offline-only fallbacks. */
export function aiAccountPhoto(account: PlatformAIAccount): number | { uri: string } {
  if (account.avatarMediaAssetId) {
    const version = account.avatarVersion ?? 1;
    return { uri: `${localApiBaseUrl}/v1/media/thumb/${encodeURIComponent(account.avatarMediaAssetId)}?v=${version}` };
  }
  if (/^https?:\/\//.test(account.avatarPath)) return { uri: account.avatarPath };
  if (account.avatarPath.startsWith("/")) return { uri: `${localApiBaseUrl}${account.avatarPath}` };
  return photos[account.personaId] as number ?? photos.ai_001 as number;
}
