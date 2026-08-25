import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/design/CURRENT_BASELINE.json");
const errors = [];

if (!existsSync(manifestPath)) {
  errors.push("missing docs/design/CURRENT_BASELINE.json");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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

