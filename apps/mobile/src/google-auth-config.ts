export type GoogleClientConfig = {
  iosClientId?: string | undefined;
  androidClientId?: string | undefined;
  webClientId?: string | undefined;
};

export function googleAuthConfigured(
  platform: "ios" | "android" | "web",
  config: GoogleClientConfig,
): boolean {
  if (!config.webClientId?.trim()) return false;
  if (platform === "ios") return Boolean(config.iosClientId?.trim());
  if (platform === "android") return Boolean(config.androidClientId?.trim());
  return true;
}
