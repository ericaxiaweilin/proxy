// R16.7-P1-G: banner the mobile shell renders when the
// operator has flipped a kill switch. We deliberately keep
// the component dumb: it takes a `LegalStatus` and renders
// the worst-offending switch. The shell is responsible for
// fetching the status at boot and re-fetching on every
// foreground event.
//
// Why a banner rather than a fullscreen overlay: the
// privacy / location / market subpages may still be
// reachable even when one category is killed, so the
// user benefits from a non-blocking indicator they can
// dismiss for the session.
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import {
  type LegalStatus,
  type LegalStatusCategory,
  isCategoryKilled,
} from "../legal-status-client";

export type LegalStatusBannerProps = {
  status: LegalStatus | null;
  // The user dismissed the banner for the current session.
  onDismiss?: () => void;
};

// bannerCategories lists the categories that are severe
// enough to warrant a top-of-screen banner. MARKETPLACE /
// PAYMENTS are not listed because they disable commerce, not
// information -- the intent was for those to surface
// in-context instead.
//
// KNOWN GAP (2026-09-21): that in-context "service paused"
// card does not exist. This comment used to assert it did.
// Nothing in apps/mobile/src handles the SERVICE_DISABLED 503
// the server returns when MARKETPLACE is killed, so a user who
// taps "order" while the switch is armed gets an unexplained
// failure. Adding "MARKETPLACE" to this list is the one-line
// stopgap, but it puts a commerce outage at the top of every
// unrelated screen -- which is what the split above was trying
// to avoid. Picking between those two is a product call.
const bannerCategories: ReadonlyArray<LegalStatusCategory> = [
  "GLOBAL",
  "AI_MEDIA",
  "LOCATION_CONSENT",
];

export function LegalStatusBanner({ status, onDismiss }: LegalStatusBannerProps): React.JSX.Element | null {
  const killed = useMemo(() => {
    if (!status) return null;
    for (const c of bannerCategories) {
      if (isCategoryKilled(status, c)) return c;
    }
    return null;
  }, [status]);

  if (!killed) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.text}>
        <Text selectable style={styles.title}>服务暂停 · {labelFor(killed)}</Text>
        <Text selectable style={styles.body}>{status?.killed[killed]?.reason ?? ""}</Text>
      </View>
      {onDismiss ? (
        <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.closeBtn}>
          <Text selectable style={styles.closeText}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function labelFor(category: LegalStatusCategory): string {
  switch (category) {
    case "GLOBAL":
      return "全部功能";
    case "AI_MEDIA":
      return "AI 媒体";
    case "MARKETPLACE":
      return "交易";
    case "LOCATION_CONSENT":
      return "精确位置";
    case "PAYMENTS":
      return "支付";
  }
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    backgroundColor: "#FEF3C7",
    borderColor: "#F59E0B",
    borderWidth: 1,
    borderRadius: 8,
    margin: 12,
  },
  text: { flex: 1, gap: 2 },
  title: { fontWeight: "600", color: "#92400E" },
  body: { fontSize: 12, color: "#92400E" },
  closeBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  closeText: { fontSize: 18, color: "#92400E" },
});
