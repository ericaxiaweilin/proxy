#!/usr/bin/env node
/**
 * compare-screens.mjs — 实现截图 vs 原型基准图的视觉比对。
 *
 * 这个仓库的 UI 对齐一直靠人眼：改完 → 截图 → 眼睛看 → 不像再改。门禁 814 条
 * grep 文本钉只证明「文案在」，不证明「长得像」——BASELINE_CHANGELOG 因此 329 次修订。
 *
 * 本脚本补上那一层。三个能力：
 *   1. **几何分析**（默认，零依赖）：不比较像素，而是从原型 HTML 里解析出
 *      spacing / fontSize / radius 的实际取值，与实现里的对应 token 对照。
 *      输出是纯文本，弱模型读了就能改 —— 这是主路径。
 *   2. **像素 diff**（有截图时）：拿实现截图与基准图算差异比例，给出结构化结果
 *      （{ pass, diffRatio, diffPixels }）。弱模型判不了「差 2px 还是 20px」，
 *      但读得懂 diffRatio —— 所以**数字给人看，图给弱模型看**，两者分工。
 *   3. **叠图输出**：diff 最大的区域标红，供人眼扫一眼。
 *
 * 用法
 * ---
 *   node scripts/compare-screens.mjs --list                    # 有哪些可比的
 *   node scripts/compare-screens.mjs --geometry               # 几何对照（零依赖）
 *   node scripts/compare-screens.mjs --pixel shot.png --for wallet
 *   node scripts/compare-screens.mjs --pixel shot.png --for wallet --threshold 0.1
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGES = join(ROOT, "docs/design/baseline-images");
const MANIFEST = join(IMAGES, "manifest.json");
const OUT_DIR = join(ROOT, "docs/design/visual-diffs");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

// ── 几何分析：原型 CSS 里的实际取值 ────────────────────────────────────────
// 判据来自实测的高频事实规范（见 Proxy_App_Design_Tokens_R3.json 的 spacing.note）：
// 原型里 6/7/9/10/14/18 这些「R3 规范允许但 R2 没收录」的值出现得最多。
// 这里不判「对错」，只报**原型实际用了什么** —— 那是实现该对齐的目标。
const SPACING_PROPS =
  /\b(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?\s*:\s*(\d+(?:\.\d+)?)px/gi;
const FONT_PROPS = /\bfont-size\s*:\s*(\d+(?:\.\d+)?)px/gi;
const RADIUS_PROPS = /\bborder-radius\s*:\s*(\d+(?:\.\d+)?)px/gi;

function tally(html, re) {
  const counts = new Map();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(html))) {
    const v = Number(m[1]);
    if (!Number.isFinite(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function geometryReport() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const entries = Object.entries(manifest.prototypes ?? {});
  if (!entries.length) {
    console.error("没有基准图。先跑：node scripts/render-prototypes.mjs");
    return 1;
  }
  console.log("=".repeat(78));
  console.log("原型几何对照 —— 实现该对齐的目标值（零依赖，不比像素）");
  console.log("=".repeat(78));
  for (const [name, meta] of entries) {
    const src = join(ROOT, meta.source);
    if (!existsSync(src)) continue;
    const html = readFileSync(src, "utf8");
    const sp = tally(html, SPACING_PROPS).slice(0, 6);
    const fs = tally(html, FONT_PROPS).slice(0, 6);
    const ra = tally(html, RADIUS_PROPS).slice(0, 5);
    const fmt = (list) => list.map(([v, n]) => `${v}(${n})`).join(" ") || "—";
    console.log(`\n── ${name}`);
    console.log(`   spacing : ${fmt(sp)}`);
    console.log(`   fontSize: ${fmt(fs)}`);
    console.log(`   radius  : ${fmt(ra)}`);
  }
  console.log("\n" + "=".repeat(78));
  console.log("这些是原型**实际使用**的取值，不是评判标准 —— 实现可以有别的选择，");
  console.log("但差距大的地方就是「看起来不像」的来源。逐值对照用 proxy-ui-review。");
  console.log("=".repeat(78));
  return 0;
}

// ── 像素 diff ──────────────────────────────────────────────────────────────
// 用纯 JS 解 PNG 太重；这里走 macOS 自带的 sips + Python(PIL 不可用时的兜底)，
// 所以先探测可用的比较后端。
function findTool() {
  for (const t of ["magick", "compare"]) {
    try {
      execFileSync("which", [t], { stdio: "ignore" });
      return t;
    } catch { /* 继续找 */ }
  }
  return null;
}

function pngSize(path) {
  const d = readFileSync(path).subarray(0, 24);
  if (d.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
}

function resolveBaseline(key) {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const k = String(key).toLowerCase();
  for (const [name, meta] of Object.entries(manifest.prototypes ?? {})) {
    const slug = meta.image.split("/").pop().replace(/\.png$/, "");
    if (name.toLowerCase().includes(k) || slug.includes(k)) return { name, meta };
  }
  return null;
}

function pixelReport(shotPath, key, threshold) {
  const hit = resolveBaseline(key);
  if (!hit) {
    console.error(`没有匹配「${key}」的基准图。可用：`);
    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
    for (const [n, m] of Object.entries(manifest.prototypes ?? {})) {
      console.error(`  ${m.image.split("/").pop()}  ← ${n}`);
    }
    return 1;
  }
  const basePath = join(ROOT, hit.meta.image);
  if (!existsSync(shotPath)) {
    console.error(`实现截图不存在：${shotPath}`);
    return 1;
  }
  const a = pngSize(basePath);
  const b = pngSize(shotPath);
  console.log("=".repeat(78));
  console.log(`像素比对：${shotPath}`);
  console.log(`      基准：${hit.meta.image}（${hit.name}）`);
  console.log("=".repeat(78));
  console.log(`  基准尺寸 ${a.width}×${a.height} · 实现尺寸 ${b.width}×${b.height}`);
  if (a.width !== b.width || a.height !== b.height) {
    console.log("");
    console.log("  尺寸不同 —— 像素比对要求同尺寸（都应是 @2x 截图）。");
    console.log("  先把实现截图按基准尺寸裁剪/缩放，否则任何差异比例都没有意义。");
    console.log("  这一条本身常常就是答案：布局宽度或安全区处理不一致。");
    return 1;
  }
  const tool = findTool();
  if (!tool) {
    console.log("");
    console.log("  没有 ImageMagick（magick/compare）—— 装它才能算像素 diff：");
    console.log("    brew install imagemagick");
    console.log("  在那之前可以用 --geometry 做零依赖的几何对照。");
    return 1;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const diffPath = join(OUT_DIR, `${hit.meta.image.split("/").pop().replace(/\.png$/, "")}-vs-shot.png`);
  // ⚠️ 必须用 spawnSync 而不是 execFileSync：`compare -metric AE` 把差异数写
  // **stderr**（ImageMagick 一直如此），而 execFileSync 成功分支只把 stdout 作为
  // 返回值、stderr 只有在 spawn 层才能取到（e.stderr 是 Error 上的属性，成功时不
  // 存在）。第一版用 execFileSync + 读 stdout ⇒ 永远拿到空串 ⇒ NaN ⇒ 假绿。
  // 差异为零时 magick 还会 exit 0，有差异时 exit 1，两者都要读 stderr。
  const proc = spawnSync(
    tool,
    ["compare", "-metric", "AE", basePath, shotPath, diffPath],
    { encoding: "utf8" }
  );
  const diffText = String(proc.stderr ?? "").trim() || String(proc.stdout ?? "").trim();
  if (proc.error) {
    console.log(`  [FAIL] 跑 ${tool} 失败：${proc.error.message}`);
    console.log("=".repeat(78));
    return 1;
  }
  // ⚠️ ImageMagick v7 的 `-metric AE` 输出是 `0 (0)` 这种带括号形式，v6 是纯数字。
  //   第一版只取 split(/\s+/)[0]，碰上括号整段作废 → Number("") = NaN，而 NaN 又
  //   被当成「通过」—— 实测**自己跟自己比报 0.00% PASS**，是假绿，最坏的一类。
  //   所以两件事：解析兼容括号；解析不出来必须判红，绝不判绿。
  const metricMatch = /(-?[\d.]+(?:[eE][-+]?\d+)?)/.exec(diffText);
  const diffPixels = metricMatch ? Number(metricMatch[1]) : NaN;
  const total = a.width * a.height;
  const ratio = diffPixels / total;
  const pass = Number.isFinite(ratio) && ratio <= threshold;
  console.log("");
  // ⚠️ ImageMagick 7.1.x 的 Q16-HDRI 构建对 AE 也返回浮点（实测 `26613.9 (0.0202135)`），
  // 而 v6 是纯整数。像素个数按定义是整数，所以对外一律取整 —— 直接把 26613.9 打出来
  // 会让人以为工具坏了。括号里那份是归一化比例，ImageMagick 自己给的。
  const shownPixels = Number.isFinite(diffPixels) ? Math.round(diffPixels) : null;
  console.log(`  差异像素 ${shownPixels ?? "解析失败（原始输出 " + JSON.stringify(diffText) + "）"}`);
  console.log(`  差异比例 ${Number.isFinite(ratio) ? (ratio * 100).toFixed(2) + "%" : "n/a"}（阈值 ${(threshold * 100).toFixed(0)}%）`);
  if (!Number.isFinite(ratio)) {
    console.log("");
    console.log("  [FAIL] 无法解析差异像素数 —— 判定无效，不许当成通过。");
    console.log("         （ImageMagick 输出格式可能变了：手跑 `magick compare -metric AE a.png b.png d.png` 看原始输出）");
    console.log("=".repeat(78));
    return 1;
  }
  // 浮点像素数说明工具是 HDRI 构建，比例仍可用；但四舍五入后若与原值差太多要提示 ——
  // 那通常意味着我们匹配到的根本不是 AE 那一列数字。
  if (Number.isFinite(diffPixels) && Math.abs(diffPixels - Math.round(diffPixels)) > 0.5) {
    console.log(`  注：${tool} 报的是浮点（HDRI 构建），已取整；原始值 ${diffPixels}`);
  }
  console.log(`  结论     ${pass ? "[PASS]" : "[DIFF]"}`);
  console.log(`  diff 图：${diffPath}`);
  writeFileSync(
    join(OUT_DIR, `${hit.meta.image.split("/").pop().replace(/\.png$/, "")}-report.json`),
    JSON.stringify(
      {
        prototype: hit.name,
        baseline: hit.meta.image,
        shot: shotPath,
        size: a,
        // 整数：AE 是像素个数，HDRI 构建会给浮点，下游按整数用（见上面的注）。
        diffPixels: Number.isFinite(diffPixels) ? Math.round(diffPixels) : null,
        diffRatio: ratio,
        rawMetricOutput: diffText,
        threshold,
        pass,
        diffImage: diffPath,
      },
      null,
      2
    ) + "\n"
  );
  console.log("");
  console.log("  注意：像素 diff 只能告诉你「有多少不一样」，不能告诉你「哪不一样」。");
  console.log("  弱模型读数字（diffRatio）就够了；要定位就打开 diff 图看红色区域。");
  console.log("=".repeat(78));
  return pass ? 0 : 1;
}

function list() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const rows = Object.entries(manifest.prototypes ?? {});
  console.log(`基准图 ${rows.length} 张：`);
  for (const [n, m] of rows) {
    const p = join(ROOT, m.image);
    const ok = existsSync(p);
    console.log(`  ${ok ? "✓" : "✗"} ${n.padEnd(52)} ${m.image.split("/").pop()}`);
  }
  console.log("");
  console.log("比像素：node scripts/compare-screens.mjs --pixel <实现截图.png> --for <上面的名字片段>");
  console.log("比几何：node scripts/compare-screens.mjs --geometry");
  return 0;
}

if (has("--list")) process.exit(list());
if (has("--geometry")) process.exit(geometryReport());
if (has("--pixel")) {
  const shot = val("--pixel", "");
  const key = val("--for", "");
  if (!shot || !key) {
    console.error("用法：--pixel <截图路径> --for <基准图名字片段>");
    process.exit(2);
  }
  process.exit(pixelReport(shot, key, Number(val("--threshold", "0.05"))));
}
console.log("用法：--list | --geometry | --pixel <shot.png> --for <name> [--threshold 0.05]");
process.exit(2);
