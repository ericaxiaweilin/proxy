import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/design/CURRENT_BASELINE.json");
const contractsPath = resolve(root, "docs/design/IMPLEMENTATION_CONTRACTS.json");
const errors = [];
let manifest;

if (!existsSync(manifestPath)) {
  errors.push("missing docs/design/CURRENT_BASELINE.json");
} else {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Number.isInteger(manifest.baselineRevision) || manifest.baselineRevision < 1) {
    errors.push("baselineRevision must be a positive integer");
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
    declaredPaths.push([`screenReferences[${index}].file`, entry.file]);
    declaredPaths.push([`screenReferences[${index}].implementationBaseline`, entry.implementationBaseline]);
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
    if (contract.status === "PARTIAL" && !contract.knownGap) errors.push(`partial contract must describe its gap: ${contract.scope}`);
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
    const sensitive = new Set((contracts.contracts ?? []).flatMap((contract) => contract.implementationFiles ?? []));
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
