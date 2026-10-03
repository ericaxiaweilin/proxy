// Command qrcases is the port of apps/mobile/scripts/qr-geometry/gen-cases.py:
// step 2 of the QR geometry sweep. It reads the module matrices exported from the
// app's own `qrcode` library (step 1, export-matrices.mjs) and rasterises the
// shipping drawing maths into 144 PNG cases, which decode-qr.swift then reads back
// with CoreImage.
//
// Renders 3 payloads x 6 sizes x 4 logo ratios x {1x, 3x} = 144 cases.
// ratio=0 is the no-logo CONTROL: a failure there is not the logo's fault.
//
// Unlike the Python version, no geometry constant is copied into this file. The
// Python carried seven hand-maintained numbers under a header saying "if you change
// a constant there, change it here too" — and that drift already cost one round
// (gen-cases.py drew square modules while the component drew rounded 0.87-module
// dots, so "144 cases passed" proved nothing). Here the numbers are parsed out of
// proxy-qr-code.tsx at run time, so the sweep cannot quietly render a geometry the
// app does not ship: a missing or unparsable constant stops the run.
//
// usage: go -C apps/api-go run ./cmd/qrcases <matrixdir> <outdir> [--component <tsx>]
package main

import (
	"fmt"
	"os"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
