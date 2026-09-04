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
  const required = [
    manifest.global?.designSystem,
    manifest.global?.visualReference,
    manifest.production?.iconRegistry,
    manifest.production?.theme,
    ...(manifest.screenReferences ?? []).filter((entry) => entry.status === "ACTIVE_SCREEN_REFERENCE").map((entry) => entry.file)
  ].filter(Boolean);

  for (const file of required) {
    if (!existsSync(resolve(root, file))) errors.push(`active design reference does not exist: ${file}`);
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
  for (const file of productionFiles) {
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
