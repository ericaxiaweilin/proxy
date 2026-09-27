import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// ACTIVITY-DETAIL-HERO-001 — 「活动详情 hero 整块文字看不见」。
//
// 症状：活动详情里「平台 AI 小美 · 周末企划」、标题「Proxy 周末咖啡企划」、
// 描述、价格全部几乎不可见（白字画在浅色页面上），但同块的「平台」徽章正常。
// 2026-09-27 截图实测确认。
//
// 病根**不在文字颜色**，在渐变参数上：
//   `<Gradient from="color.ink" to="#342446">` —— 传的是 token **名字**，
//   而 Gradient 要的是颜色**值**。theme.tsx 里 Gradient 拿 from 直接
//   `backgroundColor: from`，并且 `lerpHex(from, to, t)`；lerpHex 是按 hex
//   切片 parseInt 的，传 "color.ink" 进去：
//     parse("color.ink") = [parseInt("ol",16), parseInt("or",16), parseInt(".i",16)]
//                        = [NaN, NaN, NaN]
//   ⇒ 返回 "rgb(NaN,NaN,NaN)"（非法）⇒ 48 条色带全部不渲染；
//   ⇒ 加上 backgroundColor 也非法 ⇒ 整块 hero 静默变透明。
//
// 而这块里所有文字都是**给深色底设计的**（detailTitle / detailPriceStrong /
// detailAIPersonaName 是 color.white，desc 是 #D8D1DF，价格小字是 #CFC6D8），
// 底一透明就成了「浅色页面上写白字」—— 标题整个消失。
//
// 为什么值得钉：这个错**不报错、不崩溃、类型也查不出来**（from 的签名就是
// string）。它只在真机截图上表现为「文字没了」，很容易被误诊成文字颜色写错，
// 于是去改 detailTitle 的颜色 —— 越改越偏。所以钉两件事：
//   ① 调用点必须传值（这一条会拦住本次的 bug）；
//   ② hero 的文字必须是浅色（这一条说明为什么底透明是致命的）。

/** 递归收集 src 下的 ts/tsx 源文件（跳过测试与 node_modules）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

describe("ACTIVITY-DETAIL-HERO-001 活动详情 hero 的渐变底", () => {
  const tasks = source("./surfaces/tasks.tsx");

  it("hero 传的是颜色值，不是 token 名字", () => {
    expect(tasks).toContain("<Gradient from={color.ink} to=\"#342446\" style={styles.detailHero}>");
    expect(tasks).not.toContain('from="color.ink"');
  });

  it("全仓没有第二个「把 token 名当颜色值」的调用点", () => {
    // 同类错法扫全仓：from="color.xxx" / to="color.xxx"。
    // 只认「字面量里出现 color.」这一种写法 —— 正确写法是 {color.xxx}（花括号）。
    const offenders: string[] = [];
    for (const file of walk(fileURLToPath(new URL(".", import.meta.url)))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\b(from|to)="color\.[A-Za-z]+"/g)) {
        offenders.push(`${file.replace(/.*\/apps\/mobile\/src\//, "")}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Gradient 拿 from 当值用（所以传名字必然透明，不是风格问题）", () => {
    const theme = source("./theme.tsx");
    // 这两行是病根的依据：值直接用、以及按 hex 解析。
    expect(theme).toContain("backgroundColor: from");
    expect(theme).toContain("lerpHex(from, to,");
  });

  it("lerpHex 按 hex 切片解析 —— 非 hex 输入得到 NaN 而不是抛错", () => {
    const theme = source("./theme.tsx");
    // 钉住「静默」这两个字：它不抛异常，只是产出非法颜色。
    // 哪天改成抛错，这条会红，提醒重看上面那段注释的结论。
    expect(theme).toContain("hex.slice(1, 3)");
    expect(theme).toContain("`rgb(${r},${g},${bl})`");
  });

  it("color.ink 是 hex 值（所以 {color.ink} 传进去才有效）", () => {
    const theme = source("./theme.tsx");
    expect(theme).toMatch(/ink: "#[0-9A-Fa-f]{6}"/);
  });

  it("hero 里的文字是给深色底设计的 —— 底一透明就看不见", () => {
    // 这条不是重复上面那条，它钉的是**为什么这个 bug 致命**：
    // 如果哪天 hero 文字改成深色，底透明就不再是「看不见」而是「难看」，
    // 严重程度变了，值得重新评估。
    expect(tasks).toMatch(/detailTitle: \{ color: color\.white/);
    expect(tasks).toMatch(/detailAIPersonaName: \{ color: color\.white/);
    expect(tasks).toMatch(/detailDesc: \{ color: "#D8D1DF"/);
  });
});
