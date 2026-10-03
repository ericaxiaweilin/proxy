// R16.7-P1-J: wrapper around PreciseLocationToggle that owns the
// fetch / mutate state. Mirrors PrivacySettings: takes a
// LocationConsentClient (which holds the auth-aware transport),
// fetches the current status on mount, and re-fetches after
// every grant / revoke. The internal toggle is the dumb
// projection.
//
// Why a wrapper: the me.tsx subpage already imports a handful
// of stateful cards (PrivacySettings, SecuritySettings,
// CreatorInvitationCard). Each owns its own network state so
// the me.tsx render path stays declarative.
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { getLanguage, translate, type MessageKey } from "../i18n";
import {
  type LocationConsent,
  type LocationConsentClient,
  LocationConsentError,
} from "../location-consent-client";
import { PreciseLocationToggle } from "./precise-location-toggle";

export type PreciseLocationCardProps = {
  client: LocationConsentClient;
  // Skip the initial GET. Used by vitest to keep unit tests
  // deterministic.
  skipInitialFetch?: boolean;
};

// I18N-SAFETY-002：这三句原来写死**越南语**，而同一屏下方的 fuzzy-location-card
// 写死中文。于是「位置与隐私」这一屏在中越之间混排 —— 一个中文用户在中文
// 界面里会读到三句越南语的错误提示。
//
// 拆成「原因」而不是「句子」是为了渲染时再翻译（HOME-I18N-001 的形状）：
// 错误还挂在屏幕上的时候切语言，那句话必须跟着换。存串的话它停在旧语言。
//
// 服务端 message（raw）**不**翻译：那是服务端返回的原文，客户端不该编造另一
// 种说法。客户端只对自己这三条负责。
type ErrorCause =
  | { kind: "key"; key: MessageKey }
  | { kind: "raw"; raw: string };

function errorCauseFor(e: unknown): ErrorCause {
  if (e instanceof LocationConsentError) {
    if (e.httpStatus === 401) return { kind: "key", key: "consentSessionExpired" };
    if (e.httpStatus === 400) return { kind: "key", key: "consentRejected" };
    return { kind: "raw", raw: e.message };
  }
  if (e instanceof Error) return { kind: "raw", raw: e.message };
  return { kind: "key", key: "consentGenericError" };
}

function errorText(cause: ErrorCause): string {
  return cause.kind === "raw" ? cause.raw : translate(getLanguage(), cause.key);
}

export function PreciseLocationCard({ client, skipInitialFetch }: PreciseLocationCardProps): React.JSX.Element {
  const [consent, setConsent] = useState<LocationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCause | null>(null);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await client.getStatus();
        if (!cancelled) setConsent(next);
      } catch (e) {
        if (!cancelled) setError(errorCauseFor(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, skipInitialFetch]);

  const handleGrant = async (durationSeconds: number) => {
    setBusy(true);
    setError(null);
    try {
      const next = await client.grant(durationSeconds);
      setConsent(next);
    } catch (e) {
      setError(errorCauseFor(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.revoke();
      // Re-fetch so the row reflects the just-flipped state
      // (the revoke response is small and does not include the
      // full consent object).
      const next = await client.getStatus();
      setConsent(next);
    } catch (e) {
      setError(errorCauseFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <PreciseLocationToggle
        consent={consent}
        busy={busy}
        onGrant={handleGrant}
        onRevoke={handleRevoke}
        {...(error ? { errorMessage: errorText(error) } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
  },
});

// Re-export the underlying toggle for tests / advanced consumers.
export { PreciseLocationToggle } from "./precise-location-toggle";