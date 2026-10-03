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
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { color } from "../theme";
import {
  ALLOWED_DURATION_SECONDS,
  isActiveConsent,
  labelForDuration,
  summariseConsent,
  type LocationConsent,
  type ToggleLocale,
} from "./precise-location-toggle-helpers";
import { ProxyLoading } from "./proxy-foundation";
import { DEFAULT_LANGUAGE, useI18n } from "../i18n";

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
  // Language for the copy and the remaining-time string.
  // I18N-SAFETY-002：默认从 "vi" 改成 App 的默认语言（中文）—— 原来默认越南语，
  // 而整个 App 的 DEFAULT_LANGUAGE 是中文，两边不一致本身就是这处病的一部分。
  locale?: ToggleLocale;
};

export function PreciseLocationToggle(props: PreciseLocationToggleProps): React.JSX.Element {
  const { consent, busy, onGrant, onRevoke, errorMessage } = props;
  // 不写 props.locale ?? DEFAULT_LANGUAGE：这一屏有 useI18n()，语言状态就在
  // 那里。props.locale 保留是因为别处可能显式传（老调用点），有值就用它。
  const { lang, t } = useI18n();
  const locale = props.locale ?? lang ?? DEFAULT_LANGUAGE;
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

  const summary = useMemo(
    () => summariseConsent(consent, Date.now(), locale),
    [consent, locale],
  );

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
        <Text selectable style={styles.title}>{t("consentShareTitle")}</Text>
        <Text selectable style={styles.subtitle}>{t("consentDurationQuestion")}</Text>
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
              <Text selectable style={styles.choiceText}>{labelForDuration(d, locale)}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickingDuration(false)}
          disabled={busy}
        >
          <Text selectable style={styles.cancel}>{t("cancel")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text selectable style={styles.title}>{t("consentTitle")}</Text>
          <Text selectable style={styles.subtitle}>{summary}</Text>
        </View>
        {busy ? (
          <ProxyLoading tone="onLight" />
        ) : (
          <Switch
            accessibilityLabel={t("consentSwitchA11y")}
            value={active}
            onValueChange={handleToggle}
            disabled={busy}
          />
        )}
      </View>
      {errorMessage ? <Text selectable style={styles.error}>{errorMessage}</Text> : null}
      <Text selectable style={styles.footnote}>{t("consentFootnote")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: color.surface ?? color.white,
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
    backgroundColor: color.surface ?? color.white,
  },
  choicePressed: { opacity: 0.6 },
  choiceText: { fontSize: 15, color: color.ink ?? "#111111" },
  cancel: { marginTop: 12, textAlign: "center", color: color.muted ?? "#666666" },
  error: { color: "#C0392B", fontSize: 12 },
  footnote: { fontSize: 11, color: color.muted ?? "#888888", marginTop: 4 },
});
