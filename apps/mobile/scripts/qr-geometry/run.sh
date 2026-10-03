#!/usr/bin/env bash
# QR geometry verification — run this after touching ANY geometry constant in
# apps/mobile/src/components/proxy-qr-code.tsx.
#
#   ./run.sh              # writes to ./out
#   ./run.sh /tmp/qrout   # writes elsewhere
#
# Needs: go (step 2), node (step 1 only), swift (step 3, Xcode command line tools).
#
# Step 1 still runs on node because it must export the matrices from the *app's own*
# qrcode package: for the same payload the JS and other encoders pick different masks
# (measured: 299 of 841 modules differ), so a sweep built from any other encoder
# validates a code the app will never draw. Steps 2 and 3 are Go and Swift.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$MOBILE/../.." && pwd)"
OUT="${1:-$HERE/out}"
GO="${GO:-/opt/homebrew/bin/go}"
[ -x "$GO" ] || GO="$(command -v go || true)"
[ -n "$GO" ] || { echo "go not found — set GO=/path/to/go" >&2; exit 127; }

echo "== 1/3 export matrices (from the app's own qrcode library) =="
(cd "$MOBILE" && node "$HERE/export-matrices.mjs" "$OUT")

echo
echo "== 2/3 render cases =="
"$GO" -C "$REPO/apps/api-go" run ./cmd/qrcases "$OUT" "$OUT/cases"

echo
echo "== 3/3 decode with CoreImage =="
set +e
swift "$HERE/decode-qr.swift" "$OUT"/cases/*.png > "$OUT/decode.log" 2>&1
set -e

TOTAL=$(ls "$OUT"/cases/*.png | wc -l | tr -d ' ')
FAILED=$(grep -c "NOT DECODABLE" "$OUT/decode.log" || true)
echo "decoded: $((TOTAL - FAILED)) / $TOTAL"

# 0 cases decoded is not "the geometry is safe": it means the sweep read nothing.
if [ "$TOTAL" -eq 0 ]; then
  echo "  FAIL: step 2 wrote no PNGs — nothing was decoded." >&2
  exit 1
fi

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "failures:"
  grep "NOT DECODABLE" "$OUT/decode.log" | sed 's/:.*//' | sed 's|.*/||' | sort
  echo
  echo "For every failure above, check the SAME size/payload at ratio 00 (no logo)."
  echo "If the control fails too, the styling is not the cause. Failures confined to"
  echo "the _1x rows are a 1x-device-only concern — captureRef saves at DEVICE scale."
fi

echo
echo "log: $OUT/decode.log"
