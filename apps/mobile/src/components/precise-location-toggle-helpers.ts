// R16.7-P1-J: pure helpers for the precise-location toggle.
// Kept separate from the .tsx so vitest can import without
// pulling in react-native. The .tsx re-exports these symbols
// so the existing call sites do not need to change.
import {
  ALLOWED_DURATION_SECONDS,
  formatRemaining,
  isActiveConsent,
  type LocationConsent,
} from "../location-consent-client";

export {
  ALLOWED_DURATION_SECONDS,
  formatRemaining,
  isActiveConsent,
  type LocationConsent,
};

export type ToggleLocale = "vi" | "zh";

// labelForDuration turns a duration in seconds into a short
// human label, e.g. "30 phút" / "8 giờ". The function is also
// used by the duration-choice chip row in the toggle.
export function labelForDuration(
  seconds: number,
  locale: ToggleLocale = "vi",
): string {
  if (seconds === 30 * 60) {
    return locale === "vi" ? "30 phút" : "30 分钟";
  }
  if (seconds === 8 * 60 * 60) {
    return locale === "vi" ? "8 giờ" : "8 小时";
  }
  return `${Math.round(seconds / 60)}m`;
}

// summariseConsent produces a one-line status string for the
// toggle header. The caller passes the locale so the same
// helper works for vi and zh builds.
export function summariseConsent(
  consent: LocationConsent | null | undefined,
  now: number = Date.now(),
  locale: ToggleLocale = "vi",
): string {
  if (!consent) return locale === "vi" ? "Đang tải..." : "加载中…";
  if (!isActiveConsent(consent)) {
    return locale === "vi" ? "Đang tắt" : "已关闭";
  }
  let remaining = consent.remainingSeconds;
  if (remaining <= 0 && consent.expiresAt) {
    const ms = Date.parse(consent.expiresAt) - now;
    remaining = Math.max(0, Math.floor(ms / 1000));
  }
  if (remaining <= 0) {
    return locale === "vi" ? "Sắp hết hạn" : "即将过期";
  }
  return locale === "vi"
    ? `Đang bật · ${formatRemaining(remaining, locale)}`
    : `已开启 · ${formatRemaining(remaining, locale)}`;
}
