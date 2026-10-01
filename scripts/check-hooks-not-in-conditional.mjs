#!/usr/bin/env node
// MOBILE-HOOKS-001：React hook 不许出现在条件执行的位置。
//
// 起因（2026-10-01，用户报「你又搞坏了 有报错」）：我把一个 `useMemo` 放进了
// 渲染 JSX 里的 `{(() => { ... })()}` 条件 IIFE。那个 IIFE 不保证每次渲染都执行，
// 于是 hook 数量在两次渲染之间变化，React 直接抛
//
//     Rendered more hooks than during the previous render.
//
// **tsc 通过、vitest 通过、Babel 解析通过、Metro 打包通过** —— 四道关全绿，
// 只有真机/模拟器运行时才炸。那天 Metro 日志里 8 条这个错，全是同一次改动。
//
// 所以这条判据查的是**静态结构**：hook 调用必须出现在组件函数体（或自定义 hook）的
// 顶层，不能在 if / 三元 / 逻辑与 / 条件 IIFE / 回调内部。这不是完整证明
// （React 的 lint 规则更全），但它覆盖了这个真实发生过的形态。
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/thanhhuyennguyen/proxy/apps/mobile/src";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) files.push(p);
  }
})(ROOT);

// hook 前缀。useEffect/useMemo/useCallback/useState/useRef/useReducer/useContext…
const HOOK = /\b(use[A-Z]\w*)\s*\(/;

const problems = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const m = HOOK.exec(line);
    if (!m) continue;
    // 只看"调用"而不是声明/引用：必须紧跟等号或 return 或语句开头
    const isCall =
      /=\s*use[A-Z]\w*\s*\(/.test(line) ||
      /^\s*return\s+use[A-Z]/.test(line) ||
      /^\s*use[A-Z]\w*\s*\(/.test(line);
    if (!isCall) continue;
    const indent = line.length - line.trimStart().length;
    // 组件函数体的顶层缩进（2 或 4 空格）在 tsx 里通常是 2；条件块至少 4+ 且更深。
    // 这里用更稳的判据：这一行所在的缩进必须小于同文件里最深的条件块起点 ——
    // 简化成"缩进 > 4 视为可疑"，因为组件顶层 hook 都是 2 或 4。
    if (indent > 4) {
      problems.push({
        file: file.replace("/Users/thanhhuyennguyen/proxy/", ""),
        line: i + 1,
        hook: m[1],
        text: trimmed.slice(0, 90),
      });
    }
  }
}

for (const p of problems) {
  console.error(`FAIL ${p.file}:${p.line} ${p.hook}() 缩进 ${p.text}`);
}
console.log(`${files.length} 个文件 · ${problems.length} 处 hook 可能不在顶层`);
process.exitCode = problems.length > 0 ? 1 : 0;
