/**
 * MEDIA-FILE-001 — honest fallback for media the app cannot render.
 *
 * Why this exists: when a media URL fails to load, expo-image renders nothing and
 * the frame's own background shows through. That background is
 * FRAME_BACKGROUND_HEX, a very dark tone chosen so photos "bleed" into the card.
 * The result is a solid black rectangle — visually indistinguishable from a real,
 * very dark photo. A broken media pipeline therefore looked like content: the feed
 * showed "black images" and neither the UI nor the logs said why.
 *
 * Two failure modes both land here:
 *   1. the server has no URL for the asset (no derivative file on disk), so the
 *      resolved uri is the empty string;
 *   2. the server promised a URL but the request failed (404, offline, decode).
 *
 * Rendering an explicit, labelled placeholder makes a missing object *look* like a
 * missing object. The frame keeps its aspect ratio, so the timeline layout does not
 * jump when the state changes.
 */
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";
import { SOCIAL_MEDIA_RADIUS } from "./social-media-aesthetics";

/**
 * Tracks whether a remote image failed to load, and resets when the uri changes
 * (for example after a viewport-driven variant swap or a feed refresh).
 */
export function useMediaLoadState(uri: string): { failed: boolean; onError: () => void } {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const onError = useCallback(() => setFailed(true), []);
  return { failed, onError };
}

/** True when a media item has no URL at all to attempt. */
export function isMediaUnavailable(uri: string, failed: boolean): boolean {
  return failed || uri === "";
}

export function UnavailableMedia({ label = "图片暂时无法显示" }: { label?: string }): React.JSX.Element {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={styles.root}
      testID="media-unavailable-v1"
    >
      <ProxyIcon color={color.muted} name="image" size={26} />
      <Text selectable style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: SOCIAL_MEDIA_RADIUS,
    flex: 1,
    gap: 8,
    justifyContent: "center"
  },
  label: {
    color: color.muted,
    fontSize: 12
  }
});
