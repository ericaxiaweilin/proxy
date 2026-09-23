import * as SecureStore from "expo-secure-store";
import { DEFAULT_LANGUAGE, LANGUAGES, isLanguage, type Language } from "./i18n";

const KEYS = {
  LANGUAGE: "pref_language",
  NOTIFY_MESSAGE: "pref_notify_message",
  NOTIFY_EVENT: "pref_notify_event",
  MEMORIZED_CITY: "pref_mem_city",
  MEMORIZED_STYLE: "pref_mem_style",
  MEMORIZED_BUDGET: "pref_mem_budget"
} as const;

// 语言的类型单一来源在 i18n.ts（6 种，跟原型 LANGS 一致）。这里只 re-export，
// 免得两处各写一份、然后随着加语言慢慢漂开。
export type { Language };

export interface Preferences {
  language: Language;
  notifyMessage: boolean;
  notifyEvent: boolean;
  memorizedCity: string;
  memorizedStyle: string;
  memorizedBudget: string;
}

const DEFAULTS: Preferences = {
  language: DEFAULT_LANGUAGE,
  notifyMessage: true,
  notifyEvent: false,
  memorizedCity: "河内",
  memorizedStyle: "轻松、咖啡、拍照",
  memorizedBudget: "中等"
};

async function getBool(key: string, fallback: boolean): Promise<boolean> {
  const v = await SecureStore.getItemAsync(key);
  if (v === null) return fallback;
  return v === "1";
}

async function setBool(key: string, value: boolean): Promise<void> {
  await SecureStore.setItemAsync(key, value ? "1" : "0");
}

export async function loadPreferences(): Promise<Preferences> {
  const [language, notifyMessage, notifyEvent, city, style, budget] = await Promise.all([
    // HOME-I18N-001：以前这里只认字面量 "vi"/"en"，其它一律回落到 "zh" ——
    // 也就是说新增的 lo/ko/ja 会被**静默吞回中文**：用户选了老挝语、重启后
    // 又变回中文，而且没有任何提示。改成走 i18n 的白名单判定，以后加语言
    // 不用回来改这里，也不会再出现"存进去了但读不出来"。
    SecureStore.getItemAsync(KEYS.LANGUAGE).then((v) => {
      if (v && isLanguage(v)) return v;
      return DEFAULT_LANGUAGE;
    }),
    getBool(KEYS.NOTIFY_MESSAGE, DEFAULTS.notifyMessage),
    getBool(KEYS.NOTIFY_EVENT, DEFAULTS.notifyEvent),
    SecureStore.getItemAsync(KEYS.MEMORIZED_CITY).then((v) => v ?? DEFAULTS.memorizedCity),
    SecureStore.getItemAsync(KEYS.MEMORIZED_STYLE).then((v) => v ?? DEFAULTS.memorizedStyle),
    SecureStore.getItemAsync(KEYS.MEMORIZED_BUDGET).then((v) => v ?? DEFAULTS.memorizedBudget)
  ]);
  return { language, notifyMessage, notifyEvent, memorizedCity: city, memorizedStyle: style, memorizedBudget: budget };
}

export async function saveLanguage(lang: Language): Promise<void> {
  await SecureStore.setItemAsync(KEYS.LANGUAGE, lang);
}

export async function saveNotifyMessage(v: boolean): Promise<void> {
  await setBool(KEYS.NOTIFY_MESSAGE, v);
}

export async function saveNotifyEvent(v: boolean): Promise<void> {
  await setBool(KEYS.NOTIFY_EVENT, v);
}

export async function clearAllPreferences(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k))
  );
}

// 从 i18n 的 LANGUAGES 派生，不再手写第二份 —— 手写的那份只有 3 种语言，
// 类型扩到 6 种之后它必然对不上（少 3 个键）。
export const LANG_LABEL: Record<Language, string> = Object.fromEntries(
  LANGUAGES.map((option) => [option.code, option.name])
) as Record<Language, string>;
