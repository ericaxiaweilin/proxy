import type { ImageSourcePropType } from "react-native";

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
