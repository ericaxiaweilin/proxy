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

// PROFILE-QR-002 (2026-09-16): the app no longer encodes `proxy.app` URLs — it encodes
// **standard vCard contact cards** produced by `buildContactCard()` in
// `apps/mobile/src/profile-qr.ts`. These three strings are that function's verbatim
// output (CRLF joined; this file writes them with \r\n so the byte length matches).
//
// If you change the card shape in `profile-qr.ts`, you MUST update these and re-run
// `./run.sh` — a sweep over a stale payload validates a code the app will never draw.
// That mistake already cost one round (gen-cases.py drew square modules while the
// component drew rounded 0.87-module dots, so the "144 cases passed" proved nothing).
export const PAYLOADS = {
  // person:  N / FN / NICKNAME / X-PROXY-HANDLE
  profile: "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Huyen Nguyen;;;;\r\nFN:Huyen Nguyen\r\nNICKNAME:@huyen\r\nX-PROXY-HANDLE:huyen\r\nEND:VCARD",
  // legacy:  the pre-vCard shape. Still parsed by parseScannedQr (old codes are in
  // people's photo libraries) but no longer produced — kept so the sweep can show the
  // version-number cost of the old format.
  invite: "https://proxy.app/invite/huyen",
  // store:   N / FN / X-PROXY-STORE  — deliberately NO `ORG:` (it would copy FN and
  // cost a whole version step: v12 65x65 -> v13 69x69, measured 88.2% -> 76.5%).
  store: "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Bonsaidon Seafood Buffet;;;;\r\nFN:Bonsaidon Seafood Buffet\r\nX-PROXY-STORE:8f3c1d92-4a7b-4e15-9c88-2b6f0a1d5e77\r\nEND:VCARD",
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
