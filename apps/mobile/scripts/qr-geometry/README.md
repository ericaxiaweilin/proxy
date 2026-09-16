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

## Baseline result (2026-09-16, baseline Rev 219)

Geometry: dot side 0.87 module (`DOT_INSET 0.065`), dot radius 0.22, finder 0.30 /
hole inset 0.55 / core radius 0.40, logo 24% + ring 3.2%.

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
