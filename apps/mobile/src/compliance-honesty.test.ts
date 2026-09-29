import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
  it("采集闸的默认状态是关，不是开", () => {
    expect(meCode).toContain("const [behaviorAnalytics, setBehaviorAnalytics] = useState(false);");
  });

  it("读不到 / 读失败都算未同意：闸是 `=== true`，不是 `!== false`", () => {
    expect(impressionCode).toContain("return (await activeStore.read()) === true;");
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
  });

  it("法条依据留在文件里（文档性断言，跑在原始源码上）", () => {
    // 法条号只可能出现在注释里 —— 剥注释断言这条等于没断言，所以这里用原始源码。
    expect(settingsSource).toContain("Art. 6.3");
    expect(settingsSource).toContain("4.1(l)");
    // undefined 的语义必须写明是"没表达过意愿"，不是同意。
    expect(settingsSource).toContain("不等于同意");
  });

  it("开关文案说全三个真实用途，并点明是敏感数据、默认关闭", () => {
    // 用途不全 = 目的不符（NĐ 330/2026 Điều 39.1(a)）。
    expect(meCode).toContain("给你推更对味的内容");
    expect(meCode).toContain("AI 分身 · 好友洞察");
    expect(meCode).toContain("平台运营侧可查看逐人明细");
    // 征求敏感数据同意时要明确告知这是敏感数据。
    expect(meCode).toContain("敏感个人数据");
    expect(meCode).toContain("默认关闭");
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
