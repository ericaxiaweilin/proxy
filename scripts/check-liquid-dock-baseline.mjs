import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const file = resolve(root, "apps/mobile/src/shell/app-shell.tsx");
const source = readFileSync(file, "utf8");
const requirements = [
  ["Math.min(430", "dock max width must remain 430"],
  ["const edge = 6", "dock inner edge must remain 6"],
  ["compact ? 60 : 68", "dock height baseline must remain 60/68"],
  ["compact ? 50 : 54", "lens height baseline must remain 50/54"],
  ["borderRadius: 34", "dock radius must remain 34"],
  ["borderRadius: 28", "lens radius must remain 28"],
  ["glassEffectStyle=\"clear\"", "dock must use clear native glass"],
  ["glassEffectStyle=\"regular\"", "lens must use regular native glass"],
  ["lensPosition", "lens must use centered slot geometry"],
  ["liquidMotion", "lens must retain liquid motion response"]
];

const errors = requirements.filter(([needle]) => !source.includes(needle)).map(([, message]) => message);
if (source.includes('from "expo-blur"')) errors.push("app shell must not import unbuilt expo-blur");

if (errors.length) {
  console.error(`Liquid dock baseline failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Liquid dock baseline passed.");
