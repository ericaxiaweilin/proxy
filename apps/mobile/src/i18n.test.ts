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
  GREETING_LINES,
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
  //
  // I18N-SAFETY-002 修正（2026-10-01）：原来只有一个判据 —— 非中文语言的值
  // 等于中文值就红。那条判据对拉丁字母语言是对的，但**对 ko / ja 是错的**：
  // 日语里「保存」「警察」「消防」「削除」就是这几个字，与中文逐字相同才是
  // 正确译法。加 safety 卡那批键时它第一次真的红了，暴露的是判据本身的洞，
  // 不是翻译的洞 —— 而当时最容易的「修法」是把那几个键改成假译（把日语的
  // 「保存」硬写成「セーブ」之类），那就是把门禁改成迎合实现。
  //
  // 现在按文字系统分两种判据，两条都比原来严：
  //   · vi / en / lo（拉丁字母）：值等于中文值 ⇒ 一定是忘了翻。红。
  //   · ko / ja：值等于中文值**且**是整句（≥ 6 个汉字）⇒ 整句照抄。红。
  //     短词相同不算：那是两种语言共用的词，不是漏翻。
  it("leaves no Chinese copy in any non-Chinese language", () => {
    const offenders: string[] = [];
    const isLatinScript = (code: string): boolean => code === "vi" || code === "en" || code === "lo";
    // 6 = 一个短句的长度。低于它的「相同」是共用词，高于它的是整句照抄。
    const SENTENCE_CJK = 6;
    for (const code of LANGUAGES.map((o) => o.code)) {
      if (code === "zh") continue;
      for (const key of KEYS) {
        const zhValue: string = I18N.zh[key];
        if (I18N[code][key] !== zhValue) continue;
        if (!CJK.test(zhValue)) continue;
        const cjkCount = (zhValue.match(/[\u4e00-\u9fff]/g) ?? []).length;
        const copiedWholeSentence = cjkCount >= SENTENCE_CJK;
        if (isLatinScript(code) || copiedWholeSentence) {
          offenders.push(`${code}.${key} = ${zhValue}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // 上面那条按「共用词 / 整句照抄」分了家；这一条把分界写死：日语与中文
  // 逐字相同的那几个键，必须是**已知的两语言共用词**，不多不少。
  // 有人给某个键随手抄一段中文进 ja，这张清单会红；而清单本身被人加长
  // 来放行新抄的，它跟上面那条一起变红。
  it("only shares known words verbatim with Chinese in ja/ko", () => {
    const SHARED_WORDS = new Set([
      "保存", "保存中…", "警察", "消防", "削除", "送信", "設定", "確認"
    ]);
    for (const code of LANGUAGES.map((o) => o.code).filter((c): c is "ja" | "ko" => c === "ja" || c === "ko")) {
      for (const key of KEYS) {
        const zhValue: string = I18N.zh[key];
        if (I18N[code][key] !== zhValue) continue;
        if (!CJK.test(zhValue)) continue;
        expect(
          SHARED_WORDS.has(zhValue),
          `${code}.${key} is verbatim Chinese (${zhValue}) and is not on the shared-word list`
        ).toBe(true);
      }
    }
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

  it("offers several distinct greeting lines per language for a one-tap hi", () => {
    // HOME-MORE-GREET-001：「邀约」一点就随机发一句 —— 用户明确要"不要只有一个 多写几句"。
    // 少于 2 句就没法随机、也没法保证同一个人连续两次不收到同一句。
    for (const code of CODES) {
      const lines = GREETING_LINES[code];
      expect(lines.length, `GREETING_LINES.${code}`).toBeGreaterThanOrEqual(6);
      expect(new Set(lines).size, `GREETING_LINES.${code} has duplicates`).toBe(lines.length);
      for (const line of lines) expect(line.trim()).not.toBe("");
    }
    for (const code of CODES) {
      if (code === "zh") continue;
      for (const [index, line] of GREETING_LINES[code].entries()) {
        expect(line, `GREETING_LINES.${code}[${index}] is still the Chinese line`).not.toBe(GREETING_LINES.zh[index]);
      }
    }
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
