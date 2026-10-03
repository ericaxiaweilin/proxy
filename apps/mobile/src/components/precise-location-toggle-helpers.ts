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
import { DEFAULT_LANGUAGE, translate, type Language } from "../i18n";

export {
  ALLOWED_DURATION_SECONDS,
  formatRemaining,
  isActiveConsent,
  type LocationConsent,
};

// I18N-SAFETY-002：ToggleLocale 原来是 `"vi" | "zh"` —— 一条与 i18n.ts 的六种
// 语言**完全无关**的第二条语言轴。同一屏上 precise-location-toggle 走这条轴
// （而且整张卡写死越南语），fuzzy-location-card 却写死中文。现在只剩一种：
// Language。留着这个 type 别名是为了不改动 import 它的调用点，但它不再是
// 「只能是越南语或中文」—— 它就是那六种。
export type ToggleLocale = Language;

// labelForDuration turns a duration in seconds into a short
// human label, e.g. "30 phút" / "8 giờ". The function is also
// used by the duration-choice chip row in the toggle.
//
// 默认值从 "vi" 改成 DEFAULT_LANGUAGE：App 的默认语言是中文（i18n.ts），
// 不是越南语。
export function labelForDuration(
  seconds: number,
  lang: Language = DEFAULT_LANGUAGE,
): string {
  if (seconds === 30 * 60) {
    return translate(lang, "consentDurationMinutes", { n: 30 });
  }
  if (seconds === 8 * 60 * 60) {
    return translate(lang, "consentDurationHours", { n: 8 });
  }
  return `${Math.round(seconds / 60)}m`;
}

// summariseConsent produces a one-line status string for the
// toggle header. The caller passes the language so the same
// helper works for every locale.
//
// `now` is threaded through to isActiveConsent() so a test that
// fixes `now` (e.g. NOW = Date.parse("2026-09-04T10:00:00Z"))
// sees a single coherent "GRANTED + remaining" view, instead of
// isActive using Date.now() and the remaining math using the
// caller's `now` and disagreeing at the boundary.
export function summariseConsent(
  consent: LocationConsent | null | undefined,
  now: number = Date.now(),
  lang: Language = DEFAULT_LANGUAGE,
): string {
  if (!consent) return translate(lang, "consentLoading");
  if (!isActiveConsent(consent, now)) {
    return translate(lang, "consentOff");
  }
  let remaining = consent.remainingSeconds;
  if (remaining <= 0 && consent.expiresAt) {
    const ms = Date.parse(consent.expiresAt) - now;
    remaining = Math.max(0, Math.floor(ms / 1000));
  }
  if (remaining <= 0) {
    return translate(lang, "consentExpiring");
  }
  return translate(lang, "consentActive", { remaining: formatRemaining(remaining, lang) });
}