// Step 1 of the QR geometry verification.
//
// Export the QR matrices from the SAME library the app uses (`qrcode`, pure JS).
//
// Do NOT substitute python's `qrcode` package here: for the same payload the two
// pick different masks. Measured 2026-09-16 on "https://proxy.app/@huyen" (ECC H):
// both are v3 29x29 and the finder patterns are identical, but 299 of 841 modules
// differ (432 dark vs 455). A sweep rendered from python matrices therefore
// validates a code the app will never draw.
//
// usage: node export-matrices.mjs <outdir>

import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { create } = require("qrcode");

// The payload shapes the app actually encodes. Keep in sync with
// apps/mobile/src/profile-qr.ts (profileQrPayload / inviteQrPayload) and the
// storefront's `proxy.app/store/<id>`.
export const PAYLOADS = {
  profile: "https://proxy.app/@huyen",
  invite: "https://proxy.app/invite/huyen",
  store: "https://proxy.app/store/8f3c1d92-4a7b-4e15-9c88-2b6f0a1d5e77",
};

const out = process.argv[2];
if (!out) {
  console.error("usage: node export-matrices.mjs <outdir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

for (const [name, payload] of Object.entries(PAYLOADS)) {
  const qr = create(payload, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const rows = [];
  for (let y = 0; y < n; y += 1) {
    let row = "";
    for (let x = 0; x < n; x += 1) row += qr.modules.data[y * n + x] ? "1" : "0";
    rows.push(row);
  }
  writeFileSync(`${out}/matrix-${name}.txt`, rows.join("\n"));
  const dark = qr.modules.data.reduce((a, b) => a + (b ? 1 : 0), 0);
  console.log(
    `${name.padEnd(8)} v${qr.version} ${n}x${n} mask=${qr.maskPattern} dark=${dark}`,
  );
}
