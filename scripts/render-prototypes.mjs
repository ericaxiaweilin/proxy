#!/usr/bin/env node
/**
 * render-prototypes.mjs — 把 docs/design/references/*.html 渲染成基准图。
 *
 * 为什么需要它
 * ------------
 * 现有门禁 814 条全是 grep 文本钉，几何断言 17 条，**视觉比对 0 条**。所以「实现像不像
 * 原型」从来没被机器验证过 —— 每轮都靠人眼看截图，发现不像就改，改完钉住**文案**
 * （不是长相），门禁就绿了。这就是 BASELINE_CHANGELOG 堆到 329 次修订的机制性原因。
 *
 * Proxy_App_Design_Tokens_R3.json 补的是**数值**对齐（spacing / fontSize / radius），
 * proxy-ui-review 补的是**文案**对齐。两者都证明不了「渲染出来像不像」。
 * 这个脚本补的就是那一层：把原型变成像素，让 diff 有基准可打。
 *
 * 为什么能用 Chrome 直接渲染
 * --------------------------
 * 实测这 31 个原型**零外部依赖**（无 CDN / 无远程字体 / 无外链图片），字体全是系统字体
 * （-apple-system / PingFang SC / Microsoft YaHei）—— 与 RN 侧 font-family 声明一致。
 * 所以离线 headless 渲染出来的就是设计意图本身，不需要 mock 网络。
 *
 * 尺度约定（重要）
 * --------------
 * viewport 固定 **390×844**（R3 规范的 baseViewport，也是 iPhone 12/13/14 的逻辑尺寸）。
 * 原型 HTML 多数是 max-width:420 居中卡片式，在 390 宽下不会被压缩变形。
 * 页面高于 844 时截全页（--full-page），不做裁剪 —— 裁剪会丢掉「下面还有什么」这个
 * 本身就是对齐信号的事实。
 *
 * 用法
 * ---
 *   node scripts/render-prototypes.mjs                 # 渲染全部（增量：有变更才重渲）
 *   node scripts/render-prototypes.mjs --force         # 强制全量重渲
 *   node scripts/render-prototypes.mjs --only wallet   # 只渲文件名含 wallet 的
 *   node scripts/render-prototypes.mjs --list          # 列出原型与基准图对应关系
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "docs/design/references");
const OUT_DIR = join(ROOT, "docs/design/baseline-images");

// R3 §Shape/Grid/Size 的 baseViewport。改这里等于改比对尺度 —— 别随手改。
const VIEWPORT = { width: 390, height: 844 };

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const LIST = args.includes("--list");

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

function prototypes() {
  if (!existsSync(SRC_DIR)) return [];
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => {
      const base = f.replace(/\.html$/, "");
      // Proxy_Wallet_20260929_0a2f07 → wallet_0a2f07（去掉 Proxy_ 前缀，文件名短一点好读）
      const short = base.replace(/^Proxy_/, "").toLowerCase();
      return { file: f, base, slug: short, html: join(SRC_DIR, f) };
    })
    .filter((p) => (ONLY ? p.slug.includes(ONLY.toLowerCase()) || p.base.includes(ONLY) : true));
}

function fingerprint(htmlPath) {
  // 用「文件内容 + 尺度」做指纹：内容变了或尺度变了才重渲。
  const h = createHash("sha1");
  h.update(readFileSync(htmlPath));
  h.update(`${VIEWPORT.width}x${VIEWPORT.height}`);
  return h.digest("hex").slice(0, 16);
}

function render(chrome, proto, outPath) {
  // --virtual-time-budget 给 JS 一点时间跑完（原型里有 1 个 <script>）
  // --hide-scrollbars 去掉滚动条，否则截图宽度会差几个像素 —— 那是噪声不是差异。
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2", // 2x Retina，便于看清细节差异
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--virtual-time-budget=4000",
      `--screenshot=${outPath}`,
      `file://${proto.html}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  return existsSync(outPath) && statSync(outPath).size > 1024;
}

/**
 * 少数原型是**设计评审台**而不是手机屏：`.proto{display:grid;grid-template-columns:
 * 214px minmax(370px,430px) 300px}` —— 左边标注、中间手机、右边说明，总宽 1110px。
 * 直接按 390 截会得到一张被横向裁掉的废图（实测：Market_Opportunity_Filter_R7 就是
 * 这样，右半截机会卡直接不见）。所以对这类原型要先把非目标栏隐藏，只留中间的手机。
 *
 * 判据用 CSS 里的 grid-template-columns 而不是文件名 —— 文件名不承诺结构。
 * 2026-09-30 实测 31 个原型里只有 1 个是评审台，其余 30 个都是真正的手机视图。
 */
function reviewStageCss(width) {
  return `
    /* 精确对齐：body/html 与 .phone 同宽同高，overflow 全关。少这一句就会出现
       几十像素的横向溢出，表现为右边缘卡被切掉一截（实测三次才定位到）。 */
    html, body { width: ${width}px !important; max-width: ${width}px !important;
                 overflow: hidden !important; margin: 0 !important; padding: 0 !important;
                 background: #fff !important; }
    /* render-prototypes.mjs 注入：只留评审台中间的手机栏 */
    .proto { grid-template-columns: minmax(0, 1fr) !important; max-width: 100% !important;
             padding: 0 !important; margin: 0 !important; gap: 0 !important; }
    .proto > *:not(.phone) { display: none !important; }
    /* .phone 自己声明 max-width:410px（= 设计稿的手机宽度）。硬拉成 100vw(390) 会把
       屏内布局挤变形、右侧内容顶出视口被切（实测右侧「查看 & 报价」被切掉一截）。
       所以按它自己的宽度渲染，窗口开 410 宽；只把外壳（边框/圆角/内边距）归零，
       留下屏内画面。窗口宽度由 reviewStageViewport() 提供。 */
    .phone { width: 100% !important; max-width: none !important; margin: 0 !important;
             border: 0 !important; border-radius: 0 !important; padding: 0 !important;
             min-height: 100vh !important; overflow: visible !important; }
  `;
}

function needsReviewStageCrop(htmlPath) {
  const src = readFileSync(htmlPath, "utf8");
  return /\.proto\s*\{[^}]*grid-template-columns/.test(src);
}

/**
 * 注入裁切 CSS 后渲染。
 * 用 file:// 的 URL fragment 不行（CSS 得进 <head>），所以生成一份带注入的临时副本，
 * 放在原型同目录旁边（保证相对路径的资源引用仍然有效 —— 这些原型虽然无外部依赖，
 * 但同目录放置能免掉一切意外），渲染完删掉。
 */
/**
 * 取评审台原型 .phone 自己声明的宽度（默认 410）。窗口要按它开，否则内容被切。
 * 解析不出就用 410 —— 那是这批原型的实际设计宽度。
 */
function reviewStageViewport(htmlPath) {
  const src = readFileSync(htmlPath, "utf8");
  const m = /\.phone\s*\{[^}]*max-width:\s*(\d+)px/.exec(src);
  return Number(m?.[1] ?? 410);
}

function renderWithCrop(chrome, proto, outPath, css) {
  const width = reviewStageViewport(proto.html);
  // shim 放**系统临时目录**，不放原型目录。放同目录是为了保相对路径，但实测这些原型
  // 零外部依赖（无 CDN / 无外链图片），不需要；而放同目录时一旦渲染失败，finally
  // 之前崩掉就会留下 __render_shim__.html 污染 git status（还没被 .gitignore 覆盖）。
  const injected = join(tmpdir(), `render-shim-${process.pid}-${proto.slug}.html`);
  const src = readFileSync(proto.html, "utf8");
  const patched = src.includes("</head>")
    ? src.replace("</head>", `<style>${css}</style></head>`)
    : `<style>${css}</style>${src}`;
  writeFileSync(injected, patched);
  try {
    execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--window-size=${width},${VIEWPORT.height}`,
        "--virtual-time-budget=4000",
        `--screenshot=${outPath}`,
        `file://${injected}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } finally {
    try { rmSync(injected, { force: true }); } catch { /* 清理失败不致命 */ }
  }
  return existsSync(outPath) && statSync(outPath).size > 1024;
}

/** 读已存在的 manifest（可能不存在）。--list 与渲染共用。 */
function manifest0() {
  const p = join(OUT_DIR, "manifest.json");
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { prototypes: {} };
  } catch {
    return { prototypes: {} };
  }
}

function main() {
  const all = prototypes();
  if (!all.length) {
    console.error(`没有找到原型（${SRC_DIR}）`);
    return 1;
  }

  if (LIST) {
    // ⚠️ 这里**必须算指纹**，不能只看 PNG 在不在 —— 门禁（UI-PROTO-ALIGN-001）靠本命令
    // 的输出判断基准是否过期，而「PNG 存在」不等于「基准新鲜」。第一版只判存在性，
    // 于是「原型 HTML 改了但没重渲」能通过门禁（2026-09-30 实测证伪失败）。
    console.log("原型 → 基准图（共 " + all.length + " 个）");
    const prev = manifest0();
    let stale = 0;
    for (const p of all) {
      const out = join(OUT_DIR, `${p.slug}.png`);
      const has = existsSync(out);
      const fresh = has && prev.prototypes?.[p.base]?.fingerprint === fingerprint(p.html);
      if (!fresh) stale++;
      const size = has ? `${Math.round(statSync(out).size / 1024)}KB` : "—";
      const mark = fresh ? "✓" : has ? "↑" : "·";
      console.log(`  ${mark} ${p.file.padEnd(46)} → ${p.slug}.png  ${size}${has && !fresh ? "  (HTML 已改，需重渲)" : ""}`);
    }
    console.log(`  —— 缺失或过期：${stale} / ${all.length}`);
    return 0;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error("找不到 Chrome / Chromium。装一个，或手动截图后放进 " + OUT_DIR);
    return 69;
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const manifestPath = join(OUT_DIR, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  manifest.viewport = VIEWPORT;
  manifest.prototypes = manifest.prototypes ?? {};

  let rendered = 0;
  let skipped = 0;
  const failed = [];

  for (const p of all) {
    const out = join(OUT_DIR, `${p.slug}.png`);
    const fp = fingerprint(p.html);
    const prev = manifest.prototypes[p.base];
    if (!FORCE && existsSync(out) && prev?.fingerprint === fp) {
      skipped++;
      continue;
    }
    try {
      const ok = needsReviewStageCrop(p.html)
        ? renderWithCrop(chrome, p, out, reviewStageCss(reviewStageViewport(p.html)))
        : render(chrome, p, out);
      if (ok) {
        manifest.prototypes[p.base] = {
          source: `docs/design/references/${p.file}`,
          image: `docs/design/baseline-images/${p.slug}.png`,
          fingerprint: fp,
          viewport: needsReviewStageCrop(p.html) ? { ...VIEWPORT, width: reviewStageViewport(p.html) } : VIEWPORT,
          // 评审台原型：渲染时注入了裁切 CSS 只留手机栏。改这个标记要同步改
          // needsReviewStageCrop 的判据，否则会以为它是普通手机视图。
          reviewStageCrop: needsReviewStageCrop(p.html) || undefined,
        };
        rendered++;
        process.stdout.write(`  ✓ ${p.slug}.png\n`);
      } else {
        failed.push(p.slug);
        process.stdout.write(`  ✗ ${p.slug}.png（截图过小，渲染失败）\n`);
      }
    } catch (e) {
      failed.push(p.slug);
      process.stdout.write(`  ✗ ${p.slug}.png  ${String(e.message).slice(0, 90)}\n`);
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("");
  console.log(
    `渲染 ${rendered} · 跳过（未变）${skipped} · 失败 ${failed.length} · 共 ${all.length}`
  );
  console.log(`输出目录：${OUT_DIR}`);
  if (failed.length) {
    console.error("失败：" + failed.join(", "));
    return 1;
  }
  return 0;
}

process.exit(main());
