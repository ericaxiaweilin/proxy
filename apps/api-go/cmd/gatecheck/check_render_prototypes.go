package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

func init() {
	checks["render-prototypes"] = renderPrototypes
	checks["crop-markers"] = cropMarkers
}

// cropMarkers checks the manifest's reviewStageCrop markers against what each
// prototype's CSS actually is. The marker selects the crop strategy at render
// time, so a stale one silently produces a horizontally cut-off baseline — and the
// pixel gate then compares the implementation against garbage.
func cropMarkers(root string, _ []string) error {
	m := loadManifest(root)
	if len(m.Prototypes) == 0 {
		return toolError{code: 1, msg: "manifest 里没有任何原型条目 —— 先跑 render-prototypes。"}
	}
	var bad []string
	for _, name := range manifestOrder(root, m.Prototypes) {
		meta := m.Prototypes[name]
		// resolved from the references dir by file name, not from meta.Source: the
		// marker is about the prototype that is actually rendered.
		src := filepath.Join(root, referencesDir, filepath.Base(meta.Source))
		if !fileExists(src) {
			continue
		}
		if isStage := isReviewStage(src); meta.ReviewStageCrop != isStage {
			bad = append(bad, fmt.Sprintf("%s (manifest=%v 实际=%v)", name, meta.ReviewStageCrop, isStage))
		}
	}
	if len(bad) > 0 {
		return toolError{code: 1, msg: "评审台标记与原型结构不符：\n  " + strings.Join(bad, "\n  ")}
	}
	fmt.Printf("%d 个原型的 reviewStageCrop 标记与 CSS 一致\n", len(m.Prototypes))
	return nil
}

// Baseline renderer: docs/design/references/*.html -> 390x844@2x PNGs plus
// docs/design/baseline-images/manifest.json. The pixel gate (UI-PROTO-ALIGN-001)
// reads the manifest fingerprint to detect "prototype edited, baseline stale" —
// "PNG exists" is not freshness, so the fingerprint is part of the contract and
// is sha1(html + "<w>x<h>") truncated to 16 hex chars.
//
// The prototypes have zero external dependencies (no CDN, no remote fonts), so an
// offline headless render is the design intent itself.

const (
	referencesDir   = "docs/design/references"
	baselineDir     = "docs/design/baseline-images"
	manifestRel     = baselineDir + "/manifest.json"
	defaultStageWPx = 410
)

type viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type protoEntry struct {
	Source      string   `json:"source"`
	Image       string   `json:"image"`
	Fingerprint string   `json:"fingerprint"`
	Viewport    viewport `json:"viewport"`
	// set only for review-stage prototypes; must stay in sync with isReviewStage
	ReviewStageCrop bool `json:"reviewStageCrop,omitempty"`
}

type manifest struct {
	Viewport   viewport              `json:"viewport"`
	Prototypes map[string]protoEntry `json:"prototypes"`
}

type prototype struct {
	file string
	base string
	slug string
	html string
}

var reviewStageRE = regexp.MustCompile(`\.proto\s*\{[^}]*grid-template-columns`)
var stagePhoneWidthRE = regexp.MustCompile(`\.phone\s*\{[^}]*max-width:\s*(\d+)px`)

func renderPrototypes(root string, args []string) error {
	force := hasFlag(args, "--force")
	only := flagValue(args, "--only")
	list := hasFlag(args, "--list")

	all, err := prototypes(root, only)
	if err != nil {
		return err
	}
	if len(all) == 0 {
		return fmt.Errorf("没有找到原型（%s）", filepath.Join(root, referencesDir))
	}

	m := loadManifest(root)
	if list {
		return listPrototypes(root, all, m)
	}

	chrome, err := findChrome()
	if err != nil {
		return toolError{code: 69, msg: "找不到 Chrome / Chromium。装一个，或手动截图后放进 " + filepath.Join(root, baselineDir)}
	}
	if err := os.MkdirAll(filepath.Join(root, baselineDir), 0o755); err != nil {
		return err
	}
	m.Viewport = baseViewport
	if m.Prototypes == nil {
		m.Prototypes = map[string]protoEntry{}
	}

	rendered, skipped := 0, 0
	var failed []string
	for _, p := range all {
		out := filepath.Join(root, baselineDir, p.slug+".png")
		fp := fingerprint(p.html)
		prev, hadPrev := m.Prototypes[p.base]
		if !force && fileExists(out) && hadPrev && prev.Fingerprint == fp {
			skipped++
			continue
		}
		stage := isReviewStage(p.html)
		var ok bool
		var runErr error
		if stage {
			ok, runErr = renderWithCrop(chrome, p, out)
		} else {
			ok, runErr = render(chrome, p, out)
		}
		switch {
		case runErr != nil:
			failed = append(failed, p.slug)
			fmt.Printf("  ✗ %s.png  %s\n", p.slug, truncate(runErr.Error(), 90))
		case !ok:
			failed = append(failed, p.slug)
			fmt.Printf("  ✗ %s.png（截图过小，渲染失败）\n", p.slug)
		default:
			entry := protoEntry{
				Source:      referencesDir + "/" + p.file,
				Image:       baselineDir + "/" + p.slug + ".png",
				Fingerprint: fp,
			}
			if stage {
				entry.Viewport = viewport{Width: stageViewport(p.html), Height: baseViewport.Height}
				entry.ReviewStageCrop = true
			} else {
				entry.Viewport = baseViewport
			}
			m.Prototypes[p.base] = entry
			rendered++
			fmt.Printf("  ✓ %s.png\n", p.slug)
		}
	}

	if err := writeManifest(filepath.Join(root, manifestRel), m); err != nil {
		return err
	}
	fmt.Printf("\n渲染 %d · 跳过（未变）%d · 失败 %d · 共 %d\n", rendered, skipped, len(failed), len(all))
	fmt.Printf("输出目录：%s\n", filepath.Join(root, baselineDir))
	if len(failed) > 0 {
		return toolError{code: 1, msg: "失败：" + strings.Join(failed, ", ")}
	}
	return nil
}

var baseViewport = viewport{Width: 390, Height: 844}

func prototypes(root, only string) ([]prototype, error) {
	dir := filepath.Join(root, referencesDir)
	names, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []prototype
	for _, d := range names {
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".html") {
			continue
		}
		file := d.Name()
		base := strings.TrimSuffix(file, ".html")
		// Proxy_Wallet_20260929_0a2f07 -> wallet_0a2f07: shorter, still unique.
		slug := strings.ToLower(strings.TrimPrefix(base, "Proxy_"))
		if only != "" && !strings.Contains(slug, strings.ToLower(only)) && !strings.Contains(base, only) {
			continue
		}
		out = append(out, prototype{file: file, base: base, slug: slug, html: filepath.Join(dir, file)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].file < out[j].file })
	return out, nil
}

func fingerprint(htmlPath string) string {
	body, err := os.ReadFile(htmlPath)
	if err != nil {
		return ""
	}
	h := sha1.New()
	h.Write(body)
	fmt.Fprintf(h, "%dx%d", baseViewport.Width, baseViewport.Height)
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func chromeArgs(width int, out, url string) []string {
	return []string{
		"--headless",
		"--disable-gpu",
		"--hide-scrollbars",
		// 2x Retina: a 1x shot hides the very differences this pipeline exists to find.
		"--force-device-scale-factor=2",
		fmt.Sprintf("--window-size=%d,%d", width, baseViewport.Height),
		"--virtual-time-budget=4000",
		"--screenshot=" + out,
		url,
	}
}

func runChrome(chrome string, args []string) (bool, error) {
	stderr, err := exec.Command(chrome, args...).CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("%s: %s", err, truncate(strings.TrimSpace(string(stderr)), 200))
	}
	// A truncated render still exits 0, so the screenshot file is the real signal.
	return biggerThan(strings.TrimPrefix(args[len(args)-2], "--screenshot="), 1024), nil
}

func render(chrome string, p prototype, out string) (bool, error) {
	return runChrome(chrome, chromeArgs(baseViewport.Width, out, "file://"+p.html))
}

// isReviewStage reports a design-review stage (annotation | phone | notes, ~1110px
// wide) rather than a phone screen. Judged from the CSS, not the file name.
func isReviewStage(htmlPath string) bool {
	src, err := os.ReadFile(htmlPath)
	if err != nil {
		return false
	}
	return reviewStageRE.MatchString(string(src))
}

// stageViewport: .phone declares its own max-width; rendering it at 390 squeezes
// the screen and cuts the right-hand content off, so the window follows the width
// the prototype asked for.
func stageViewport(htmlPath string) int {
	src, err := os.ReadFile(htmlPath)
	if err != nil {
		return defaultStageWPx
	}
	m := stagePhoneWidthRE.FindSubmatch(src)
	if m == nil {
		return defaultStageWPx
	}
	w := 0
	fmt.Sscanf(string(m[1]), "%d", &w)
	if w <= 0 {
		return defaultStageWPx
	}
	return w
}

func stageCSS(width int) string {
	return fmt.Sprintf(`
    /* 精确对齐：body/html 与 .phone 同宽同高，overflow 全关。少这一句就会出现
       几十像素的横向溢出，表现为右边缘卡被切掉一截。 */
    html, body { width: %dpx !important; max-width: %dpx !important;
                 overflow: hidden !important; margin: 0 !important; padding: 0 !important;
                 background: #fff !important; }
    .proto { grid-template-columns: minmax(0, 1fr) !important; max-width: 100%% !important;
             padding: 0 !important; margin: 0 !important; gap: 0 !important; }
    .proto > *:not(.phone) { display: none !important; }
    .phone { width: 100%% !important; max-width: none !important; margin: 0 !important;
             border: 0 !important; border-radius: 0 !important; padding: 0 !important;
             min-height: 100vh !important; overflow: visible !important; }
  `, width, width)
}

// injectStageCSS puts the crop rules at the end of <head> (or at the top when the
// prototype has no head). The closing </style> is not decoration: without it the
// whole body is parsed as CSS text and the render comes out a blank page that still
// passes the "screenshot is big enough" test.
func injectStageCSS(src, css string) string {
	if strings.Contains(src, "</head>") {
		return strings.Replace(src, "</head>", "<style>"+css+"</style></head>", 1)
	}
	return "<style>" + css + "</style>" + src
}

// renderWithCrop writes a patched copy of the prototype to the system temp dir
// (never beside the prototype: a crash there leaves an untracked shim in git
// status) and renders that, so only the centre phone column becomes a baseline.
func renderWithCrop(chrome string, p prototype, out string) (bool, error) {
	width := stageViewport(p.html)
	src, err := os.ReadFile(p.html)
	if err != nil {
		return false, err
	}
	patched := injectStageCSS(string(src), stageCSS(width))
	injected := filepath.Join(os.TempDir(), fmt.Sprintf("render-shim-%d-%s.html", os.Getpid(), p.slug))
	if err := os.WriteFile(injected, []byte(patched), 0o600); err != nil {
		return false, err
	}
	defer os.Remove(injected)
	return runChrome(chrome, chromeArgs(width, out, "file://"+injected))
}

func loadManifest(root string) manifest {
	m := manifest{Viewport: baseViewport, Prototypes: map[string]protoEntry{}}
	body, err := os.ReadFile(filepath.Join(root, manifestRel))
	if err != nil {
		return m
	}
	// A corrupt manifest is treated as empty: every prototype then reports stale,
	// which is loud — the opposite of a silent pass.
	_ = json.Unmarshal(body, &m)
	if m.Prototypes == nil {
		m.Prototypes = map[string]protoEntry{}
	}
	return m
}

func writeManifest(path string, m manifest) error {
	keys := make([]string, 0, len(m.Prototypes))
	for k := range m.Prototypes {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("{\n")
	vp, err := json.MarshalIndent(m.Viewport, "  ", "  ")
	if err != nil {
		return err
	}
	b.WriteString("  \"viewport\": ")
	b.Write(vp)
	b.WriteString(",\n  \"prototypes\": {")
	for i, k := range keys {
		if i > 0 {
			b.WriteString(",")
		}
		entry, err := json.MarshalIndent(m.Prototypes[k], "    ", "  ")
		if err != nil {
			return err
		}
		key, err := json.Marshal(k)
		if err != nil {
			return err
		}
		b.WriteString("\n    ")
		b.Write(key)
		b.WriteString(": ")
		b.Write(entry)
	}
	if len(keys) > 0 {
		b.WriteString("\n  ")
	}
	b.WriteString("}\n}\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func listPrototypes(root string, all []prototype, m manifest) error {
	fmt.Printf("原型 → 基准图（共 %d 个）\n", len(all))
	stale := 0
	for _, p := range all {
		out := filepath.Join(root, baselineDir, p.slug+".png")
		has := fileExists(out)
		prev, hadPrev := m.Prototypes[p.base]
		fresh := has && hadPrev && prev.Fingerprint == fingerprint(p.html)
		if !fresh {
			stale++
		}
		size := "—"
		if has {
			if fi, err := os.Stat(out); err == nil {
				size = fmt.Sprintf("%dKB", iround(float64(fi.Size())/1024))
			}
		}
		mark := "·"
		note := ""
		switch {
		case fresh:
			mark = "✓"
		case has:
			mark = "↑"
			note = "  (HTML 已改，需重渲)"
		}
		fmt.Printf("  %s %s → %s.png  %s%s\n", mark, padEnd(p.file, 46), p.slug, size, note)
	}
	fmt.Printf("  —— 缺失或过期：%d / %d\n", stale, len(all))
	return nil
}

var chromeCandidates = []string{
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
}

func findChrome() (string, error) {
	for _, p := range chromeCandidates {
		if fileExists(p) {
			return p, nil
		}
	}
	return "", fmt.Errorf("no Chrome/Chromium found")
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}

func flagValue(args []string, flag string) string {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func biggerThan(path string, n int64) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.Size() > n
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func padEnd(s string, n int) string {
	for len(s) < n {
		s += " "
	}
	return s
}
