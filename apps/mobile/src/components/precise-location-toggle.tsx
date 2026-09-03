// R16.7-P1-J: precise-location consent toggle. Renders a switch
// the user can flip to grant or revoke precise-location access.
// The component is a pure projection of the LocationConsent
// shape from the client; the calling screen is responsible for
// fetching and mutating state.
//
// Why a separate component file: the privacy-settings card
// (R16.10) already owns a similar "data export / delete"
// control. Splitting this one out keeps the privacy card
// readable and makes it easy to drop the toggle into other
// surfaces (e.g. the feed composer when the user first attaches
// a location).
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { color } from "../theme";
import {
  ALLOWED_DURATION_SECONDS,
  formatRemaining,
  isActiveConsent,
  type LocationConsent,
} from "../location-consent-client";

export type PreciseLocationToggleProps = {
  // The current consent state. null = loading or unknown.
  consent: LocationConsent | null;
  // True while a network mutation is in flight.
  busy: boolean;
  // The user grants consent. The duration in seconds is picked
  // by the UI; the parent owns the choice.
  onGrant: (durationSeconds: number) => void;
  // The user revokes consent.
  onRevoke: () => void;
  // The most recent error, if any. Cleared on the next render.
  errorMessage?: string;
  // Locale for the remaining-time string. Defaults to "vi".
  locale?: "vi" | "zh";
};

export function PreciseLocationToggle(props: PreciseLocationToggleProps): React.JSX.Element {
  const { consent, busy, onGrant, onRevoke, errorMessage, locale = "vi" } = props;
  const [pickingDuration, setPickingDuration] = useState(false);

  const active = useMemo(() => isActiveConsent(consent), [consent]);
  const remaining = useMemo(() => {
    if (!consent || !active) return 0;
    if (consent.remainingSeconds > 0) return consent.remainingSeconds;
    // Defensive: if the server hasn't swept yet, derive from
    // expiresAt so the UI never shows a negative count.
    if (consent.expiresAt) {
      const ms = Date.parse(consent.expiresAt) - Date.now();
      return Math.max(0, Math.floor(ms / 1000));
    }
    return 0;
  }, [consent, active]);

  const handleToggle = (next: boolean) => {
    if (busy) return;
    if (next) {
      setPickingDuration(true);
      return;
    }
    onRevoke();
  };

  if (pickingDuration) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Chia sẻ vị trí chính xác</Text>
        <Text style={styles.subtitle}>Bạn muốn cho phép trong bao lâu?</Text>
        <View style={styles.row}>
          {ALLOWED_DURATION_SECONDS.map((d) => (
            <Pressable
              key={d}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.choice,
                pressed ? styles.choicePressed : null,
              ]}
              disabled={busy}
              onPress={() => {
                setPickingDuration(false);
                onGrant(d);
              }}
            >
              <Text style={styles.choiceText}>{labelForDuration(d, locale)}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickingDuration(false)}
          disabled={busy}
        >
          <Text style={styles.cancel}>Hủy</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Vị trí chính xác</Text>
          <Text style={styles.subtitle}>
            {active
              ? `Đang bật · ${formatRemaining(remaining, locale)}`
              : "Đang tắt"}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={color.ink} />
        ) : (
          <Switch
            accessibilityLabel="Bật hoặc tắt vị trí chính xác"
            value={active}
            onValueChange={handleToggle}
            disabled={busy}
          />
        )}
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Text style={styles.footnote}>
        Theo PDP Việt Nam 91/2025/QH15 Art. 4 & 12 — vị trí chính xác là dữ liệu nhạy cảm.
        Bạn có thể thu hồi bất kỳ lúc nào.
      </Text>
    </View>
  );
}

function labelForDuration(seconds: number, locale: "vi" | "zh"): string {
  if (seconds === 30 * 60) {
    return locale === "vi" ? "30 phút" : "30 分钟";
  }
  if (seconds === 8 * 60 * 60) {
    return locale === "vi" ? "8 giờ" : "8 小时";
  }
  // Fallback for unexpected values; should never fire because
  // the client validates against ALLOWED_DURATION_SECONDS.
  return `${Math.round(seconds / 60)}m`;
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: color.surface ?? "#FFFFFF",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line ?? "#E5E5E5",
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "600", color: color.ink ?? "#111111" },
  subtitle: { fontSize: 13, color: color.muted ?? "#666666" },
  row: { flexDirection: "row", gap: 12, marginTop: 8 },
  choice: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line ?? "#E5E5E5",
    alignItems: "center",
    backgroundColor: color.surface ?? "#FFFFFF",
  },
  choicePressed: { opacity: 0.6 },
  choiceText: { fontSize: 15, color: color.ink ?? "#111111" },
  cancel: { marginTop: 12, textAlign: "center", color: color.muted ?? "#666666" },
  error: { color: "#C0392B", fontSize: 12 },
  footnote: { fontSize: 11, color: color.muted ?? "#888888", marginTop: 4 },
});
