// HOME-I18N-001：语言选择的**行为**持久化。i18n.test.ts 守的是内存 store，
// 这里守的是"落盘 → 冷启动读回来"这一跳。
//
// 为什么要单独一个文件：修之前的校验器只认字面量 "vi"/"en"，其它一律回落 "zh"。
// 也就是说用户选了老挝语，SecureStore 里**确实存了 "lo"**，但读出来变成 "zh" ——
// 存进去了、读不出来，界面上就是"选了没生效"。这种 bug 靠看源码很容易漏
// （源码里那行 `if (v === "vi" || v === "en")` 看着完全正常），必须真跑一遍
// 六种语言的往返才能钉住。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    })
  };
});

import * as SecureStore from "expo-secure-store";
import { LANGUAGES, type Language } from "./i18n";
import { clearAllPreferences, loadPreferences, saveLanguage } from "./preferences";

const CODES = LANGUAGES.map((option) => option.code);

describe("HOME-I18N-001 language survives a cold start", () => {
  beforeEach(async () => {
    await clearAllPreferences();
  });

  it("round-trips every one of the six languages", async () => {
    for (const code of CODES) {
      await saveLanguage(code);
      const prefs = await loadPreferences();
      // 旧校验器在这里会把 lo/ko/ja 变成 "zh" —— 这条就是为那个 bug 钉的。
      expect(prefs.language, `stored ${code} but read back ${prefs.language}`).toBe(code);
    }
  });

  it("falls back to the default language when nothing was ever stored", async () => {
    await expect(loadPreferences()).resolves.toMatchObject({ language: "zh" });
  });

  it("falls back to the default for a corrupt or unknown stored value", async () => {
    // 存进去一个字典里没有的值（老版本写的、手改的、将来删掉的语言）。
    for (const junk of ["fr", "ZH", "zh-CN", "", "lo-LA"]) {
      await SecureStore.setItemAsync("pref_language", junk);
      const prefs = await loadPreferences();
      expect(prefs.language, `junk ${JSON.stringify(junk)}`).toBe("zh");
      // 关键：不能把脏值原样透出去 —— 那会让 t() 拿到不存在的语言，
      // 顶栏按钮 languageOption() 也拿不到 .short。
      expect(CODES).toContain(prefs.language);
    }
  });

  it("never returns a language the dictionary cannot serve", async () => {
    for (const code of CODES) {
      await saveLanguage(code as Language);
      const prefs = await loadPreferences();
      expect(LANGUAGES.some((option) => option.code === prefs.language)).toBe(true);
    }
  });
});
