// I18N-SETTINGS-001（2026-10-01）：底栏 / 页头 chrome / 设置入口页 的多语言。
//
// 为什么单开一个文件：i18n.test.ts 守的是**字典本身**（键齐、没漏翻、
// 占位符正确），它管不到「某个表面有没有真的去查字典」。这次的病正是后者：
// 字典 427 个键、六语言齐、typecheck 全绿，但 app-shell 的底栏五个标签、
// 首页那句本地范围说明、访客页、身份切换面板、设置页所有行全是硬编码中文。
// 也就是说**换语言这件事对用户几乎不可见** —— 唯一跟着走的是首页。
//
// 而且「语言」那一行本身写死「语言 / Ngôn ngữ」：中越两种语言拼在一起，
// 任何一种都不是用户当前的那种。所以「换回来」比「换过去」还难。
//
// 这里钉三件事：
//   1. 这些文案**由字典产出**，六种语言每种都有，且都不是中文那份。
//   2. 表面里**不再有**对应的中文硬编码（先剥注释再断言 —— 注释里正当
//      引用着旧文案，那是有价值的说明，不该被逼着删；不剥的话负向钉会永远
//      红，然后下一个人只能删钉。这就是「负向钉骗红」的老毛病）。
//   3. 语言入口自己也是翻译的，不能再拼两种语言。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { I18N, LANGUAGES, translate, type Language, type MessageKey } from "./i18n";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

const shell = read("./shell/app-shell.tsx");
const shellCode = stripComments(shell);
const me = read("./surfaces/me.tsx");
const meCode = stripComments(me);
const i18nSource = read("./i18n.ts");

const CODES = LANGUAGES.map((option) => option.code);
const CJK = /[\u4e00-\u9fff]/;

// 底栏五个标签 + 访客页 + 身份切换 + 本地范围 + 设置页。
// 列在这里而不是各自散在断言里，是为了让「这一轮到底承诺了哪些键」一眼可见。
const SHELL_KEYS: ReadonlyArray<MessageKey> = [
  "tabHome", "tabMarket", "tabFeed", "tabMessages", "tabMe",
  "guestMeTitle", "guestMeSub", "guestMeCta",
  "ctxRequesterTitle", "ctxRequesterDesc", "ctxBusinessTitle", "ctxBusinessDesc",
  "locScopeMapPick",
  "locStateAcquiring", "locStateDenied", "locStateUnavailable",
  "locSwitch", "locOpenMapA11y", "locSwitchScopeA11y"
];
const SETTINGS_KEYS: ReadonlyArray<MessageKey> = [
  "settingsTitle", "settingsHubHint",
  "settingsGroupAccount", "settingsRowAccountSecurity", "settingsRowKyc",
  "settingsGroupPrivacy", "settingsRowLocationPrivacy", "settingsGroupGeneral",
  "locationPrivacyTitle", "locationPrivacyHint"
];
const ALL_KEYS = [...SHELL_KEYS, ...SETTINGS_KEYS];

describe("I18N-SETTINGS-001 shell + settings chrome", () => {
  it("gives every one of these keys a real translation in all six languages", () => {
    // 「键存在」typecheck 已经管了。这里管的是**值**：非空，且非中文语言里
    // 不能还等于中文那份 —— 否则界面就是「翻译了一半」。
    for (const code of CODES) {
      const dict = I18N[code];
      for (const key of ALL_KEYS) {
        const value = dict[key];
        expect(typeof value, `${code}.${key}`).toBe("string");
        expect(value.trim(), `${code}.${key} is empty`).not.toBe("");
        if (code !== "zh") {
          expect(value, `${code}.${key} is still the Chinese copy`).not.toBe(I18N.zh[key]);
        }
      }
    }
  });

  it("keeps five distinct tab labels per language — none of them identical", () => {
    // 底栏标签是**唯一**每屏都在的字。两个 tab 翻成同一个词，用户就分不清
    // 自己在哪，而且这是那种「五个标签里恰好只有一个没翻」也不会变红的洞。
    for (const code of CODES) {
      const labels = ["tabHome", "tabMarket", "tabFeed", "tabMessages", "tabMe"]
        .map((key) => translate(code as Language, key as MessageKey));
      expect(labels.every((label) => label.trim().length > 0), `${code} has a blank tab`).toBe(true);
      expect(new Set(labels).size, `${code} tab labels collide: ${labels.join(" / ")}`).toBe(labels.length);
    }
  });

  it("actually reads differently per language, not just 'not equal to zh'", () => {
    // 上一条只保证「跟中文不一样」。这一条保证六种语言真的各有各的写法：
    // 否则把所有非中文语言都塞一句英文也过得去。
    const seen = new Set<string>();
    for (const code of CODES) seen.add(translate(code as Language, "tabMe"));
    expect(seen.size, `tabMe collapsed to ${seen.size} distinct strings`).toBe(CODES.length);
  });

  it("substitutes the radius into the map-pin scope line", () => {
    // 占位符漏了会渲染成「Map pin · Covers {radius}」这种一眼假的句子。
    expect(translate("en", "locScopeMapPick", { radius: "3 km" })).toBe("Map pin · Covers 3 km");
    expect(translate("zh", "locScopeMapPick", { radius: "1 km" })).toBe("地图选点 · 覆盖范围 1 km");
    // 定位失败那句带的是设备层的原始 message，也不能吞掉变量。
    expect(translate("en", "locStateUnavailable", { message: "GPS off" })).toContain("GPS off");
  });

  it("keeps the four device-location states telling each other apart in every language", () => {
    // DEVICE-LOCATION-001 钉的约束：「没授权」「正在定位」「定位不可用」三者
    // 不许长得一样。翻译不能把这个约束弄丢 —— 四句在同一种语言里必须互不相同。
    const states: ReadonlyArray<MessageKey> = [
      "locStateAcquiring", "locStateDenied", "locStateUnavailable"
    ];
    for (const code of CODES) {
      const rendered = states.map((key) => translate(code as Language, key, { message: "x" }));
      expect(new Set(rendered).size, `${code} location states collapsed: ${rendered.join(" | ")}`)
        .toBe(rendered.length);
    }
  });
});

describe("I18N-SETTINGS-001 the surfaces actually call the dictionary", () => {
  it("renders the bottom tab labels through t(), not from a module-level literal", () => {
    // 关键在**形状**：`rootTabs()` 原来不接受任何参数，五个标签是常量。
    // 只断言「文件里出现了 tabHome」会骗绿 —— 键加进字典但函数还是返回常量，
    // 测试照样全绿。所以钉签名 + 钉调用点。
    expect(shell).toContain("function rootTabs(t: (key: MessageKey) => string)");
    for (const key of ["tabHome", "tabMarket", "tabFeed", "tabMessages", "tabMe"]) {
      expect(shell, `rootTabs must read ${key}`).toContain(`t("${key}")`);
    }
    expect(shell).toContain("const tabs = rootTabs(t);");
    // tab 标签必须在渲染时取：模块顶层求值发生在 import 时，那时还没有语言。
    expect(shell).toContain("const { t } = useI18n();");
  });

  it("keeps the tab id / icon / badge shape untouched — only the label moved", () => {
    // 换了语言不能顺手改了导航结构：五个 id、五个图标、消息的 9+ 角标都还在。
    for (const id of ["HOME", "MARKET", "FEED", "MESSAGES", "ME"]) {
      expect(shell, `tab ${id} disappeared`).toMatch(new RegExp(`\\{ id: "${id}", icon: "[a-zA-Z]+", label: t\\("tab`));
    }
    expect(shell).toContain('badge: "9+"');
  });

  it("reads the guest page, the identity sheet and the location scope line from t()", () => {
    for (const key of ["guestMeTitle", "guestMeSub", "guestMeCta"]) {
      expect(shellCode, `guest page must read ${key}`).toContain(`t("${key}")`);
    }
    for (const key of ["ctxRequesterTitle", "ctxRequesterDesc", "ctxBusinessTitle", "ctxBusinessDesc"]) {
      expect(shellCode, `identity switcher must read ${key}`).toContain(`t("${key}")`);
    }
    for (const key of [
      "locStateAcquiring", "locStateDenied", "locStateUnavailable",
      "locScopeMapPick",
      "locSwitch", "locOpenMapA11y", "locSwitchScopeA11y"
    ]) {
      expect(shellCode, `location chrome must read ${key}`).toContain(`"${key}"`);
    }
  });

  it("translates the language entry point's own label instead of faking it bilingually", () => {
    // 原来这一行是「语言 / Ngôn ngữ」—— 中文 + 越南语拼在一起。
    // 换任何一种语言都不对：英文用户看到的是两种他都不在用的文字。
    expect(meCode).not.toContain("语言 / Ngôn ngữ");
    expect(me).toContain("Ngôn ngữ"); // 留在注释/说明里可以，不许留在渲染里
    expect(meCode).toContain('t("language")');
    // 六种语言各自的说法都存在（不是同一个词复制六遍）。
    const labels = CODES.map((code) => translate(code as Language, "language"));
    expect(labels[0]).toBe("语言");
    expect(labels[1]).toBe("Ngôn ngữ");
    expect(labels[2]).toBe("Language");
    expect(new Set(labels).size).toBe(CODES.length);
  });

  it("leaves no hardcoded Chinese copy of this round's strings behind", () => {
    // 逐条断言某几个关键串不在**剥完注释**的源码里。这些串就是这一轮搬走的
    // 那几处 —— 还留着就说明有一处漏改了（改了一半是最糟的状态：
    // 字典说翻了，界面一半中文）。
    const moved: ReadonlyArray<string> = [
      // 底栏
      'label: "首页"', 'label: "市场"', 'label: "动态"', 'label: "消息"', 'label: "我的"',
      // 访客页
      ">需要登录<",
      // 身份切换
      'title: "用户"', 'title: "商家"',
      // 本地范围
      "地图选点 · 覆盖范围",
      "跟随你的位置 · 移动后自动更新",
      "你正在看的本地范围",
      "定位未授权 · 点",
      ">切换⌄<",
      'accessibilityLabel="打开场景地图"',
      'accessibilityLabel="切换本地范围"',
      // 设置页
      ">设置<",
      ">隐私与安全<",
      ">通用<",
      ">账号与安全<",
      ">手机号认证 (KYC)<",
      ">位置与隐私<"
    ];
    // 「账号」这一组标题**不能**用 `>账号<` 判负：me.tsx 里还有一处真的
    // 「账号」标签（社媒账户编辑器的 handle 输入），跟设置页无关，剥完
    // 注释也在。把它算进来这条钉就永远红。改成判这一组的整行：
    expect(meCode).not.toContain(
      '<Text selectable style={styles.settingsHubGroup}>账号</Text>'
    );
    for (const literal of moved) {
      expect(shellCode + meCode, `still hardcoded: ${literal}`).not.toContain(literal);
    }
  });

  it("keeps every key it promises declared in the Messages interface", () => {
    // 声明了但没人读 / 读的不是声明的那个 —— 仓库里出现过好几次「5 个字段
    // 声明了但没人读」。这里钉住：这些键必须真的出现在 interface 里。
    const iface = i18nSource.slice(i18nSource.indexOf("export interface Messages {"));
    for (const key of ALL_KEYS) {
      expect(iface, `Messages is missing ${key}`).toContain(`${key}: string;`);
    }
  });

  it("calls useI18n() at component top level, not inside a conditional", () => {
    // hooks-not-in-conditional 是门禁；但门禁只看 render 函数里第一个 hook，
    // LocationContext / RootNav 是同一文件里的另外两个组件 —— 顺手把它们的
    // 调用点钉住，别让下一个人为了少一次订阅把 t 挪进 if 里。
    const components = ["function AppShell", "function LocationContext", "function RootNav"];
    for (const marker of components) {
      const start = shell.indexOf(marker);
      expect(start, `${marker} not found`).toBeGreaterThan(-1);
      // 窗口取到 useI18n() 之前最多能有多长：AppShell 的参数列表本身就有
      // 几十行（props 一长串），1200 字符不够，会把「在函数体里」误判成
      // 「函数体太远」。这里用「从组件开头到该文件里第一个 useI18n()」的
      // 距离来定窗口 —— 组件参数列表不该比这更长。
      const hookAt = shell.indexOf("useI18n()", start);
      expect(hookAt, `${marker} must call useI18n()`).toBeGreaterThan(start);
      const body = shell.slice(start, hookAt);
      expect(body, `${marker} calls useI18n() after a conditional`).not.toMatch(/\bif\s*\(/);
    }
  });

  it("does not put Chinese in the Latin-script dictionaries for these keys", () => {
    // 只查拉丁字母那三种（vi / en / lo）。**不能**查全部五种非中文语言 ——
    // 韩文和日文本来就用汉字（设置 / 位置 / 切换…），把它们判红等于把钉写成
    // 永远红，然后下一个人只能删钉（仓库的老毛病）。i18n.test.ts 那条判据是
    // 「值 == 中文值」，对 ko/ja 是对的；这里补的是拉丁字母语言里不能冒汉字。
    const offenders: string[] = [];
    for (const code of ["vi", "en", "lo"] as ReadonlyArray<Language>) {
      for (const key of ALL_KEYS) {
        if (CJK.test(I18N[code][key])) offenders.push(`${code}.${key} = ${I18N[code][key]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});