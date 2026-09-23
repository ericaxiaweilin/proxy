// HOME-I18N-001：语言选择必须是真的。这个文件守三件事：
//
// 1. **六种语言都齐** —— 少一个键、值空着，都算坏。
// 2. **没有"复制粘贴忘翻译"** —— TS 只能保证键存在，保证不了值真的翻了。
//    某个语言里冒出一句中文，界面就是"翻译了一半"，而且只有那一种语言坏掉。
// 3. **占位符替换 + 缺变量不伪装** —— 漏传变量时必须留着 {km}，不能变成
//    "undefined"（那会伪装成一句正常文案）。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  I18N,
  ICEBREAKER_LINES,
  LANGUAGES,
  RIDE_TIMES,
  getLanguage,
  isLanguage,
  languageOption,
  setLanguage,
  subscribeLanguage,
  translate,
  type Language
} from "./i18n";

const CODES = LANGUAGES.map((option) => option.code);
const KEYS = Object.keys(I18N.zh) as (keyof typeof I18N.zh)[];
const CJK = /[\u4e00-\u9fff]/;

describe("HOME-I18N-001 language table", () => {
  it("ships the prototype's six languages, in the prototype's order", () => {
    expect(CODES).toEqual(["zh", "vi", "en", "lo", "ko", "ja"]);
    expect(new Set(CODES).size).toBe(CODES.length);
  });

  it("gives every language a non-empty native name, English name, flag and short code", () => {
    for (const option of LANGUAGES) {
      expect(option.name.trim(), `${option.code}.name`).not.toBe("");
      expect(option.english.trim(), `${option.code}.english`).not.toBe("");
      expect(option.flag.trim(), `${option.code}.flag`).not.toBe("");
      expect(option.short.trim(), `${option.code}.short`).not.toBe("");
    }
    // 短标是顶栏按钮上唯一能看到的字，重复会让用户分不清当前是哪一种。
    expect(new Set(LANGUAGES.map((o) => o.short)).size).toBe(CODES.length);
  });

  it("recognises exactly the six codes and nothing else", () => {
    for (const code of CODES) expect(isLanguage(code)).toBe(true);
    for (const junk of ["", "ZH", "zh-CN", "fr", "lo-LA", "en "]) {
      expect(isLanguage(junk), `isLanguage(${JSON.stringify(junk)})`).toBe(false);
    }
  });

  it("falls back to the first language for an unknown code instead of returning undefined", () => {
    expect(languageOption("zh").short).toBe("中");
    expect(languageOption("ja").short).toBe("JA");

    // 上面两行其实测不到兜底：入参类型是 Language，find 必然命中。
    // 真正会走兜底的是"存进去的值后来被改坏/降级"——顶栏按钮拿的是
    // languageOption(lang).short，一旦返回 undefined，整个头部渲染就炸。
    // 所以这里故意绕过类型去喂一个脏值，把兜底钉住。
    expect(languageOption("fr" as Language).code).toBe("zh");
    expect(languageOption("" as Language).short).toBe("中");
  });
});

describe("HOME-I18N-001 dictionary completeness", () => {
  it("has every key non-empty in every language", () => {
    // 下界贴着实际规模：首页整面 chrome 都翻完了，键数不该再掉回去。
    // 有人删键（比如把某段文案改回硬编码）时这条会红。
    expect(KEYS.length).toBeGreaterThan(180);
    for (const code of CODES) {
      const dict = I18N[code];
      for (const key of KEYS) {
        const value = dict[key];
        expect(typeof value, `${code}.${key} must be a string`).toBe("string");
        expect(value.trim(), `${code}.${key} is empty`).not.toBe("");
      }
    }
  });

  // 这条才是真正会抓 bug 的：键齐不代表翻译了。
  it("leaves no Chinese copy in any non-Chinese language", () => {
    const offenders: string[] = [];
    for (const code of CODES) {
      if (code === "zh") continue;
      for (const key of KEYS) {
        if (I18N[code][key] === I18N.zh[key] && CJK.test(I18N.zh[key])) {
          offenders.push(`${code}.${key} = ${I18N.zh[key]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually changes the copy when the language changes", () => {
    expect(translate("zh", "title")).toBe("真人推荐");
    expect(translate("vi", "title")).toBe("Gợi ý người thật");
    expect(translate("en", "title")).toBe("Real People");
    expect(translate("ja", "title")).not.toBe(translate("zh", "title"));
    expect(translate("ko", "title")).not.toBe(translate("en", "title"));
  });

  it("keeps the ride-time ladder at the prototype's seven tiers in every language", () => {
    for (const code of CODES) {
      expect(RIDE_TIMES[code], `RIDE_TIMES.${code}`).toHaveLength(7);
      for (const entry of RIDE_TIMES[code]) expect(entry.trim()).not.toBe("");
    }
    // 非中文的骑行时间不能等于中文那份（否则就是忘了翻）。
    for (const code of CODES) {
      if (code === "zh") continue;
      expect(RIDE_TIMES[code], `RIDE_TIMES.${code} is the Chinese ladder`).not.toEqual(RIDE_TIMES.zh);
    }
  });

  it("keeps both icebreaker openers, per language, in the same order", () => {
    // 破冰开场白原来写死在页面模块里（中文），语言切了它不跟着走。
    // 这里钉住：每种语言都有两条、非空、而且不是中文那份。
    for (const code of CODES) {
      expect(ICEBREAKER_LINES[code], `ICEBREAKER_LINES.${code}`).toHaveLength(2);
      for (const line of ICEBREAKER_LINES[code]) expect(line.trim()).not.toBe("");
    }
    for (const code of CODES) {
      if (code === "zh") continue;
      expect(ICEBREAKER_LINES[code], `ICEBREAKER_LINES.${code} is the Chinese pair`)
        .not.toEqual(ICEBREAKER_LINES.zh);
    }
    // 顺序固定：换顺序等于换了用户看到的推荐次序。
    expect(ICEBREAKER_LINES.en[0]).toBe(translate("en", "icebreakerLine1"));
    expect(ICEBREAKER_LINES.en[1]).toBe(translate("en", "icebreakerLine2"));
  });
});

describe("HOME-I18N-001 placeholder substitution", () => {
  it("substitutes the variables it was given", () => {
    expect(translate("en", "distanceTierA11y", { km: 10 })).toBe("Within 10km");
    expect(translate("zh", "serverPeopleTitle", { n: 3 })).toBe("全站真人 · 3 位");
    expect(translate("ko", "itemsCount", { n: 2 })).toBe("2개");
  });

  it("keeps an unfilled placeholder visible instead of rendering 'undefined'", () => {
    // 漏传整个 vars 会走 translate 的早返回，压根到不了替换逻辑 —— 所以
    // 只测这一种是测不到东西的（这个洞是被注入扫出来的）。
    expect(translate("en", "distanceTierA11y")).toBe("Within {km}km");

    // 真正危险的是"传了 vars 但少一个键"：调用方自以为传全了，
    // 少了 {km} 就会渲染成 "Within undefinedkm" —— 一句看起来正常、
    // 实际带脏字的话，比报错还难发现。两种都必须留着占位符。
    expect(translate("en", "distanceTierA11y", { n: 3 })).toBe("Within {km}km");
    expect(translate("zh", "serverPeopleTitle", { km: 10 })).toBe("全站真人 · {n} 位");
    expect(translate("en", "distanceTierA11y", { n: 3 })).not.toContain("undefined");
    expect(translate("zh", "serverPeopleTitle", { km: 10 })).not.toContain("undefined");
  });

  it("returns the template untouched when there are no placeholders", () => {
    expect(translate("en", "noActivity")).toBe(I18N.en.noActivity);
  });
});

describe("HOME-I18N-001 language store", () => {
  it("defaults to Chinese and notifies subscribers when it changes", () => {
    setLanguage(DEFAULT_LANGUAGE);
    expect(getLanguage()).toBe(DEFAULT_LANGUAGE);

    let notified = 0;
    const unsubscribe = subscribeLanguage(() => {
      notified += 1;
    });

    setLanguage("ja");
    expect(getLanguage()).toBe("ja");
    expect(notified).toBe(1);

    // 设成同一个值不该白通知一次（否则每次挂载都会多一轮渲染）。
    setLanguage("ja");
    expect(notified).toBe(1);

    setLanguage("vi");
    expect(notified).toBe(2);

    unsubscribe();
    setLanguage(DEFAULT_LANGUAGE);
    expect(notified).toBe(2);
    expect(getLanguage()).toBe(DEFAULT_LANGUAGE);
  });

  it("only ever holds a code the dictionary knows", () => {
    setLanguage("lo");
    expect(KEYS.length).toBeGreaterThan(0);
    expect(I18N[getLanguage() as Language]).toBeDefined();
    setLanguage(DEFAULT_LANGUAGE);
  });
});
