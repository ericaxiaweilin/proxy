#!/usr/bin/env node
// 用 Metro 实际使用的那套 Babel parser 逐个解析移动端源文件。
// 为什么需要它：tsc 通过 ≠ Metro 能打包。Metro 走 @babel/parser，对某些写法
// （比如 JSX 相邻元素、await 出现在非 async 函数里）的判定与 tsc 不同 ——
// 2026-10-01 就出现过：typecheck 全绿、vitest 全绿，模拟器却白屏，Metro 日志里
// 1769 条 SyntaxError。所以"编译过"必须以 Metro 那套 parser 为准。
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("/Users/thanhhuyennguyen/proxy/node_modules/.pnpm/@babel+parser@7.29.8/node_modules/@babel/parser");

const ROOT = "/Users/thanhhuyennguyen/proxy/apps/mobile/src";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  try {
    parser.parse(readFileSync(f, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    bad += 1;
    console.error(`FAIL ${f.replace("/Users/thanhhuyennguyen/proxy/", "")}: ${e.message}`);
  }
}
console.log(`${files.length} 个文件 · ${bad} 个 Babel 解析失败`);
process.exitCode = bad > 0 ? 1 : 0;
