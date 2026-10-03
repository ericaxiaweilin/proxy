package main

import (
	"image"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// QR-GEOMETRY-SWEEP-001: the sweep must render what the component draws, and must
// stop when it cannot.
//
// The Python step-2 script kept seven constants by hand and its header asked the
// reader to update them in step with proxy-qr-code.tsx. That already produced one
// worthless sweep — "144 cases passed" while the re-implementation drew square
// modules and the component drew rounded 0.87-module dots. These tests pin the two
// things that made that possible: the numbers must come from the component, and the
// raster must measurably match them.

const testModulePixels = 20 // size = n * 20, so 1 module == 20 pixels and a 0.13-module seam spans >2 px

func componentPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join(repoRoot(), "apps", "mobile", "src", "components", "proxy-qr-code.tsx")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("component not found at %s: %v", path, err)
	}
	return path
}

func shippingGeometry(t *testing.T) geometry {
	t.Helper()
	geo, err := readGeometry(componentPath(t))
	if err != nil {
		t.Fatalf("readGeometry: %v", err)
	}
	return geo
}

func TestGeometryConstantsComeFromTheComponent(t *testing.T) {
	geo := shippingGeometry(t)
	// Dot edge = 1 - 2*DOT_INSET. The component's comment records the reference art
	// at ≈0.876 module with a ≈0.125 module seam; outside this band the sweep is
	// measuring a code that does not ship.
	if edge := 1 - 2*geo.dotInset; edge < 0.80 || edge > 0.92 {
		t.Fatalf("dot edge = %g modules, outside the 0.80-0.92 band the reference art measures", edge)
	}
	if geo.dotRadius <= 0 || geo.dotRadius >= (1-2*geo.dotInset)/2 {
		t.Fatalf("DOT_RADIUS=%g is not a positive radius below half the dot edge", geo.dotRadius)
	}
	if geo.logoRatio <= 0 || geo.logoRatio >= 0.5 {
		t.Fatalf("LOGO_RATIO=%g would cover half the code or nothing", geo.logoRatio)
	}
	if geo.finderHoleInset >= 7*geo.finderRadius {
		t.Fatalf("FINDER_HOLE_INSET=%g is not smaller than the outer radius, so the finder ring could never open", geo.finderHoleInset)
	}
}

// A renamed or deleted constant has to stop the sweep instead of quietly rendering
// with the numbers it last saw. One mutant per constant, so a partial rename cannot
// slip through.
func TestEveryGeometryConstantMustBeParsable(t *testing.T) {
	body, err := os.ReadFile(componentPath(t))
	if err != nil {
		t.Fatalf("read component: %v", err)
	}
	path := filepath.Join(t.TempDir(), "proxy-qr-code.tsx")

	for _, name := range geometryConstants {
		marker := "const " + name + " ="
		i := strings.Index(string(body), marker)
		if i < 0 {
			t.Fatalf("component does not declare %q — the list in geometry.go is stale", name)
		}
		mutated := string(body)[:i] + "const RENAMED_" + name + " =" + string(body)[i+len(marker):]
		if err := os.WriteFile(path, []byte(mutated), 0o644); err != nil {
			t.Fatalf("write mutant: %v", err)
		}
		if _, err := readGeometry(path); err == nil {
			t.Fatalf("readGeometry accepted a component with `const %s` renamed — the sweep would keep drawing a stale number", name)
		}
	}
}

// The never-empty discriminator: a missing file and an empty file must both be
// errors. A zero-valued geometry would render a blank field, and the decode oracle
// would report 144 failures that read like a real geometry regression.
func TestUnreadableComponentFails(t *testing.T) {
	if _, err := readGeometry(filepath.Join(t.TempDir(), "absent.tsx")); err == nil {
		t.Fatal("readGeometry succeeded on a missing file")
	}
	path := filepath.Join(t.TempDir(), "empty.tsx")
	if err := os.WriteFile(path, []byte("// nothing here\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := readGeometry(path); err == nil {
		t.Fatal("readGeometry succeeded on a component with no constants")
	}
}

func TestReadMatrixRejectsGarbage(t *testing.T) {
	dir := t.TempDir()
	cases := []struct{ name, body, why string }{
		{"empty", "", "an empty matrix must not render a blank field"},
		{"ragged", "101\n11\n", "rows of different length cannot describe a square code"},
		{"charset", "10 1\n", "anything but 0/1 means step 1 wrote something else"},
	}
	for _, c := range cases {
		path := filepath.Join(dir, c.name+".txt")
		if err := os.WriteFile(path, []byte(c.body), 0o644); err != nil {
			t.Fatalf("write %s: %v", c.name, err)
		}
		if _, err := readMatrix(path); err == nil {
			t.Errorf("%q accepted: %s", c.name, c.why)
		}
	}
	good := filepath.Join(dir, "good.txt")
	if err := os.WriteFile(good, []byte("101\n111\n101\n"), 0o644); err != nil {
		t.Fatalf("write good: %v", err)
	}
	if m, err := readMatrix(good); err != nil || len(m) != 3 || !m[1][1] || m[0][1] {
		t.Fatalf("readMatrix(good) = %v, %v", m, err)
	}
}

// solidField is a fully dark code with the finder corners present, so every interior
// neighbour pair shows a seam and the finder maths is exercised too.
func solidField(n int) [][]bool {
	matrix := make([][]bool, n)
	for y := range matrix {
		matrix[y] = make([]bool, n)
		for x := range matrix[y] {
			matrix[y][x] = true
		}
	}
	return matrix
}

// The rendered geometry, measured off the raster: dot width, a pure-white seam
// between neighbouring dark modules, and an ink area that only a ROUNDED dot
// produces. A square or full-module renderer fails the area assertion by a wide
// margin, which is exactly the drift that made one Python sweep meaningless.
func TestRenderedDotsMatchTheComponentsMaths(t *testing.T) {
	geo := shippingGeometry(t)
	const n = 29
	size := n * testModulePixels
	img := render(size, solidField(n), geo, blankLogo(), 0)

	if b := img.Bounds(); b.Dx() != size || b.Dy() != size {
		t.Fatalf("render size = %dx%d, want %d", b.Dx(), b.Dy(), size)
	}

	// Half-maximum crossings: with anti-aliasing on, a dot's edge pixel is ~50% ink
	// and an isDark threshold picks it up or drops it arbitrarily. Measuring at the
	// half-max is how feature width is measured off an aliased raster.
	y := 14*testModulePixels + testModulePixels/2
	runs := darkRuns(img, y, 11*testModulePixels+3, 15*testModulePixels-3)
	if len(runs) != 4 {
		t.Fatalf("%d dark runs across modules 11..14 at y=%d, want one per module: %v", len(runs), y, runs)
	}
	wantWidth := (1 - 2*geo.dotInset) * testModulePixels
	for _, r := range runs {
		width := r.end - r.start + 1
		if math.Abs(float64(width)-wantWidth) > 1.5 {
			t.Fatalf("dot width = %dpx, want %.2fpx (DOT_INSET=%g at module=%dpx)", width, wantWidth, geo.dotInset, testModulePixels)
		}
	}

	// The seam between two adjacent dots must contain at least one pure-paper pixel:
	// this is the property DOT_INSET was measured to create ("相邻两个深色模块的公共
	// 边界是纯白"). If the dots merge, the dense areas blur and the scanner loses the
	// whole region — the failure the component's comment calls out.
	seamClear := false
	for x := 13 * testModulePixels; x < 14*testModulePixels; x++ {
		if coverage(img, x, y) < 0.02 {
			seamClear = true
			break
		}
	}
	if !seamClear {
		t.Fatalf("no pure-paper pixel between modules 12 and 13 (seam = %.3f modules wide) — the dots merged",
			2*geo.dotInset)
	}

	// Ink area of one module cell against the component's own number: a rounded
	// square of side 0.87 with r 0.22 is 0.87² - (4-π)·0.22² = 0.715 module² of ink,
	// which is exactly what proxy-qr-code.tsx records ("点面积 0.958 → 0.715 模块").
	// The area alone only separates a full-module renderer, so the corner probe below
	// is what separates a SQUARE one.
	cellX, cellY := 12*testModulePixels, 14*testModulePixels
	edge := 1 - 2*geo.dotInset
	cell := float64(testModulePixels * testModulePixels)
	wantArea := (edge*edge-(4-math.Pi)*geo.dotRadius*geo.dotRadius) * cell
	got := inkArea(img, cellX, cellY, testModulePixels)
	if math.Abs(got-wantArea) > 0.03*wantArea {
		t.Fatalf("dot ink area = %.1f px², want %.1f px² — a full-module dot would be %.1f",
			got, wantArea, cell)
	}

	// Roundness, measured where it is the only difference: the outermost pixel of the
	// dot's bounding box. A rounded dot leaves that pixel paper (the arc centre sits
	// one radius in from each edge); a square one fills it about 70%.
	insetPx := int(math.Ceil(geo.dotInset*testModulePixels)) - 1
	cornerX, cornerY := cellX+insetPx, cellY+insetPx
	if cornerCover := coverage(img, cornerX, cornerY); cornerCover > 0.15 {
		t.Fatalf("the dot's bounding-box corner pixel (%d,%d) is %.2f ink — the renderer squared the corners (DOT_RADIUS=%g is not being applied)",
			cornerX, cornerY, cornerCover, geo.dotRadius)
	}
	if midCover := coverage(img, cornerX+3, cornerY+3); midCover < 0.9 {
		t.Fatalf("3px inside the dot's corner is only %.2f ink — the radius is over-applied and the dots are shrinking into circles", midCover)
	}
}

// The finder corners are drawn as outer-minus-hole plus core (the component gets the
// ring from fillRule="evenodd" in one path). If the hole ever failed to open, every
// code in the sweep would carry three solid 7x7 blocks and CoreImage would still
// report OK — so this is measured, not assumed.
func TestFinderCornersKeepTheirHoleAndCore(t *testing.T) {
	geo := shippingGeometry(t)
	const n = 29
	size := n * testModulePixels
	img := render(size, solidField(n), geo, blankLogo(), 0)

	// Coordinates are finder-local modules × testModulePixels: the 3×3 core sits at
	// local (2..5), the ring's hole band at local 1..6, the outer block 0..7.
	if c := inkAt(img, 3.5, 3.5); c < 0.9 {
		t.Fatalf("finder core at finder-local (3.5,3.5) is %.2f ink, want solid — the 3x3 inner square is missing", c)
	}
	if c := inkAt(img, 3.5, 1.5); c > 0.1 {
		t.Fatalf("finder hole band at finder-local (3.5,1.5) is %.2f ink — FINDER_HOLE_INSET is not being cut, so the ring is solid", c)
	}
	if c := inkAt(img, 0.5, 3.5); c < 0.9 {
		t.Fatalf("outer finder ring at finder-local (0.5,3.5) is %.2f ink, want solid", c)
	}
	// All three corners must exist; the bottom-right one is the one a wrong
	// finderOrigin() formula forgets.
	for _, corner := range [][2]int{{0, 0}, {(n - 7) * testModulePixels, 0}, {0, (n - 7) * testModulePixels}} {
		p := image.Point{X: corner[0] + 3*testModulePixels + testModulePixels/2,
			Y: corner[1] + 3*testModulePixels + testModulePixels/2}
		if c := coverage(img, p.X, p.Y); c < 0.9 {
			t.Fatalf("finder core at %v is %.2f ink — that corner was not drawn", p, c)
		}
	}
}

func inkAt(img image.Image, mx, my float64) float64 {
	return coverage(img, int(mx*testModulePixels), int(my*testModulePixels))
}

// The logo's actual cost: the badge must remove the ink it covers and leave a paper
// ring, or the sweep would be grading a code whose centre was never obscured. The
// logo is pure red so its pixels are distinguishable from both ink and paper.
func TestBadgeCutsAWhiteRingAroundTheLogo(t *testing.T) {
	geo := shippingGeometry(t)
	const n = 29
	size := n * testModulePixels
	matrix := solidField(n)

	control := render(size, matrix, geo, blankLogo(), 0)
	withLogo := render(size, matrix, geo, blankLogo(), geo.logoRatio)

	if c := coverage(control, size/2, size/2); c < 0.9 {
		t.Fatalf("the no-logo control is %.2f ink at the centre — the field was never drawn", c)
	}
	if c := isLogo(withLogo, size/2, size/2); !c {
		t.Fatalf("no logo pixels at the centre of the %g-ratio case — the badge swallowed the mark", geo.logoRatio)
	}

	// The ring between the mark and the badge edge must be paper.
	logoRadius := geo.logoRatio * float64(size) / 2
	ringPad := float64(iround(float64(size) * geo.logoRingRatio))
	band := int(logoRadius + ringPad/2)
	if c := coverage(withLogo, size/2+band, size/2); c > 0.1 {
		t.Fatalf("badge ring at +%dpx is %.2f ink — the white silent ring around the logo is not drawn", band, c)
	}
	// Beyond the badge, the code must be back to normal ink. A badge drawn over the
	// whole field would also leave the ring paper, so this is the other half of it.
	// Probed on a dot centre rather than on the seam between two dots.
	probeX, probeY := 21*testModulePixels+testModulePixels/2, size/2
	if c := coverage(withLogo, probeX, probeY); c < 0.9 {
		t.Fatalf("a module outside the badge is only %.2f ink — the badge was drawn over the whole code", c)
	}
	if c := coverage(control, probeX, probeY); c < 0.9 {
		t.Fatalf("the control is only %.2f ink at the same point — the field itself is not solid", c)
	}
}

// A case must not be silently skipped: the file count the sweep reports is the whole
// claim of "144 cases", so run() has to fail rather than print a short number.
func TestSweepWritesEveryCaseItCounts(t *testing.T) {
	dir := t.TempDir()
	matrixDir := filepath.Join(dir, "matrices")
	if err := os.MkdirAll(matrixDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	small := solidField(29)
	for _, name := range sweepNames {
		var lines []string
		for _, row := range small {
			var sb strings.Builder
			for _, cell := range row {
				if cell {
					sb.WriteByte('1')
					continue
				}
				sb.WriteByte('0')
			}
			lines = append(lines, sb.String())
		}
		if err := os.WriteFile(filepath.Join(matrixDir, "matrix-"+name+".txt"), []byte(strings.Join(lines, "\n")), 0o644); err != nil {
			t.Fatalf("write matrix: %v", err)
		}
	}
	out := filepath.Join(dir, "cases")
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatalf("mkdir out: %v", err)
	}
	if err := writeCase(filepath.Join(out, "probe.png"), 290, small, shippingGeometry(t), blankLogo(), 0.24); err != nil {
		t.Fatalf("writeCase: %v", err)
	}
	if _, err := os.Stat(filepath.Join(out, "probe.png")); err != nil {
		t.Fatalf("writeCase reported success but wrote nothing: %v", err)
	}
	want := len(sweepNames) * len(sweepSizes) * len(sweepRatios) * len(sweepScales)
	if want != 144 {
		t.Fatalf("the sweep grid is %d cases, but the README and the decode step assume 144", want)
	}
}

func darkRuns(img image.Image, y, from, to int) []inkRun {
	var runs []inkRun
	for x := from; x <= to; x++ {
		if isDark(img, x, y) {
			start := x
			for x <= to && isDark(img, x, y) {
				x++
			}
			runs = append(runs, inkRun{start: start, end: x - 1})
		}
	}
	return runs
}

type inkRun struct{ start, end int }

// inkArea sums how much of a w×h cell is ink, using the anti-aliased value.
func inkArea(img image.Image, x0, y0, w int) float64 {
	var total float64
	for y := y0; y < y0+w; y++ {
		for x := x0; x < x0+w; x++ {
			total += coverage(img, x, y)
		}
	}
	return total
}

func luminance(img image.Image, x, y int) (int, int, int) {
	c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
	return int(c.R), int(c.G), int(c.B)
}

// coverage is the ink fraction of a pixel, read off the anti-aliased value: the
// renderer averages ink (#17131F, mean 22.7) against paper (255) linearly, so the
// mean tells us how much of the pixel the shape covered. Measuring at half-maximum
// is how feature width is read from an aliased raster without the answer depending
// on where the edge happened to fall.
func coverage(img image.Image, x, y int) float64 {
	r, g, b := luminance(img, x, y)
	mean := (float64(r) + float64(g) + float64(b)) / 3
	c := (255 - mean) / (255 - 22.7)
	if c < 0 {
		return 0
	}
	if c > 1 {
		return 1
	}
	return c
}

// isLogo recognises the mark: the test logo is pure red, which neither ink nor
// paper can be, so "the logo reached this pixel" is a positive claim rather than
// the absence of ink.
func isLogo(img image.Image, x, y int) bool {
	r, g, b := luminance(img, x, y)
	return r > 200 && g < 120 && b < 120
}

func isDark(img image.Image, x, y int) bool { return coverage(img, x, y) > 0.5 }

func blankLogo() image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	red := color.NRGBA{R: 0xff, A: 0xff}
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.SetNRGBA(x, y, red)
		}
	}
	return img
}
