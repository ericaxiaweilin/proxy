import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/design/CURRENT_BASELINE.json");
const contractsPath = resolve(root, "docs/design/IMPLEMENTATION_CONTRACTS.json");
const errors = [];

// DESIGN-STATUS-ENUM-001：这两个 `status` 是**枚举**，但门禁只把它们跟字面量比
// （`=== "ACTIVE_SCREEN_REFERENCE"` / `=== "PARTIAL"`）。于是**拼错一个字母就等于
// 把那条检查静默关掉** —— 实测（2026-09-30）：把某个 active scope 的 status 拼错、
// 顺手 bump `baselineRevision`、再删掉它的 implementation contract，门禁照样
// `passed`；而 status 拼对时同一份文件报 `active scope has no implementation contract`。
// 一个字符之差，守卫消失。所以这里显式列出合法取值：新增一种状态**必须**改这里，
// 那正是我们想要的「被迫做一次决定」，而不是让它悄悄生效。
const SCREEN_REFERENCE_STATUSES = new Set([
  "ACTIVE_SCREEN_REFERENCE",
  "ACTIVE_IMPLEMENTATION_REFERENCE",
  "FUNCTIONAL_REFERENCE_ONLY"
]);
const CONTRACT_STATUSES = new Set(["PARTIAL", "SCAFFOLD_ONLY", "IMPLEMENTED"]);

// DESIGN-BASELINE-UNREAD-FIELDS-001：下面这些字段原来「写了就没人读」—— 和上面的
// status 是同一个病。`schemaVersion` / `global.status` / `integration.workspaceMode` /
// `integration.externalAgentMode` 四个字段**没有任何代码读**，所以它们可以随便写、
// 写错也没人知道；`integration.recoveryBaselineTag` 更严重：它声明了一个
// 「出事就回到这里」的恢复点，而实测那个 tag 在本地和远端**都不存在**，门禁照过 ——
// 恢复计划一直是空的。声明了就得有人确认它还成立，否则它会静默烂掉。
// 每个取值显式列出：新增一种**必须**改这里，那正是我们想要的「被迫做一次决定」。
const SCHEMA_VERSIONS = new Set([1]);
const GLOBAL_STATUSES = new Set(["ACTIVE"]);
const WORKSPACE_MODES = new Set(["SINGLE_WRITER", "MULTI_WRITER"]);
const EXTERNAL_AGENT_MODES = new Set(["ISOLATED_WORKTREE"]);

let manifest;

if (!existsSync(manifestPath)) {
  errors.push("missing docs/design/CURRENT_BASELINE.json");
} else {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Number.isInteger(manifest.baselineRevision) || manifest.baselineRevision < 1) {
    errors.push("baselineRevision must be a positive integer");
  }
  // 下面这一组是 DESIGN-BASELINE-UNREAD-FIELDS-001：把原来没人读的字段逐个接上。
  if (!SCHEMA_VERSIONS.has(manifest.schemaVersion)) {
    errors.push(`schemaVersion is not a known schema: ${JSON.stringify(manifest.schemaVersion)} — expected one of ${[...SCHEMA_VERSIONS].join(", ")}`);
  }
  if (!GLOBAL_STATUSES.has(manifest.global?.status)) {
    errors.push(`global.status is not a known status: ${JSON.stringify(manifest.global?.status)} — expected one of ${[...GLOBAL_STATUSES].join(", ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.updatedAt ?? "") || Number.isNaN(Date.parse(manifest.updatedAt))) {
    errors.push(`updatedAt must be a YYYY-MM-DD date: ${JSON.stringify(manifest.updatedAt)}`);
  }
  if (!WORKSPACE_MODES.has(manifest.integration?.workspaceMode)) {
    errors.push(`integration.workspaceMode is not a known mode: ${JSON.stringify(manifest.integration?.workspaceMode)} — expected one of ${[...WORKSPACE_MODES].join(", ")}`);
  }
  if (!EXTERNAL_AGENT_MODES.has(manifest.integration?.externalAgentMode)) {
    errors.push(`integration.externalAgentMode is not a known mode: ${JSON.stringify(manifest.integration?.externalAgentMode)} — expected one of ${[...EXTERNAL_AGENT_MODES].join(", ")}`);
  }
  // RECOVERY-TAG-EXISTS-001：声明的恢复 tag 必须真的能解析。空串 / 缺失视为「没声明」，
  // 不报错；一旦写了名字，它就必须在。这修的正是「恢复计划是空的而没人知道」。
  const recoveryTag = manifest.integration?.recoveryBaselineTag;
  if (recoveryTag) {
    try {
      execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${recoveryTag}`], { cwd: root, stdio: "pipe" });
    } catch {
      errors.push(`integration.recoveryBaselineTag does not resolve to a tag: ${recoveryTag}`);
    }
  }
  // BASELINE-PATH-ROT-001：基线里声明的**每一条文件路径**都必须真的存在。
  // 原来只校验 4 个固定字段 + ACTIVE screenReferences[].file，其余字段写了就没人管
  // —— 2026-09-29 的文档归位（`07de8313`）把 `docs/architecture/*` 搬到 `architecture/*`
  // 之后，`integration.policy` 一直指着已经不存在的路径，而门禁照过。
  // 凡是「声明了但没人校验」的路径都会这样烂掉，所以这里改成显式列举 (字段名, 路径)，
  // 报错时直接说出是**哪个字段**烂了，而不是只给一个文件名。
  const declaredPaths = [
    ["global.designSystem", manifest.global?.designSystem],
    ["global.visualReference", manifest.global?.visualReference],
    ["production.iconRegistry", manifest.production?.iconRegistry],
    ["production.theme", manifest.production?.theme],
    ["production.uiFoundation", manifest.production?.uiFoundation],
    ["production.uiFoundationContract", manifest.production?.uiFoundationContract],
    ["integration.policy", manifest.integration?.policy]
  ];
  for (const [index, entry] of (manifest.screenReferences ?? []).entries()) {
    if (!SCREEN_REFERENCE_STATUSES.has(entry.status)) {
      errors.push(`screenReferences[${index}].status is not a known status: ${JSON.stringify(entry.status)} — expected one of ${[...SCREEN_REFERENCE_STATUSES].join(", ")}`);
    }
    declaredPaths.push([`screenReferences[${index}].file`, entry.file]);
    declaredPaths.push([`screenReferences[${index}].implementationBaseline`, entry.implementationBaseline]);
    // `version` 原来也是写了没人读的自由字段。
    if (entry.version !== undefined && (typeof entry.version !== "string" || entry.version.trim() === "")) {
      errors.push(`screenReferences[${index}].version must be a non-empty string when present`);
    }
    // SOURCE-MOCKUP-PATH-001：`implementationStatus` 是一串自由文本，之前它用
    // **Downloads 里的下载名**（`deepseek_html_2026xxxx_xxxxxx.html`）来指原型 ——
    // 那个名字在仓库里永远解析不到，而且没有任何东西会去查。现在原型归档到
    // `docs/design/references/` 之后，用 `sourceMockups[]` 记**仓内路径**并校验存在，
    // 引用就从「一句无法核实的话」变成「一条会被检查的路径」。
    for (const [mockupIndex, mockup] of (entry.sourceMockups ?? []).entries()) {
      declaredPaths.push([`screenReferences[${index}].sourceMockups[${mockupIndex}]`, mockup]);
    }
  }
  for (const [index, entry] of (manifest.legacy ?? []).entries()) {
    if (typeof entry === "string") declaredPaths.push([`legacy[${index}]`, entry]);
  }

  for (const [field, file] of declaredPaths) {
    if (!file) continue;
    if (!existsSync(resolve(root, file))) errors.push(`${field} does not exist: ${file}`);
  }

  for (const entry of manifest.screenReferences ?? []) {
    if (entry.status === "ACTIVE_SCREEN_REFERENCE" && /(^|\/)archive\//.test(entry.file ?? "")) {
      errors.push(`active screen reference cannot point into archive: ${entry.scope}`);
    }
  }

  try {
    const previous = JSON.parse(execFileSync("git", ["show", "HEAD:docs/design/CURRENT_BASELINE.json"], { cwd: root, encoding: "utf8" }));
    if ((manifest.baselineRevision ?? 0) < (previous.baselineRevision ?? 0)) {
      errors.push(`baselineRevision regressed from ${previous.baselineRevision} to ${manifest.baselineRevision}`);
    }
    const currentByScope = new Map((manifest.screenReferences ?? []).map((entry) => [entry.scope, entry]));
    for (const oldEntry of previous.screenReferences ?? []) {
      if (oldEntry.status !== "ACTIVE_SCREEN_REFERENCE") continue;
      const current = currentByScope.get(oldEntry.scope);
      if (!current) errors.push(`active scope was removed: ${oldEntry.scope}`);
      else if (current.status !== "ACTIVE_SCREEN_REFERENCE" && manifest.baselineRevision === previous.baselineRevision) {
        errors.push(`active scope was downgraded without a baseline revision: ${oldEntry.scope}`);
      }
    }
  } catch {
    // First introduction of the monotonic field has no comparable HEAD value.
  }
}

if (!existsSync(contractsPath)) {
  errors.push("missing docs/design/IMPLEMENTATION_CONTRACTS.json");
} else {
  const contracts = JSON.parse(readFileSync(contractsPath, "utf8"));
  const activeScopes = new Set((manifest?.screenReferences ?? []).filter((entry) => entry.status === "ACTIVE_SCREEN_REFERENCE").map((entry) => entry.scope));
  const contractScopes = new Set();
  for (const contract of contracts.contracts ?? []) {
    contractScopes.add(contract.scope);
    if (!contract.reference || /(^|\/)archive\//.test(contract.reference)) errors.push(`contract ${contract.scope} has invalid reference`);
    // BASELINE-PATH-ROT-001：reference 原来只查「非空 + 不在 archive」，不查存在 ——
    // 一条指向已删文件的 reference 和一条好的 reference 在门禁眼里完全一样。
    else if (!existsSync(resolve(root, contract.reference))) errors.push(`contract ${contract.scope} reference does not exist: ${contract.reference}`);
    for (const file of [...(contract.implementationFiles ?? []), ...(contract.evidenceFiles ?? [])]) {
      if (!existsSync(resolve(root, file))) errors.push(`contract ${contract.scope} file does not exist: ${file}`);
    }
    if (!CONTRACT_STATUSES.has(contract.status)) {
      errors.push(`contract ${contract.scope} has unknown status: ${JSON.stringify(contract.status)} — expected one of ${[...CONTRACT_STATUSES].join(", ")}`);
    }
    // 任何「非 IMPLEMENTED」的状态都必须说清缺什么。原来只守 PARTIAL，
    // 于是 SCAFFOLD_ONLY（按定义就有缺口）可以留空 knownGap 而没人管。
    if (contract.status !== "IMPLEMENTED" && !contract.knownGap) {
      errors.push(`contract ${contract.scope} must describe its gap (status ${contract.status})`);
    }
  }
  for (const scope of activeScopes) {
    if (!contractScopes.has(scope)) errors.push(`active scope has no implementation contract: ${scope}`);
  }
}

try {
  const productionFiles = execFileSync("git", ["ls-files", "apps/mobile/src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  // DESIGN-BASELINE-DELETED-001：在工作树里已删除（已暂存或未暂存）但 git 还
  // 跟踪着的文件，readFileSync 会 ENOENT，之前这里直接让整道门 FAIL —— 而删
  // 文件本身是正常操作（删完提交后 ls-files 就不再列它，门自然过）。删掉的
  // 文件不可能再引用 archive，不跳过只会把"正在删"误报成"基线漂移"。
  // 注意这不是放水：删的是基线敏感实现文件时，下面的 staged 敏感检查 +
  // contracts 的 existsSync 照样会拦（缺文件 / 缺设计确认）。
  const deleted = new Set(execFileSync("git", ["ls-files", "--deleted", "apps/mobile/src"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean));
  for (const file of productionFiles) {
    if (deleted.has(file)) continue;
    const source = readFileSync(resolve(root, file), "utf8");
    if (/docs\/design\/archive|archive\/prototypes/.test(source)) errors.push(`production source references archived design: ${file}`);
  }
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (existsSync(contractsPath) && staged.length > 0) {
    const contracts = JSON.parse(readFileSync(contractsPath, "utf8"));
    // GUARD-SELF-SENSITIVE-001：原来敏感集合**只**来自契约的 implementationFiles，
    // 而 `scripts/` 一个条目都没有 —— 于是把这道门禁自己掏空（删掉一段检查）
    // 不需要任何设计确认，门禁也永远不会因此变红。守卫的守卫是空的。
    // 把本脚本自己算进敏感集合：改它就必须在同一提交里更新基线 + changelog。
    const sensitive = new Set([
      "scripts/check-design-baseline.mjs",
      ...(contracts.contracts ?? []).flatMap((contract) => contract.implementationFiles ?? [])
    ]);
    const touched = staged.filter((file) => sensitive.has(file));
    const acknowledgement = staged.some((file) => file === "docs/design/CURRENT_BASELINE.json" || file === "docs/design/IMPLEMENTATION_CONTRACTS.json") && staged.includes("docs/design/BASELINE_CHANGELOG.md");
    if (touched.length > 0 && !acknowledgement) errors.push(`baseline-sensitive implementation changed without design acknowledgement: ${touched.join(", ")}`);
  }
} catch (error) {
  errors.push(`unable to evaluate git-backed baseline rules: ${error.message}`);
}

for (const entry of readdirSync(root)) {
  if (/^preview \(\d+\)\.html$/i.test(entry)) {
    errors.push(`unnamed preview must be versioned and filed under docs/design: ${entry}`);
  }
}

if (errors.length > 0) {
  console.error(`Design baseline check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Design baseline check passed.");
