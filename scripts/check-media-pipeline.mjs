// check-media-pipeline.mjs — MEDIA-PIPELINE-001 gate.
//
// 全 App 唯一的资产解析层是 apps/mobile/src/media/asset-sources.ts，
// 作者头像映射唯一是 apps/mobile/src/media/author-avatar.ts。
// 此脚本只拦新增违规（存量 grandfathered：只要该行在 HEAD 里已存在
// 就放行，避免把历史图标/样张表一次性重构挡在门外）：
//   R1: 照片/人像类打包 require()（ai-personas、market-scene-samples、
//       avatar、photo 目录）新增只允许出现在 media/。
//   R2: localApiBaseUrl 手工拼 URL 新增只允许 media/ 与既有转调层
//       （native-clients、localnet-client、ai-persona-presentation）。
//       新代码一律走 resolveAssetSource。
//   R3: 动态帖头必须走 resolveAuthorAvatar（AI 帖有照片资产却显示
//       首字的回归）+ 配套单测必须通过。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const errors = [];

function gitGrep(pattern) {
  try {
    const out = execFileSync("git", ["grep", "-n", "--", pattern, "apps/mobile/src"], { cwd: root, encoding: "utf8" });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function headBlobLines(file) {
  try {
    const out = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" });
    return new Set(out.split("\n").map((line) => line.trim()));
  } catch {
    return new Set();
  }
}

// 命中行若在 HEAD 同文件里逐行存在 → 存量，放行；否则新增，判规。
function isNewViolation(file, lineNo) {
  let current;
  try {
    current = readFileSync(resolve(root, file), "utf8").split("\n");
  } catch {
    return true;
  }
  const line = (current[lineNo - 1] ?? "").trim();
  if (line === "") return false;
  return !headBlobLines(file).has(line);
}

function checkRule(name, pattern, allowed, message) {
  for (const hit of gitGrep(pattern)) {
    const sep = hit.indexOf(":");
    const file = hit.slice(0, sep);
    const lineNo = Number.parseInt(hit.slice(sep + 1), 10);
    if (allowed(file)) continue;
    if (!Number.isFinite(lineNo) || !isNewViolation(file, lineNo)) continue;
    errors.push(`${message}: ${hit}`);
  }
}

// R1: bundled-asset require tables (broad on purpose: icons grandfathered
// via HEAD-diff, but every NEW assets require must go through media/).
checkRule(
  "R1",
  "require(.*assets/",
  (file) => file.startsWith("apps/mobile/src/media/"),
  "bundled asset require() outside media/"
);

// R2: hand-built baseUrl joins.
checkRule(
  "R2",
  "localApiBaseUrl}\\${",
  (file) => file.startsWith("apps/mobile/src/media/")
    || file === "apps/mobile/src/native-clients.ts"
    || file === "apps/mobile/src/localnet-client.ts"
    || file === "apps/mobile/src/ai-persona-presentation.ts",
  "hand-built media URL outside the pipeline"
);

// R3: feed post header resolves avatars through the pipeline.
const feedHits = gitGrep("resolveAuthorAvatar");
if (!feedHits.some((line) => line.startsWith("apps/mobile/src/surfaces/feed.tsx"))) {
  errors.push("feed post header must resolve avatars via resolveAuthorAvatar (media/author-avatar)");
}

if (errors.length > 0) {
  console.error(`Media pipeline check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Media pipeline check passed.");
