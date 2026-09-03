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

export function PreciseLocationCard({ client, skipInitialFetch }: PreciseLocationCardProps): React.JSX.Element {
  const [consent, setConsent] = useState<LocationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await client.getStatus();
        if (!cancelled) setConsent(next);
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
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
      setError(messageFor(e));
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
      setError(messageFor(e));
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
        {...(error ? { errorMessage: error } : {})}
      />
    </View>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof LocationConsentError) {
    if (e.httpStatus === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (e.httpStatus === 400) return "Yêu cầu không hợp lệ. Vui lòng thử lại.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Đã xảy ra lỗi. Vui lòng thử lại.";
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
  },
});

// Re-export the underlying toggle for tests / advanced consumers.
export { PreciseLocationToggle } from "./precise-location-toggle";
