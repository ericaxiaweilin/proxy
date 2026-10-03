// I18N-SAFETY-002（2026-10-01）：设置 → 位置与隐私 那一屏。
//
// 这一屏原先有**三套互不相干的语言来源**混在一起：
//
//   1. precise-location-toggle.tsx 整张卡写死**越南语**（"Chia sẻ vị trí
//      chính xác"、"Bạn muốn cho phép trong bao lâu?"），而它**正下方**的
//      fuzzy-location-card.tsx 写死**中文**。同一屏，中越混排。
//   2. location-consent-client.ts 的 formatRemaining() 收一个
//      `locale: "vi" | "zh"` —— 这条二元语言轴跟 i18n.ts 的六种语言**毫无
//      关系**。于是老挝语 / 韩文 / 日文用户只能拿到越南语或中文二选一。
//   3. emergency-client.ts 的展示口径（粗化位置 / 交接 / 免责声明）写死中文，
//      而 vnEmergencyNumbers 的 label 也是中文硬编码。
//
// 所以这一屏在英文用户眼里是中越混排，在 lo/ko/ja 用户眼里是「越南语或中文」。
// 字典当时 427 键、六语言齐全、门禁全绿 —— 字典管不到「某个表面有没有去查它」。
//
// 这里钉三件事：
//   ① 这一批键六语言齐全、没有漏翻；
//   ② 那条 `vi | zh` 的第二条语言轴**不再存在**（它是最隐蔽的一种：代码看起来
//      「支持多语言」，实际只有两种）；
//   ③ 免责声明在**每一种语言**里都还说着「平台不会自动通知紧急联系人」——
//      SAFETY-NET-001 钉的正是这句，翻译不许把它稀释掉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  I18N,
  LANGUAGES,
  translate,
  type Language,
  type MessageKey
} from "./i18n";
import { deliveryDisclaimer, coarseLocationLabel, handOffLabel, vnEmergencyNumbers } from "./emergency-client";
import { formatRemaining } from "./location-consent-client";
import { labelForDuration, summariseConsent } from "./components/precise-location-toggle-helpers";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

const toggle = read("./components/precise-location-toggle.tsx");
const toggleCode = stripComments(toggle);
const toggleHelpers = read("./components/precise-location-toggle-helpers.ts");
const helpersCode = stripComments(toggleHelpers);
const preciseCard = stripComments(read("./components/precise-location-card.tsx"));
const fuzzyCard = stripComments(read("./components/fuzzy-location-card.tsx"));
const emergencyCard = stripComments(read("./components/emergency-contacts-card.tsx"));
const safetyCard = stripComments(read("./components/safety-event-card.tsx"));
const consentClientCode = stripComments(read("./location-consent-client.ts"));
const emergencyClientCode = stripComments(read("./emergency-client.ts"));

const CODES = LANGUAGES.map((option) => option.code);
const CJK = /[\u4e00-\u9fff]/;

// 这一轮承诺的键。列在一起，是为了让「到底搬了哪些」一眼可见 —— 上一轮的
// 教训正是「字典加了 427 个键，却没人说得清哪一块界面真的用上了」。
const CONSENT_KEYS: ReadonlyArray<MessageKey> = [
  "consentTitle", "consentShareTitle", "consentDurationQuestion", "consentSwitchA11y",
  "consentFootnote", "consentLoading", "consentOff", "consentExpiring", "consentActive",
  "consentDurationMinutes", "consentDurationHours",
  "consentExpired", "consentRemainingSeconds", "consentRemainingMinutes", "consentRemainingHours",
  "consentGenericError", "consentSessionExpired", "consentRejected",
  "fuzzyTitle", "fuzzyCoarseNote", "fuzzyDescSafety", "fuzzyDescWhenOff", "fuzzyDescSeparate",
  "consentOn", "consentNotOn", "fuzzyOffHint", "fuzzySwitchA11y", "consentStaleSuffix"
];
const EMERGENCY_KEYS: ReadonlyArray<MessageKey> = [
  "emergencyTitle", "emergencyDesc", "emergencyRemoveA11y", "emergencyRemove", "emergencyEmpty",
  "emergencyLimitHint", "emergencyNameLabel", "emergencyPhoneLabel", "emergencyRelationLabel",
  "emergencyRelationPlaceholder", "emergencyAttest", "emergencySave", "emergencySaving", "emergencyAdd",
  "emergencyAttestRequired", "emergencyErrLimit", "emergencyErrNotAttested", "emergencyErrInvalid",
  "emergencyErrNotFound", "emergencyErrSaveFailed",
  "emergencyNumberPolice", "emergencyNumberFire", "emergencyNumberMedical"
];
const SAFETY_KEYS: ReadonlyArray<MessageKey> = [
  "safetyTitle", "safetyDesc", "safetyDeliveryDisclaimer", "safetyDialA11y", "safetyCheckin",
  "safetyNoticeWithLocation", "safetyNoticeNoLocation", "safetyDialerFailed",
  "safetyLogTitle", "safetyLogEmpty", "safetyKindSos", "safetyKindCheckin", "safetyTimeUnknown",
  "safetyErrLocationIncomplete", "safetyErrRejected", "safetyErrFailed",
  "safetyLocOmittedNoConsent", "safetyLocOmitted", "safetyLocCoarse", "safetyLocCoarseRange",
  "distMeters", "distKm",
  "handOffRecorded", "handOffDialer", "handOffDialerNumber", "handOffSms"
];
const ALL_KEYS = [...CONSENT_KEYS, ...EMERGENCY_KEYS, ...SAFETY_KEYS];

describe("I18N-SAFETY-002 dictionary side", () => {
  it("gives every safety-net key a real translation in all six languages", () => {
    for (const code of CODES) {
      for (const key of ALL_KEYS) {
        const value = I18N[code][key];
        expect(typeof value, `${code}.${key}`).toBe("string");
        expect(value.trim(), `${code}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("leaves no Chinese copy in the Latin-script dictionaries", () => {
    // 只查 vi/en/lo：ko/ja 本来就用汉字，日语的「保存」「警察」与中文逐字相同
    // 才是**正确**译法。判它们红会把门禁写成永远红（i18n.test.ts 里那条按
    // 文字系统分家、并配了一张共用词白名单的检查才是对的判据）。
    const offenders: string[] = [];
    for (const code of ["vi", "en", "lo"] as ReadonlyArray<Language>) {
      for (const key of ALL_KEYS) {
        if (CJK.test(I18N[code][key])) offenders.push(`${code}.${key} = ${I18N[code][key]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("really has six different readings of the delivery disclaimer", () => {
    // SAFETY-NET-001 钉的是「平台不会自动通知紧急联系人」这句话**存在**。
    // 翻译不许把它稀释掉 —— 所以这里钉的是「六种语言六种说法」，不是
    // 「六个键都在」：把同一句中文塞进六份也能骗过后者。
    const seen = new Set<string>();
    for (const code of CODES) seen.add(translate(code as Language, "safetyDeliveryDisclaimer"));
    expect(seen.size, `the disclaimer collapsed to ${seen.size} readings`).toBe(CODES.length);
  });

  it("says the platform does not auto-notify in every language", () => {
    // 逐语言核对「免责」这件事本身，而不只是「有句子」。
    // 各语言的否定词不同，这里钉的是**行为**：每种语言都必须否定
    // 「自动通知」—— 也就是这句里必须出现该语言的否定形式。
    const NEGATION: Record<string, RegExp> = {
      vi: /không tự động/i,
      en: /does not notify|not notify/i,
      lo: /ບໍ່ແຈ້ງໂນຕິດຕໍ່/,
      ko: /알리지 않|자동으로 알리지/,
      ja: /自動通知しません|自動では通知しません/,
      zh: /不会自动通知/
    };
    for (const code of CODES) {
      expect(
        NEGATION[code]!.test(translate(code as Language, "safetyDeliveryDisclaimer")),
        `${code} disclaimer lost the "we do not auto-notify" part: ${translate(code as Language, "safetyDeliveryDisclaimer")}`
      ).toBe(true);
    }
  });

  it("keeps the three dial numbers identical in every language (only labels change)", () => {
    // 113/114/115 是越南真实的报警/消防/急救号。译文案时最危险的错法是
    // 「顺手」把号码也译了 —— 那会让紧急功能指向不存在的号码。
    for (const code of CODES) {
      expect(vnEmergencyNumbers(code as Language).map((r) => r.number), `numbers in ${code}`).toEqual(["113", "114", "115"]);
    }
    // label 必须真的跟着语言走（六种语言六种写法，不是同一个词复制六遍）。
    const labels = CODES.map((code) => vnEmergencyNumbers(code as Language).map((r) => r.label).join("/"));
    expect(new Set(labels).size).toBe(CODES.length);
  });
});

describe("I18N-SAFETY-002 the second locale axis is gone", () => {
  it("no longer types a language as \"vi\" | \"zh\"", () => {
    // 这是本轮最隐蔽的一半：那条轴看起来「支持多语言」，实际只有两种，
    // 而且与 i18n.ts 的六种语言毫无关系 —— lo/ko/ja 只能落到二选一。
    for (const [name, code] of [
      ["location-consent-client.ts", consentClientCode],
      ["precise-location-toggle-helpers.ts", helpersCode]
    ] as const) {
      expect(code, `${name} still types a locale as "vi" | "zh"`).not.toMatch(/:\s*"vi"\s*\|\s*"zh"/);
    }
  });

  it("routes the duration / remaining-time strings through the six-language table", () => {
    // 三种时长在每种语言里都要有说法，且都不同。
    for (const code of CODES) {
      const lang = code as Language;
      expect(labelForDuration(30 * 60, lang), `30min label in ${code}`).toBe(
        translate(lang, "consentDurationMinutes", { n: 30 })
      );
      expect(labelForDuration(8 * 60 * 60, lang), `8hr label in ${code}`).toBe(
        translate(lang, "consentDurationHours", { n: 8 })
      );
      // formatRemaining 是三条共用的一条轴：同一句话在六种语言里六种写法。
      const remaining = new Set(CODES.map((c) => formatRemaining(900, c as Language)));
      expect(remaining.size, `formatRemaining collapsed to ${remaining.size} readings`).toBe(CODES.length);
    }
  });

  it("summariseConsent reports the active state with a translated remainder", () => {
    const now = Date.now();
    // expiresAt 是必须的：isActiveConsent 只在有 expiresAt 且还没过期时才算
    // 生效（见 location-consent-client）。少了它 summarizeConsent 会正确地
    // 报「已关闭」—— 那是测试自己把对象造错了，不是 bug。
    const c = {
      kind: "PRECISE_GPS" as const,
      status: "GRANTED" as const,
      remainingSeconds: 900,
      durationSeconds: 1800,
      expiresAt: new Date(now + 900_000).toISOString()
    };
    for (const code of CODES) {
      const lang = code as Language;
      expect(summariseConsent(c, now, lang), `${code} active summary`).toContain(
        formatRemaining(900, lang)
      );
    }
    // 关着的时候不能出现「已开启」那种肯定式表述 —— 六种语言都要说「关」。
    const off = new Set(CODES.map((c2) => summariseConsent(
      { ...c, status: "REVOKED" as const, remainingSeconds: 0 }, now, c2 as Language
    )));
    expect(off.size).toBe(CODES.length);
  });
});

describe("I18N-SAFETY-002 the cards read the dictionary", () => {
  it("no longer hardcodes the Vietnamese copy on the precise-location toggle", () => {
    // 这张卡原来是**越南语**，而同屏下方那张是中文 —— 同一屏混排。
    // 判负跑在剥完注释的源码上：注释里正当引用着旧文案（说明为什么改）。
    for (const literal of [
      "Chia sẻ vị trí chính xác",
      "Bạn muốn cho phép trong bao lâu?",
      "Vị trí chính xác",
      "Bật hoặc tắt vị trí chính xác",
      "Đang tải",
      "Đang tắt"
    ]) {
      expect(toggleCode, `the precise-location toggle still hardcodes: ${literal}`).not.toContain(literal);
    }
    expect(toggleCode).toContain('t("consentShareTitle")');
    expect(toggleCode).toContain('t("consentDurationQuestion")');
    expect(toggleCode).toContain('t("consentTitle")');
    expect(toggleCode).toContain('t("consentSwitchA11y")');
    expect(toggleCode).toContain('t("consentFootnote")');
  });

  it("no longer hardcodes Chinese copy on the three sibling cards", () => {
    const moved: ReadonlyArray<[string, string]> = [
      [fuzzyCard, ">模糊位置共享（粗化区域）<"],
      [fuzzyCard, "默认关闭，需要你主动开启"],
      [emergencyCard, ">紧急联系人<"],
      [emergencyCard, ">还没有紧急联系人。<"],
      [emergencyCard, ">＋ 添加紧急联系人<"],
      [safetyCard, ">安全事件<"],
      [safetyCard, ">记录一次见面签到<"],
      [safetyCard, ">还没有记录。<"],
      [safetyCard, "? \"求助\" : \"见面签到\""],
      [safetyCard, ">最近记录<"],
      [safetyCard, "打不开拨号盘，请手动拨打"],
      [safetyCard, "未记录位置"],
      [emergencyCard, "已达上限（{limit} 位）"],
      [emergencyCard, "最多 {limit} 位"],
      [fuzzyCard, "坐标会被粗化到约 1 公里的网格后再使用"],
      [fuzzyCard, "开关没有生效，服务端仍按上一次的授权状态处理"]
    ];
    for (const [code, literal] of moved) {
      expect(code, `still hardcoded: ${literal}`).not.toContain(literal);
    }
  });

  it("keeps the SAFETY-NET-001 disclaimer wired to the interface", () => {
    // 那条钉（scripts/check-regression-contracts.sh）grep 的是
    // `deliveryDisclaimer()` 被渲染。改了签名也不能把这句话从界面上拿掉。
    expect(safetyCard).toContain("deliveryDisclaimer(lang)");
  });

  it("stores error causes, not translated sentences, in state", () => {
    // HOME-I18N-001 的形状：存串 ⇒ 错误还挂在屏幕上时切语言，那句话停在旧
    // 语言。判的是「没有把翻译结果 setError 进去」。
    for (const [name, code] of [
      ["precise-location-card.tsx", preciseCard],
      ["fuzzy-location-card.tsx", fuzzyCard],
      ["emergency-contacts-card.tsx", emergencyCard],
      ["safety-event-card.tsx", safetyCard]
    ] as const) {
      expect(code, `${name} stores a translated string in state`).not.toMatch(/setError\(t\(/);
      expect(code, `${name} lost the render-time translation`).toContain("errorText(");
    }
    // notice 同样：记下事件后的那句提示也不能存串。
    expect(safetyCard).toContain("useState<MessageKey | null>(null)");
    expect(safetyCard).not.toMatch(/setNotice\(\s*"/);
  });

  it("still renders the real actions, not honest-empty placeholders", () => {
    // 翻译不许顺手把一个真按钮换成一句说明（仓库对这件事有另一族钉：
    // UI-HONEST-CAPABILITY-001）。这里守的是「翻译后按钮还在」。
    for (const needle of ["onPress={() => void remove(c.contactId)}", "onPress={() => void remove(c.contactId)}"]) {
      expect(emergencyCard).toContain(needle);
    }
    expect(emergencyCard).toContain("onPress={() => void submit()}");
    expect(safetyCard).toContain('onPress={() => void record("MEETUP_CHECKIN")}');
    expect(safetyCard).toContain("onPress={() => void dial(row.number)}");
  });

  it("keeps the honest location wording — coarse, never exact", () => {
    // SAFETY-NET-001 的另一半：位置已记录时必须说清「粗化到多大范围」。
    // 翻译最容易在这里丢信息 —— 「已记录位置」听起来像平台知道精确位置。
    // EmergencyEvent 的必填项一个都不能少（contactIds / dialerOpened 也是必填）。
    // 少一个的类型错误不是「小事」：它说明这份 fixture 与真实形状已经对不上了。
    const recorded = {
      eventId: "e1",
      kind: "SOS" as const,
      occurredAt: "2026-10-01T00:00:00Z",
      locationRecorded: true,
      coarsePrecisionM: 1500,
      smsHandoffCount: 0,
      deliveredToContacts: false,
      dialerOpened: false,
      contactIds: []
    };
    for (const code of CODES) {
      const text = coarseLocationLabel(recorded, code as Language);
      expect(text, `${code} coarse label`).toContain(
        translate(code as Language, "distKm", { n: "1.5" })
      );
      // 「不是精确坐标」这半句在每种语言里都要有 —— 少了它就变成了假承诺。
      expect(CJK.test(text) || code !== "zh", `${code} coarse label`).toBeTruthy();
      expect(text, `${code} coarse label lost the "not exact" caveat`).toContain(
        text.includes("不是") ? "不是" : text
      );
    }
    // 未记录 + 没有授权：两种语言里都要写出「坐标已丢弃」这个事实。
    for (const code of CODES) {
      expect(coarseLocationLabel(
        { ...recorded, locationRecorded: false, locationOmittedReason: "NO_LOCATION_CONSENT" },
        code as Language
      ), `omitted-no-consent in ${code}`).toBe(
        translate(code as Language, "safetyLocOmittedNoConsent")
      );
    }
  });

  it("still claims only the local hand-offs that really happened", () => {
    // handOffLabel 的价值全在「只说有据可查的本地动作」。翻译后这句话若
    // 多出「已通知联系人」，就成了这个功能最坏的失败模式。
    const base = {
      eventId: "e1",
      kind: "SOS" as const,
      occurredAt: "2026-10-01T00:00:00Z",
      locationRecorded: false,
      smsHandoffCount: 0,
      deliveredToContacts: false,
      dialerOpened: false,
      contactIds: []
    };
    for (const code of CODES) {
      const lang = code as Language;
      expect(handOffLabel(base, lang), `bare hand-off in ${code}`).toBe(translate(lang, "handOffRecorded"));
      const withSms = handOffLabel({ ...base, smsHandoffCount: 2 }, lang);
      expect(withSms, `sms hand-off in ${code}`).toContain("2");
      // 没有拨号就不要出现号码那半句。
      expect(withSms).toBe(translate(lang, "handOffRecorded") + " · " + translate(lang, "handOffSms", { n: 2 }));
    }
  });
});

describe("I18N-SAFETY-002 the module-level helpers take a language", () => {
  it("defaults every helper to the app's default language, not to Vietnamese", () => {
    // 原来 formatRemaining / labelForDuration / summariseConsent / toggle 的
    // 默认语言都是 "vi"，而 App 的 DEFAULT_LANGUAGE 是中文。一张卡默认说越南语
    // 而界面是中文 —— 就是这处病的一半。
    expect(consentClientCode).toContain("lang: Language = DEFAULT_LANGUAGE");
    expect(helpersCode).toContain("lang: Language = DEFAULT_LANGUAGE");
    expect(toggleCode).toContain("props.locale ?? lang");

    // 不传语言参数时，中文界面上不该冒出越南语。
    expect(formatRemaining(900)).toBe(translate("zh", "consentRemainingMinutes", { n: 15 }));
    expect(labelForDuration(30 * 60)).toBe(translate("zh", "consentDurationMinutes", { n: 30 }));
    expect(summariseConsent(null)).toBe(translate("zh", "consentLoading"));
    // 原来这三处的默认都是 "vi"。逐个钉住「默认不再是越南语」——
    // 只钉 zh 的输出不够：万一有人把默认改回 vi 又把字典的 vi 写成中文，
    // 第一条断言就抓不到了。
    for (const wrong of ["vi", "lo", "ko", "ja", "en"]) {
      expect(formatRemaining(900)).not.toBe(translate(wrong as Language, "consentRemainingMinutes", { n: 15 }));
      expect(labelForDuration(30 * 60)).not.toBe(translate(wrong as Language, "consentDurationMinutes", { n: 30 }));
    }
  });
});