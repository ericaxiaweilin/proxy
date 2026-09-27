// TOKEN-AS-VALUE-001
//
// 病根：把 token 的**名字**当成颜色**值**用。
//
//   backgroundColor: "color.ink"   ← 名字（字符串）。RN 的 normalizeColor 返回
//                                     null ⇒ 这个属性被**静默丢弃**：背景变透明、
//                                     文字色回退默认黑。不报错、不警告、不崩。
//   backgroundColor: color.ink     ← 值 "#17131F"。正常。
//
// 2026-09-27 之前全仓有 55 处（42 处会真的渲染出来）。第一次被看见是
// `tasks.tsx` 的活动详情 hero：`Gradient from="color.ink"` ⇒ 48 条色带全成
// rgb(NaN,NaN,NaN) ⇒ 整块渐变透明，而里面所有文字都是给深色底设计的白字
// ⇒ 标题整个看不见（用户截图确认）。修完之后一扫，同一写法还有 54 处。
//
// 这个仓库其实**早就修过一次**同类：`friend-crm.tsx` 的 `metricCardActive`
// （见 CRM-HONEST-001 的注释），但当时没留钉，于是这一类又长回来了 —— 所以
// 这里必须有钉，而且钉要扫**全仓**，不是只钉住 hero 那一个调用点。
//
// 钉三件事：
//   ① 代码里不再出现 "color.X" 字面量（注释里保留的说明文字不算）
//   ② 每一处 color.X **引用**都能在 theme.tsx 里找到同名 key
//      —— 写错名字同样得到 undefined，同样被静默丢弃，是同一类
//   ③ 几处曾经坏掉的站点保持用引用形式（钉住具体回归故事）
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) && !/\.test\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const FILES = sourceFiles(SOURCE_ROOT).map((path) => ({
  path,
  rel: relative(SOURCE_ROOT, path),
  text: readFileSync(path, "utf8")
}));

const source = (relativePath: string): string => {
  const found = FILES.find((file) => file.rel === relativePath);
  if (!found) throw new Error(`找不到源文件: ${relativePath}`);
  return found.text;
};

// 注释里的 "color.X" 是**证据**（tasks.tsx 与 friend-crm.tsx 都在讲这个 bug），
// 不能当成违规。所以扫描前先把注释挖掉。
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => prefix + " ".repeat(match.length - prefix.length));
}

// theme.tsx 的 color 对象 key。注意最后一个 key 后面**没有逗号**，逗号必须可选。
function themeColorKeys(): Set<string> {
  const block = /export const color = \{([\s\S]*?)\n\};/.exec(source("theme.tsx"));
  if (!block) throw new Error("theme.tsx 里找不到 color 对象");
  return new Set(
    [...block[1]!.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^,\n]+,?\s*$/gm)].map((m) => m[1]!)
  );
}

describe("TOKEN-AS-VALUE-001 token 名不能被当成颜色值", () => {
  it("扫描面不是空的 —— 否则这条钉会空过", () => {
    // 一个「扫不到任何文件所以通过」的钉等于没有。先钉住扫描面本身。
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((file) => file.rel === "theme.tsx")).toBe(true);
    expect(FILES.some((file) => file.rel === "surfaces/market.tsx")).toBe(true);
    expect(themeColorKeys().size).toBeGreaterThan(60);
  });

  it("全仓代码里没有 \"color.X\" 字面量", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = stripComments(file.text);
      for (const match of code.matchAll(/(?:[:=]|\?\?)\s*"(color\.[A-Za-z][A-Za-z0-9_]*)"/g)) {
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`${file.rel}:${line}  ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("每一处 color.X 引用都能在 theme.tsx 里找到同名 key", () => {
    // 名字写错同样是 undefined ⇒ 同样被 RN 静默丢弃。和字面量是同一类病。
    const keys = themeColorKeys();
    const offenders: string[] = [];
    for (const file of FILES) {
      // 只查真的从 theme 引入 color 的文件，避免把同名的局部变量算进来
      if (!/import\s*\{[^}]*\bcolor\b[^}]*\}\s*from\s*"\.\.?\/(?:\.\.\/)*theme"/.test(file.text)) continue;
      const code = stripComments(file.text);
      for (const match of code.matchAll(/\bcolor\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (keys.has(match[1]!)) continue;
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`${file.rel}:${line}  color.${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("曾经坏掉的站点保持引用形式", () => {
    // 长按 tooltip：底被丢掉之后，tipText 的 #fff 写在浅色页面上 = 字看不见。
    expect(source("components/TooltipOnLongPress.tsx")).toMatch(/tip:\s*\{[\s\S]*?backgroundColor:\s*color\.ink,/);
    expect(source("components/TooltipOnLongPress.tsx")).toMatch(/tipText:\s*\{\s*color:\s*"#fff"/);

    // 选中态：填充和描边一起丢 ⇒ 看不出哪一项被选中。
    expect(source("components/context-switcher.tsx")).toContain(
      "optActive: { backgroundColor: color.domainActiveBg, borderColor: color.ink, borderWidth: 1.5 }"
    );
    expect(source("components/context-switcher.tsx")).toContain("optIconActive: { backgroundColor: color.ink }");
    expect(source("components/location-picker-sheet.tsx")).toContain(
      "optActive: { backgroundColor: color.domainActiveBg, borderColor: color.ink, borderWidth: 1.5 }"
    );

    // 审核闸提示条 / 热价高亮 / 权益框
    expect(source("shell/app-shell.tsx")).toContain('guardWarn: { backgroundColor: color.stateDangerBg, borderColor: color.stateDangerBorder');
    expect(source("surfaces/market.tsx")).toContain("r4PriceCellHot: { backgroundColor: color.warn }");
    expect(source("surfaces/tasks.tsx")).toMatch(/benefitBox:\s*\{[\s\S]*?backgroundColor:\s*color\.inspireSavedBg/);

    // 数据表里的颜色值（不在 StyleSheet 里，但一样会被当颜色用）
    expect(source("components/benefit-home-card.tsx")).toContain("CREATOR_SEED: color.proxyPurple,");
    expect(source("surfaces/BenefitClaimScreen.tsx")).toContain('color: color.proxyPurple');
  });

  it("保留住「这一类曾经被修过一次」的证据注释", () => {
    // 这两处注释是唯一的书面线索：说明这个写法会被静默忽略、以及它修过一次。
    // 顺手删掉注释 = 把下一代人重新踩坑的门票发出去。
    //
    // ⚠️ 断言必须钉在**那句唯一的话**上，不能钉编号：`CRM-HONEST-001` 在
    // friend-crm.tsx 里出现 3 次，钉编号的话删掉这一处注释断言照样过
    // —— 反向注入第 ⑤ 轮就是这么发现它是死断言（改的是第 1 处，留下了后 2 处）。
    expect(source("surfaces/friend-crm.tsx")).toContain("原来是字符串字面量");
    expect(source("surfaces/friend-crm.tsx")).toMatch(/metricCardActive:\s*\{\s*backgroundColor:\s*color\.bottomActiveBg/);
    expect(source("surfaces/tasks.tsx")).toContain("传名字进去会得到");
    expect(source("surfaces/tasks.tsx")).toContain("别去改文字颜色");
    expect(source("surfaces/tasks.tsx")).toMatch(/<Gradient from=\{color\.ink\} to="#342446"/);
  });
});
