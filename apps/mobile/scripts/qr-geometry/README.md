# QR geometry verification

Run this after touching **any** geometry constant in
`apps/mobile/src/components/proxy-qr-code.tsx`:

```sh
apps/mobile/scripts/qr-geometry/run.sh
```

Needs `node` (repo deps installed), `python3` with Pillow, and `swift`
(Xcode command line tools). Override the interpreter with `PYTHON=...`.

## Why this exists

The QR styling is not decoration. Shrinking the dots shrinks the ink, which shrinks
the decode margin. "It looks right" is not evidence that a camera can still read it —
so this renders the shipping geometry across a matrix of sizes and decodes every case
with macOS CoreImage.

## The two traps this directory was built to avoid

**1. Rendering with the wrong encoder.**
python's `qrcode` and JS `qrcode` pick **different masks** for the same payload.
Measured 2026-09-16 on `https://proxy.app/@huyen` (ECC H): both are v3 29×29 with
identical finder patterns, but **299 of 841 modules differ** (432 dark vs 455).
A sweep rendered from python matrices validates a code the app will never draw.
`export-matrices.mjs` uses the app's own library for exactly this reason.

**2. Rendering with a re-implementation instead of the component's own output.**
`gen-cases.py` mirrors the component's maths, which is still a re-implementation.
For the strongest check, dump the real `<path d="...">` the component builds and
rasterise *that*:

```sh
rsvg-convert -w 1391 -h 1391 real-path.svg -o real-path.png
swift decode-qr.swift real-path.png
```

That catches malformed path syntax (which would render as garbage on device) — a
re-implementation cannot, because it draws from its own understanding rather than
parsing the SVG.

## Protocol

- 3 payloads × 6 sizes × 4 logo ratios × {1x, 3x} = 144 cases.
- **`ratio=0` is the no-logo control.** A failure there is not the logo's fault.
- Compare **failure filename sets**, not just pass counts: `diff old.txt new.txt`.
  Equal counts can hide one fix cancelling one regression.
- `_1x` failures are a 1x-device-only concern. `captureRef` saves at **device scale**
  (`react-native-view-shot@5.1.1` `ios/RNViewShot.mm:139` — `rendererFormat.scale = 0`),
  so a 104pt code lands in the album as 312px on a 3x phone.

## Payloads changed: vCard, not a URL (2026-09-16, PROFILE-QR-002)

`PAYLOADS` in `export-matrices.mjs` no longer matches the old `https://proxy.app/...`
shapes. The app now encodes **standard vCard contact cards** (`buildContactCard()` in
`src/profile-qr.ts`) — `proxy.app` is a parked domain listed for sale, and the app's own
search matches handles literally, so a URL payload was never resolvable. **Update
`PAYLOADS` whenever the card shape changes, then re-run `./run.sh`.**

Payload length drives the QR version, which drives scannability at a fixed render size.
Measured at ECC H:

| payload | version | modules |
|---|---|---|
| old `store` URL | v7 | 45×45 |
| person card (`N`/`FN`/`NICKNAME`/`X-PROXY-HANDLE`) | v10 | 57×57 |
| store card (`N`/`FN`/`X-PROXY-STORE`) | v12 | 65×65 |
| store card **with `ORG:`** | v13 | 69×69 |

Decode pass rate over 51 pixel sizes (200–400px, step 4), shipping geometry:

| payload | pass rate |
|---|---|
| old `store` URL (v7) | **98.0 %** |
| person card (v10) | **88.2 %** |
| store card, no `ORG` (v12) | **88.2 %** |
| store card with `ORG` (v13) | **76.5 %** |

`ORG:` is why the store card omits it: for a shop it merely repeats `FN`, but it costs a
whole version step and **12 percentage points** of decode rate.

**A single size is not a valid sample.** Decode success depends on sub-pixel grid
alignment, so results are non-monotonic (`v10_min` failed at 260px and passed at 288px).
Compare pass **rates across a size range**, never one size.

Every size the app actually renders passes: 104pt@2x=208px, 104pt@3x=312px,
168pt@2x=336px, and 416/504/592/624/888px (the personalqr page and the zoom overlay at
2x/3x). Round-trip was verified too: decoded text equals the source payload with 0
mismatches, and `parseScannedQr` reads all four real card shapes back.

## Baseline result — pre-vCard URL payloads (2026-09-16, baseline Rev 219)

Kept for reference: this is the sweep that validated the **old** `https://proxy.app/...`
payloads, before the switch to vCards. Geometry: dot side 0.87 module (`DOT_INSET 0.065`),
dot radius 0.22, finder 0.30 / hole inset 0.55 / core radius 0.40, logo 24% + ring 3.2%.

- **132 / 144 decode.** The 12 failures are all `_1x` at 88px and 104px on the long
  payloads (`invite`, `store`), and **every one of them also fails at `ratio=00`**
  (no logo) — so they are inherent to a long payload at a tiny 1x size, not caused by
  the styling.
- Re-running with the previous geometry (dot filling the whole module) gives a
  **byte-identical failure list** — i.e. the separated dots cost **zero** decode margin.

The constants came from measuring the supplied reference image rather than eyeballing
it: on a v3 29×29 reference (module 47.97px) the shared boundary between adjacent dark
modules is pure white in 134/134 pairs, dot width 42.0px and gap 6.0px → dot 0.876
module / gap 0.125 module (7:1); the dot-width-vs-height profile matches a rounded
square, not a circle.
