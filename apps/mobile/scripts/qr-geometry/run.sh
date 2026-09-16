#!/usr/bin/env bash
# QR geometry verification — run this after touching ANY geometry constant in
# apps/mobile/src/components/proxy-qr-code.tsx.
#
#   ./run.sh              # writes to ./out
#   ./run.sh /tmp/qrout   # writes elsewhere
#
# Needs: node (repo deps), python3 + Pillow, swift (Xcode command line tools).
# Override the interpreter with PYTHON=... if your default python3 lacks Pillow.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$HERE/out}"
PYTHON="${PYTHON:-python3}"

echo "== 1/3 export matrices (from the app's own qrcode library) =="
(cd "$MOBILE" && node "$HERE/export-matrices.mjs" "$OUT")

echo
echo "== 2/3 render cases =="
"$PYTHON" "$HERE/gen-cases.py" "$OUT" "$OUT/cases"

echo
echo "== 3/3 decode with CoreImage =="
set +e
swift "$HERE/decode-qr.swift" "$OUT"/cases/*.png > "$OUT/decode.log" 2>&1
set -e

TOTAL=$(ls "$OUT"/cases/*.png | wc -l | tr -d ' ')
FAILED=$(grep -c "NOT DECODABLE" "$OUT/decode.log" || true)
echo "decoded: $((TOTAL - FAILED)) / $TOTAL"

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
