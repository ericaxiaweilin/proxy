import * as SecureStore from "expo-secure-store";

const KEYS = {
  LANGUAGE: "pref_language",
  NOTIFY_MESSAGE: "pref_notify_message",
  NOTIFY_EVENT: "pref_notify_event",
  MEMORIZED_CITY: "pref_mem_city",
  MEMORIZED_STYLE: "pref_mem_style",
  MEMORIZED_BUDGET: "pref_mem_budget"
} as const;

export type Language = "zh" | "vi" | "en";

export interface Preferences {
  language: Language;
  notifyMessage: boolean;
  notifyEvent: boolean;
  memorizedCity: string;
  memorizedStyle: string;
  memorizedBudget: string;
}

const DEFAULTS: Preferences = {
  language: "zh",
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
    SecureStore.getItemAsync(KEYS.LANGUAGE).then((v) => {
      if (v === "vi" || v === "en") return v;
      return "zh";
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

export const LANG_LABEL: Record<Language, string> = {
  zh: "中文",
  vi: "Tiếng Việt",
  en: "English"
};
