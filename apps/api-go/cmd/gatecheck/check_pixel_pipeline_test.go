package main

import (
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The pixel pipeline is the one gate that can lie "green" while broken, so these
// tests pin the judgement rules, not the pretty printing.

func TestParseMetricAcceptsEveryImageMagickShape(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want float64
	}{
		{"0 (0)", 0},                        // v7, no difference
		{"26613.9 (0.0202135)", 26613.9},    // v7 Q16-HDRI build
		{"790", 790},                        // v6 bare integer
		{"compare: image sizes differ", -1}, // no number at all -> NaN
		{"", -1},
	} {
		got := parseMetric(tc.raw)
		if tc.want < 0 {
			if !math.IsNaN(got) {
				t.Errorf("parseMetric(%q) = %v, want NaN", tc.raw, got)
			}
			continue
		}
		if got != tc.want {
			t.Errorf("parseMetric(%q) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}

// A NaN count must never read as a pass: the first version of this tool reported
// "0.00% PASS" for every comparison because it read stdout instead of stderr.
func TestUnparseableMetricIsNeverWithinThreshold(t *testing.T) {
	diffPixels := parseMetric("magick: unable to parse image")
	ratio := diffPixels / float64(780*1688)
	if math.IsNaN(ratio) == false {
		t.Fatal("ratio must stay NaN so the pass test below cannot succeed")
	}
	if pass := !math.IsNaN(ratio) && ratio <= 1.0; pass {
		t.Fatal("unparseable difference count passed the threshold test")
	}
}

// A real diff makes ImageMagick exit non-zero. Reading that as "the tool broke"
// was the port's own bug: every genuine difference printed [FAIL] 跑 magick 失败.
func TestNonZeroExitIsNotASpawnFailure(t *testing.T) {
	ranButDiffered := exec.Command("/usr/bin/false").Run()
	if couldNotStart(ranButDiffered) {
		t.Errorf("a command that ran and exited %v was treated as a spawn failure", ranButDiffered)
	}
	if !couldNotStart(exec.Command("/definitely/not/a/binary").Run()) {
		t.Error("a command that could not start was not treated as a failure")
	}
	if couldNotStart(nil) {
		t.Error("a clean exit was treated as a failure")
	}
}

// The crop CSS is built with Sprintf, so a stray `%` (100% width) and a missing
// `</style>` are both silent, page-ruining mistakes. The first port dropped the
// closing tag: every review-stage baseline became a blank sheet that still passed
// the "PNG is bigger than 1KB" success test.
func TestStageCSSInjectionIsClosedAndPercentSafe(t *testing.T) {
	css := stageCSS(410)
	if strings.Contains(css, "%%") {
		t.Errorf("injected CSS still contains %% escapes: %s", css)
	}
	for _, want := range []string{"max-width: 100% !important", "width: 410px !important", "min-height: 100vh"} {
		if !strings.Contains(css, want) {
			t.Errorf("injected CSS is missing %q", want)
		}
	}
	src := "<html><head><style>.page{color:red}</style></head><body><div class=phone>hi</div></body></html>"
	patched := injectStageCSS(src, css)
	if !strings.Contains(patched, "</style></head>") {
		t.Fatal("the injected block is not closed before </head> — the body would be parsed as CSS")
	}
	if got, want := strings.Count(patched, "<style>"), strings.Count(patched, "</style>"); got != want {
		t.Errorf("<style> count %d != </style> count %d", got, want)
	}
	if !strings.Contains(patched, "<body><div class=phone>hi</div></body>") {
		t.Error("the prototype body was not preserved verbatim")
	}
	noHead := injectStageCSS("<div class=phone>x</div>", css)
	if strings.Count(noHead, "<style>") != strings.Count(noHead, "</style>") {
		t.Error("unbalanced style tags when the prototype has no <head>")
	}
}

// End to end, on the real review-stage prototype: a render that is one flat colour
// means the crop CSS did something destructive. Needs Chrome; skipped without it.
func TestReviewStageRenderHasContent(t *testing.T) {
	root := repoRootForTest(t)
	chrome, err := findChrome()
	if err != nil {
		t.Skip("no Chrome/Chromium on this machine")
	}
	if !isReviewStage(filepath.Join(root, referencesDir, "Proxy_Market_Opportunity_Filter_R7.html")) {
		t.Skip("the fixture prototype is no longer a review stage")
	}
	p := prototype{
		file: "Proxy_Market_Opportunity_Filter_R7.html",
		base: "Proxy_Market_Opportunity_Filter_R7",
		slug: "market_opportunity_filter_r7",
		html: filepath.Join(root, referencesDir, "Proxy_Market_Opportunity_Filter_R7.html"),
	}
	out := filepath.Join(t.TempDir(), "stage.png")
	ok, err := renderWithCrop(chrome, p, out)
	if err != nil {
		t.Fatalf("renderWithCrop: %v", err)
	}
	if !ok {
		t.Fatal("renderWithCrop reported failure")
	}
	img, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer img.Close()
	decoded, err := png.Decode(img)
	if err != nil {
		t.Fatal(err)
	}
	bounds := decoded.Bounds()
	distinct := map[uint32]bool{}
	for y := bounds.Min.Y; y < bounds.Max.Y; y += 7 {
		for x := bounds.Min.X; x < bounds.Max.X; x += 7 {
			r, g, b, _ := decoded.At(x, y).RGBA()
			// 12 bits per channel: enough to tell a flat page from a real screen
			// without caring about antialiasing noise.
			distinct[(r>>4)<<16|(g>>4)<<8|b>>4] = true
		}
	}
	if len(distinct) < 20 {
		t.Errorf("the review-stage render has only %d distinct sampled colours — it is a blank page, "+
			"not a cropped phone", len(distinct))
	}
}

func repoRootForTest(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		if fileExists(filepath.Join(dir, referencesDir)) {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	t.Fatal("cannot walk up from the test cwd to a directory containing " + referencesDir)
	return ""
}

func TestFingerprintMatchesTheDocumentedSha1Shape(t *testing.T) {
	dir := t.TempDir()
	html := filepath.Join(dir, "a.html")
	if err := os.WriteFile(html, []byte("<!doctype html><title>t</title>"), 0o600); err != nil {
		t.Fatal(err)
	}
	// sha1(content + "390x844") truncated to 16 hex chars, as the manifest stores it.
	if got, want := fingerprint(html), "0ed5744ee793b62b"; got != want {
		t.Errorf("fingerprint = %q, want %q", got, want)
	}
}

func TestReviewStageDetectionAndViewport(t *testing.T) {
	dir := t.TempDir()
	phone := filepath.Join(dir, "phone.html")
	stage := filepath.Join(dir, "stage.html")
	write := func(path, body string) {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(phone, "<style>.phone{max-width:390px}</style>")
	write(stage, "<style>.proto{display:grid;grid-template-columns:214px 410px 300px}\n.phone{max-width:410px}</style>")

	if isReviewStage(phone) {
		t.Error("a single-column phone screen was detected as a review stage")
	}
	if !isReviewStage(stage) {
		t.Error("a three-column review stage was not detected")
	}
	if got := stageViewport(stage); got != 410 {
		t.Errorf("stageViewport = %d, want 410 (the width .phone declares)", got)
	}
	if got := stageViewport(phone); got != 390 {
		// The width comes from .phone's own declaration, so a 390-wide screen is
		// rendered at 390 — squeezing it to a fixed window is what cut content off.
		t.Errorf("stageViewport = %d, want the declared 390", got)
	}
	noPhone := filepath.Join(dir, "plain.html")
	write(noPhone, "<style>body{margin:0}</style>")
	if got := stageViewport(noPhone); got != defaultStageWPx {
		t.Errorf("stageViewport = %d, want the %d default when nothing declares a width", got, defaultStageWPx)
	}
	if got := stageViewport(filepath.Join(dir, "absent.html")); got != defaultStageWPx {
		t.Errorf("unreadable prototype must fall back to %d, got %d", defaultStageWPx, got)
	}
}

func TestManifestRoundTripKeepsNodeShapeAndOrder(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, baselineDir), 0o755); err != nil {
		t.Fatal(err)
	}
	m := manifest{Viewport: baseViewport, Prototypes: map[string]protoEntry{
		"Proxy_B": {Source: "docs/design/references/B.html", Image: baselineDir + "/b.png", Fingerprint: "bb", Viewport: viewport{Width: 410, Height: 844}, ReviewStageCrop: true},
		"Proxy_A": {Source: "docs/design/references/A.html", Image: baselineDir + "/a.png", Fingerprint: "aa", Viewport: baseViewport},
	}}
	if err := writeManifest(filepath.Join(root, manifestRel), m); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(root, manifestRel))
	if err != nil {
		t.Fatal(err)
	}
	want := `{
  "viewport": {
    "width": 390,
    "height": 844
  },
  "prototypes": {
    "Proxy_A": {
      "source": "docs/design/references/A.html",
      "image": "docs/design/baseline-images/a.png",
      "fingerprint": "aa",
      "viewport": {
        "width": 390,
        "height": 844
      }
    },
    "Proxy_B": {
      "source": "docs/design/references/B.html",
      "image": "docs/design/baseline-images/b.png",
      "fingerprint": "bb",
      "viewport": {
        "width": 410,
        "height": 844
      },
      "reviewStageCrop": true
    }
  }
}
`
	if string(body) != want {
		t.Errorf("manifest shape drifted from JSON.stringify(x, null, 2):\ngot:\n%s\nwant:\n%s", body, want)
	}
	if reloaded := loadManifest(root); len(reloaded.Prototypes) != 2 || !reloaded.Prototypes["Proxy_B"].ReviewStageCrop {
		t.Errorf("manifest did not reload: %+v", reloaded)
	}
	if order := readManifestKeyOrder(root); len(order) != 2 || order[0] != "Proxy_A" {
		t.Errorf("key order = %v", order)
	}
}

func TestMissingManifestIsReportedAsStaleNotSilent(t *testing.T) {
	root := t.TempDir()
	m := loadManifest(root)
	if len(m.Prototypes) != 0 {
		t.Fatalf("expected an empty manifest, got %+v", m)
	}
	// --geometry must refuse rather than print an empty report over zero baselines.
	if err := geometryReport(root); err == nil {
		t.Fatal("geometry over zero baselines returned success")
	}
}

func TestTallyValuesSortsByCountAndCutsToTop(t *testing.T) {
	html := "padding: 8px; margin: 8px; gap: 8px; font-size: 13px; font-size: 11px; border-radius: 12px"
	got := tallyValues(html, spacingPropRE, 2)
	if len(got) != 1 || got[0].value != 8 || got[0].count != 3 {
		t.Fatalf("spacing tally = %+v, want 8x3", got)
	}
	fs := tallyValues(html, fontPropRE, 6)
	if len(fs) != 2 || fs[0].value != 13 {
		t.Errorf("fontSize tally = %+v, want first 13 (stable by first-seen)", fs)
	}
	if s := formatTally(tallyValues(html, radiusPropRE, 5)); s != "12(1)" {
		t.Errorf("radius tally = %q", s)
	}
	if s := formatTally(tallyValues(html, regexp.MustCompile("nope"), 5)); s != "—" {
		t.Errorf("empty tally = %q, want —", s)
	}
}
