import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONSENT_PURPOSES } from "./behavior-analytics-settings";
import { I18N } from "./i18n";

// COMP-SENSITIVE-CONSENT-001 / COMP-DPO-HONEST-001 / COMP-MERCHANT-GAP-HONEST-001
// —— 2026-09-27 越南合规扫描之后留下的钉子。
//
// 为什么必须有这个文件：这一轮修掉的三处，都是**界面上的法律断言**，
// 而它们各自都曾经"看起来是对的"：
//   1. 敏感行为数据（逐张照片停留 + 放大）的采集闸默认开 —— Nghị định
//      356/2025/NĐ-CP Art. 4.1(l) 把社交网络上的行为追踪数据列为敏感个人数据，
//      Art. 6.3 **禁止默认同意机制**。旧实现读不到/读失败都按开处理（fail-open）。
//   2. 界面对用户说「Proxy 已指定 DPO」并给出邮箱 —— 仓里没有任何指定文件
//      （supplement 第 12 行「空白」），法律文档正文仍是 [DPO 信息] 占位符。
//   3. 界面对商家说补全清单「已补齐」—— 那份 supplement 的 9 行状态**全部是空白**。
//
// 三处的共同形状：**把一个未完成的合规事项写成已完成**。所以钉的不是"文案好看"，
// 而是"不许把缺口说成已闭环"。
//
// 和仓库其它钉一样：**负向断言先剥注释**。这里尤其重要 —— 上面三处的解释性注释里
// 正当地写着被禁的词（「原来写着『已指定 DPO』」「原来是 `!== false`」「原来是默认开」），
// 那些注释是有价值的（说明为什么改），不该被删；但如果负向断言跑在原始源码上，
// 它们就会把钉变成**永远红**，然后下一个人只能把钉删掉 —— 这就是仓库的老毛病
// 「正向钉骗绿，负向钉骗红」。
//
// 反过来，**正向的文档性断言跑在原始源码上**：法条号（Art. 6.3 / 4.1(l)）只可能
// 出现在注释里，剥了注释就等于没断言。两条路各自跑对的那一份源码。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

const read = (p: string): string => readFileSync(here(p), "utf8");

const meSurface = read("./surfaces/me.tsx");
const meCode = stripComments(meSurface);
const merchantSurface = read("./surfaces/merchant-me-r21-replacement.tsx");
const merchantCode = stripComments(merchantSurface);
const settingsSource = read("./behavior-analytics-settings.ts");
const settingsCode = stripComments(settingsSource);
const impressionSource = read("./post-impression.ts");
const impressionCode = stripComments(impressionSource);

// 扫描面自检：一个"扫不到文件所以通过"的钉等于没有。
describe("compliance pin scan surface", () => {
  it("四个被钉的文件都读到了，且剥注释确实在起作用", () => {
    expect(meSurface.length).toBeGreaterThan(10_000);
    expect(merchantSurface.length).toBeGreaterThan(10_000);
    expect(settingsSource).toContain("createBehaviorAnalyticsStore");
    expect(impressionSource).toContain("behaviorAnalyticsEnabled");
    // 剥注释必须真的改变内容，否则下面的"没有某词"全是假的。
    expect(meCode.length).toBeLessThan(meSurface.length);
    expect(merchantCode.length).toBeLessThan(merchantSurface.length);
    expect(settingsCode.length).toBeLessThan(settingsSource.length);
    expect(impressionCode.length).toBeLessThan(impressionSource.length);
  });
});

// 1. 敏感行为数据：必须显式同意，且 fail-closed。
describe("COMP-SENSITIVE-CONSENT-001 敏感行为数据须显式同意", () => {
  // COMP-CONSENT-PIPELINE-001（2026-10-08）：同意从一个总闸拆成三个目的，
  // 所以「默认关」这条钉从**一个** useState(false) 变成**三个** false ——
  // 默认值现在是一张表，注入测试把任意一项改成 true 这条就会红。
  it("三个采集目的的默认状态都是关，不是开", () => {
    expect(meCode).toContain("const [behaviorAnalyticsByPurpose, setBehaviorAnalyticsByPurpose] = useState<Record<ConsentPurpose, boolean>>({");
    for (const purpose of CONSENT_PURPOSES) {
      expect(meCode, `${purpose} must default to off`).toContain(`${purpose}: false`);
    }
    // 旧的单闸 state 必须真的没了：留着就说明还有别的界面上写它。
    expect(meCode).not.toContain("const [behaviorAnalytics, setBehaviorAnalytics] = useState(false);");
    // 目的的集合就是这三个，少一个就少一个可同意的用途，多一个是凭空多一个。
    expect([...CONSENT_PURPOSES]).toEqual(["RECOMMENDATION", "TWIN_INSIGHT", "OPERATOR_AUDIENCE_DETAIL"]);
  });

  it("读不到 / 读失败都算未同意：闸是 `anyCaptureEnabled`，不是 `!== false`", () => {
    // anyCaptureEnabled 内部是逐目的的 `=== true`（在 settings 模块里钉），
    // 这里钉的是埋点这一侧确实走它、且外层仍然 fail-closed。
    expect(impressionCode).toContain("return await anyCaptureEnabled(activeStore);");
    // 负向断言必须跑在剥注释的源码上：注释里写着历史形态 `!== false`。
    expect(impressionCode).not.toContain("!== false");
    // 外层 catch（读 store 时抛）也必须 fail-closed，不能放行。
    expect(impressionCode).toMatch(/catch\s*\{\s*return false;\s*\}/);
  });

  it("store 只在显式写入 \"1\" 时给 true；读失败给 undefined，绝不给 true", () => {
    expect(settingsCode).toContain('if (raw === "1") return true;');
    expect(settingsCode).toContain('if (raw === "0") return false;');
    expect(settingsCode).toMatch(/catch\s*\{\s*return undefined;\s*\}/);
    // fail-open 回归最可能的写法：catch 里 return true。
    expect(settingsCode).not.toMatch(/catch\s*\{[^}]*\btrue\b/);
    // 「有没有一项开着」的判定也必须 fail-closed。
    expect(settingsCode).toContain("export async function anyCaptureEnabled");
    expect(settingsCode).toContain("if ((await store.read(purpose)) === true) return true;");
  });

  it("法条依据留在文件里（文档性断言，跑在原始源码上）", () => {
    // 法条号只可能出现在注释里 —— 剥注释断言这条等于没断言，所以这里用原始源码。
    expect(settingsSource).toContain("Art. 6.3");
    expect(settingsSource).toContain("4.1(l)");
    // undefined 的语义必须写明是"没表达过意愿"，不是同意。
    expect(settingsSource).toContain("不等于同意");
  });

  // COMP-CONSENT-PIPELINE-001：文案从「一段话说全三个用途」改成「三个开关
  // 各说各的用途」。原来这条钉的是「三个用途都出现在同一段文字里」；现在
  // 等价的约束是**更强**的那个：每个目的**各自**有一句标题 + 一句说明，
  // 而且没有任何一个目的的说明会漏掉它自己的用途。三行都走字典，所以断言
  // 钉的是字典里的真文案 + 界面上确实按目的逐行渲染。
  it("三个目的各有一句标题 + 一句说明，说清它自己的用途、默认关闭、是敏感数据", () => {
    const zh = I18N.zh;
    // 敏感数据要明确告知；法条依据要留。
    expect(zh["consent.heading"]).toContain("敏感数据");
    expect(zh["consent.note"]).toContain("356/2025/NĐ-CP");
    expect(zh["consent.note"]).toContain("各自独立");
    // 用途不能说少：推荐 / 分身洞察 / 运营逐人明细，三句各自的说明里都得有。
    expect(zh["consent.reco.title"]).toBe("用浏览行为推荐内容");
    expect(zh["consent.reco.desc"]).toContain("更对味");
    expect(zh["consent.twin.title"]).toBe("AI 分身 · 好友洞察");
    expect(zh["consent.twin.desc"]).toContain("AI 分身 · 好友洞察");
    expect(zh["consent.ops.title"]).toBe("运营可查看我的浏览明细");
    expect(zh["consent.ops.desc"]).toContain("逐人明细");
    expect(zh["consent.ops.desc"]).toContain("停留几秒");
    expect(zh["consent.ops.desc"]).toContain("放大几次");
    // 三句都得说清「默认关闭 + 随时可关」—— 旧文案是统一一句，拆开之后
    // 每一句都要自带，否则其中两项就变成了默认开。
    for (const key of ["consent.reco.desc", "consent.twin.desc", "consent.ops.desc"] as const) {
      expect(zh[key], key).toContain("默认关闭");
      expect(zh[key], key).toContain("随时可关");
    }
    // 界面确实按目的逐行渲染三行，且每一行只拨自己的目的。
    expect(meCode).toContain("const CONSENT_PURPOSE_ROWS");
    for (const [purpose, titleKey] of [
      ["RECOMMENDATION", "consent.reco.title"],
      ["TWIN_INSIGHT", "consent.twin.title"],
      ["OPERATOR_AUDIENCE_DETAIL", "consent.ops.title"]
    ] as const) {
      expect(meCode, `${purpose} row must name its own keys`).toContain(`"${purpose}"`);
      expect(meCode, `${purpose} row must read ${titleKey}`).toContain(titleKey);
    }
    expect(meCode).toContain("onPress={() => toggleBehaviorAnalytics(purpose)}");
    expect(meCode).toContain("await localNet.recordPurposeConsent(purpose, next, BEHAVIOR_ANALYTICS_CONSENT_SOURCE)");
    // 渲染层不许再留写死的这段旧文案（改了一半 = 字典说翻了、界面还是中文）。
    expect(meCode).not.toContain("平台运营侧可查看逐人明细");
    expect(meCode).not.toContain("默认关闭。开启后记录你看过哪些动态、多图动态里具体看了哪张照片多久");
  });
});

// 2. 不许对用户宣称已指定 DPO。
describe("COMP-DPO-HONEST-001 不许宣称已指定 DPO", () => {
  it("界面代码里没有『已指定 DPO』这类断言", () => {
    expect(meCode).not.toContain("已指定 DPO");
    expect(meCode).not.toContain("已指定DPO");
  });

  it("界面代码里没有未经验证的 privacy@ 邮箱", () => {
    expect(meCode).not.toMatch(/privacy@[A-Za-z0-9.-]+/);
  });

  it("保留的是一条真实可用的通道（隐私请求入口）", () => {
    expect(meCode).toContain("隐私请求入口");
  });
});

// 3. 补全清单不许说成"已补齐"。
describe("COMP-MERCHANT-GAP-HONEST-001 补全清单不许说已补齐", () => {
  it("界面代码里不再出现『已补齐』", () => {
    expect(merchantCode).not.toContain("已补齐");
  });

  it("明确写出这 9 项目前仍是空白", () => {
    expect(merchantCode).toContain("全部仍是「空白」");
  });
});
