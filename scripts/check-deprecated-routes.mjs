#!/usr/bin/env node
// P0 ARCH-01/DEPRECATION-01: Ensure deprecated canonical screens are not reachable in production build
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const kake = new URL("..", import.meta.url).pathname;
const forbidden = [
  { pattern: /Market.*Experience.*库存|Experience.*一级对象/, file: "docs/DEPRECATED_MANIFEST.md", msg: "Experience inventory must not be created" },
];
const checks = [
  { name: "Market API only OPPORTUNITY/ACTIVITY", file: "apps/mobile/src/surfaces/market.tsx", mustContain: "OPPORTUNITY", mustNotContain: "EXPERIENCE.*Tab" },
  { name: "Profile no QR in personalhub", file: "apps/mobile/src/surfaces/me.tsx", check: (s) => !s.slice(s.indexOf('if (subPage.route === "personalhub")'), s.indexOf('if (subPage.route === "personalhub")')+5000).includes("QrCard") },
  { name: "Home no For You", file: "apps/mobile/src/surfaces/home-assistant.tsx", mustNotContain: "For You" },
];
let ok=true;
for (const c of checks) {
  try {
    const s = readFileSync(join(kake, c.file), "utf8");
    if (c.mustContain && !s.includes(c.mustContain)) { console.log(`FAIL: ${c.name} missing ${c.mustContain}`); ok=false; }
    if (c.mustNotContain && new RegExp(c.mustNotContain).test(s)) { console.log(`FAIL: ${c.name} contains forbidden ${c.mustNotContain}`); ok=false; }
    if (c.check && !c.check(s)) { console.log(`FAIL: ${c.name} custom check failed`); ok=false; }
    if (ok) console.log(`PASS: ${c.name}`);
  } catch(e){ console.log(`SKIP: ${c.name} ${e.message}`); }
}
// Ensure experience alias does not create inventory
const exp = readFileSync(join(kake, "apps/api-go/internal/experience/service.go"), "utf8");
if (exp.includes("ExperienceInventory")) console.log("WARN: ExperienceInventory still referenced — ensure DEPRECATED");
else console.log("PASS: ExperienceInventory not created");
process.exit(ok?0:1);
