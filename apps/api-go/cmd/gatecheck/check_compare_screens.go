package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

func init() { checks["compare-screens"] = compareScreens }

// Visual comparison against the rendered prototype baselines. Three modes:
//
//	--geometry            what the prototype CSS actually uses (no pixels, no deps)
//	--pixel <shot> --for  diffRatio against the baseline (needs ImageMagick)
//	--list                which baselines exist
//
// The number is for humans and for a model to reason about; the diff image is for
// an eye. Pixel diff says "how much differs", never "what differs".
const visualDiffDir = "docs/design/visual-diffs"

var (
	spacingPropRE = regexp.MustCompile(`(?i)\b(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?\s*:\s*(\d+(?:\.\d+)?)px`)
	fontPropRE    = regexp.MustCompile(`(?i)\bfont-size\s*:\s*(\d+(?:\.\d+)?)px`)
	radiusPropRE  = regexp.MustCompile(`(?i)\bborder-radius\s*:\s*(\d+(?:\.\d+)?)px`)
	metricRE      = regexp.MustCompile(`-?[\d.]+(?:[eE][-+]?\d+)?`)
)

func compareScreens(root string, args []string) error {
	switch {
	case hasFlag(args, "--list"):
		return compareList(root)
	case hasFlag(args, "--geometry"):
		return geometryReport(root)
	case hasFlag(args, "--pixel"):
		shot := flagValue(args, "--pixel")
		key := flagValue(args, "--for")
		if shot == "" || key == "" {
			return toolError{code: 2, msg: "用法：--pixel <截图路径> --for <基准图名字片段>"}
		}
		threshold := 0.05
		if t := flagValue(args, "--threshold"); t != "" {
			v, err := strconv.ParseFloat(t, 64)
			if err != nil {
				return toolError{code: 2, msg: "--threshold 不是数字：" + t}
			}
			threshold = v
		}
		return pixelReport(root, shot, key, threshold)
	default:
		return toolError{code: 2, msg: "用法：--list | --geometry | --pixel <shot.png> --for <name> [--threshold 0.05]"}
	}
}

type tallyItem struct {
	value float64
	count int
}

func tallyValues(html string, re *regexp.Regexp, top int) []tallyItem {
	counts := map[float64]int{}
	order := []float64{}
	for _, m := range re.FindAllStringSubmatch(html, -1) {
		v, err := strconv.ParseFloat(m[1], 64)
		if err != nil || math.IsNaN(v) {
			continue
		}
		if _, seen := counts[v]; !seen {
			order = append(order, v)
		}
		counts[v]++
	}
	items := make([]tallyItem, 0, len(counts))
	for _, v := range order {
		items = append(items, tallyItem{value: v, count: counts[v]})
	}
	// stable so equal counts keep first-seen order, as the previous sort did
	sort.SliceStable(items, func(i, j int) bool { return items[i].count > items[j].count })
	if len(items) > top {
		items = items[:top]
	}
	return items
}

func formatTally(items []tallyItem) string {
	if len(items) == 0 {
		return "—"
	}
	parts := make([]string, 0, len(items))
	for _, it := range items {
		parts = append(parts, fmt.Sprintf("%s(%d)", strconv.FormatFloat(it.value, 'f', -1, 64), it.count))
	}
	return strings.Join(parts, " ")
}

func bar() string { return strings.Repeat("=", 78) }

func geometryReport(root string) error {
	m := loadManifest(root)
	if len(m.Prototypes) == 0 {
		return toolError{code: 1, msg: "没有基准图。先跑：go -C apps/api-go run ./cmd/gatecheck render-prototypes"}
	}
	fmt.Println(bar())
	fmt.Println("原型几何对照 —— 实现该对齐的目标值（零依赖，不比像素）")
	fmt.Println(bar())
	for _, name := range manifestOrder(root, m.Prototypes) {
		meta := m.Prototypes[name]
		src := filepath.Join(root, meta.Source)
		if !fileExists(src) {
			continue
		}
		body, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		html := string(body)
		fmt.Printf("\n── %s\n", name)
		fmt.Printf("   spacing : %s\n", formatTally(tallyValues(html, spacingPropRE, 6)))
		fmt.Printf("   fontSize: %s\n", formatTally(tallyValues(html, fontPropRE, 6)))
		fmt.Printf("   radius  : %s\n", formatTally(tallyValues(html, radiusPropRE, 5)))
	}
	fmt.Println("\n" + bar())
	fmt.Println("这些是原型**实际使用**的取值，不是评判标准 —— 实现可以有别的选择，")
	fmt.Println("但差距大的地方就是「看起来不像」的来源。逐值对照用 proxy-ui-review。")
	fmt.Println(bar())
	return nil
}

func compareList(root string) error {
	m := loadManifest(root)
	fmt.Printf("基准图 %d 张：\n", len(m.Prototypes))
	for _, name := range manifestOrder(root, m.Prototypes) {
		meta := m.Prototypes[name]
		mark := "✗"
		if fileExists(filepath.Join(root, meta.Image)) {
			mark = "✓"
		}
		fmt.Printf("  %s %s %s\n", mark, padEnd(name, 52), filepath.Base(meta.Image))
	}
	fmt.Println()
	fmt.Println("比像素：go -C apps/api-go run ./cmd/gatecheck compare-screens --pixel <实现截图.png> --for <上面的名字片段>")
	fmt.Println("比几何：go -C apps/api-go run ./cmd/gatecheck compare-screens --geometry")
	return nil
}

func resolveBaseline(root, key string) (string, protoEntry, error) {
	m := loadManifest(root)
	k := strings.ToLower(key)
	for _, name := range manifestOrder(root, m.Prototypes) {
		meta := m.Prototypes[name]
		slug := strings.TrimSuffix(filepath.Base(meta.Image), ".png")
		if strings.Contains(strings.ToLower(name), k) || strings.Contains(slug, k) {
			return name, meta, nil
		}
	}
	var lines []string
	for _, name := range manifestOrder(root, m.Prototypes) {
		lines = append(lines, "  "+filepath.Base(m.Prototypes[name].Image)+"  ← "+name)
	}
	return "", protoEntry{}, fmt.Errorf("没有匹配「%s」的基准图。可用：\n%s", key, strings.Join(lines, "\n"))
}

func pngSize(path string) (viewport, error) {
	f, err := os.Open(path)
	if err != nil {
		return viewport{}, err
	}
	defer f.Close()
	head := make([]byte, 24)
	if _, err := io.ReadFull(f, head); err != nil {
		return viewport{}, fmt.Errorf("%s is not a readable PNG: %s", path, err)
	}
	if !bytes.Equal(head[:4], []byte{0x89, 'P', 'N', 'G'}) {
		return viewport{}, fmt.Errorf("%s is not a PNG", path)
	}
	return viewport{Width: int(beUint32(head[16:])), Height: int(beUint32(head[20:]))}, nil
}

func beUint32(b []byte) uint32 {
	return uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
}

func pixelReport(root, shotPath, key string, threshold float64) error {
	name, meta, err := resolveBaseline(root, key)
	if err != nil {
		return toolError{code: 1, msg: err.Error()}
	}
	basePath := filepath.Join(root, meta.Image)
	// `go run` starts the child with cwd = apps/api-go, so a relative --pixel has to
	// resolve against REPO_ROOT like every other path here. The report keeps the
	// path as the caller typed it.
	shotArg := shotPath
	if !filepath.IsAbs(shotArg) {
		shotPath = filepath.Join(root, shotArg)
	}
	if !fileExists(shotPath) {
		return toolError{code: 1, msg: "实现截图不存在：" + shotArg}
	}
	a, err := pngSize(basePath)
	if err != nil {
		return toolError{code: 1, msg: err.Error()}
	}
	b, err := pngSize(shotPath)
	if err != nil {
		return toolError{code: 1, msg: err.Error()}
	}
	fmt.Println(bar())
	fmt.Printf("像素比对：%s\n", shotArg)
	fmt.Printf("      基准：%s（%s）\n", meta.Image, name)
	fmt.Println(bar())
	fmt.Printf("  基准尺寸 %d×%d · 实现尺寸 %d×%d\n", a.Width, a.Height, b.Width, b.Height)
	if a != b {
		fmt.Println()
		fmt.Println("  尺寸不同 —— 像素比对要求同尺寸（都应是 @2x 截图）。")
		fmt.Println("  先把实现截图按基准尺寸裁剪/缩放，否则任何差异比例都没有意义。")
		fmt.Println("  这一条本身常常就是答案：布局宽度或安全区处理不一致。")
		return toolError{code: 1, msg: ""}
	}
	tool := findCompareTool()
	if tool == "" {
		fmt.Println()
		fmt.Println("  没有 ImageMagick（magick/compare）—— 装它才能算像素 diff：")
		fmt.Println("    brew install imagemagick")
		fmt.Println("  在那之前可以用 --geometry 做零依赖的几何对照。")
		return toolError{code: 1, msg: ""}
	}
	outDir := filepath.Join(root, visualDiffDir)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	slug := strings.TrimSuffix(filepath.Base(meta.Image), ".png")
	diffPath := filepath.Join(outDir, slug+"-vs-shot.png")

	// `compare -metric AE` writes the count to **stderr**, and exits non-zero when
	// the images differ, so the metric must be taken from the stderr buffer even on
	// a successful run. Reading only stdout yields an empty string -> unparseable,
	// and an unparseable count that counts as a pass is a false green: the first
	// version reported "0.00% PASS" for a baseline compared with itself.
	args := []string{"-metric", "AE", basePath, shotPath, diffPath}
	if tool == "magick" {
		args = append([]string{"compare"}, args...)
	}
	cmd := exec.Command(tool, args...)
	var metricStderr bytes.Buffer
	cmd.Stderr = &metricStderr
	var metricStdout bytes.Buffer
	cmd.Stdout = &metricStdout
	runErr := cmd.Run()
	diffText := strings.TrimSpace(metricStderr.String())
	if diffText == "" {
		diffText = strings.TrimSpace(metricStdout.String())
	}
	// A non-zero exit is magick's normal way of saying "these images differ", so
	// only a failure to start it means the comparison did not happen. The first
	// port treated every error as fatal and reported FAIL for every real diff.
	if couldNotStart(runErr) {
		fmt.Println()
		fmt.Printf("  [FAIL] 跑 %s 失败：%s\n", tool, runErr)
		fmt.Println(bar())
		return toolError{code: 1, msg: ""}
	}
	// ImageMagick 7 prints `0 (0)`, the HDRI build prints `26613.9 (0.0202135)`,
	// v6 prints a bare integer — so take the first number and never assume.
	diffPixels := parseMetric(diffText)
	ratio := diffPixels / float64(a.Width*a.Height)
	pass := !math.IsNaN(ratio) && ratio <= threshold
	fmt.Println()
	shownPixels := "解析失败（原始输出 " + jsonString(diffText) + "）"
	if !math.IsNaN(diffPixels) {
		shownPixels = strconv.Itoa(int(math.Round(diffPixels)))
	}
	fmt.Printf("  差异像素 %s\n", shownPixels)
	if math.IsNaN(ratio) {
		fmt.Printf("  差异比例 n/a（阈值 %s%%）\n", strconv.FormatFloat(threshold*100, 'f', 0, 64))
		fmt.Println()
		fmt.Println("  [FAIL] 无法解析差异像素数 —— 判定无效，不许当成通过。")
		fmt.Println("         （ImageMagick 输出格式可能变了：手跑 `magick compare -metric AE a.png b.png d.png` 看原始输出）")
		fmt.Println(bar())
		return toolError{code: 1, msg: ""}
	}
	fmt.Printf("  差异比例 %s（阈值 %s%%）\n", strconv.FormatFloat(ratio*100, 'f', 2, 64)+"%", strconv.FormatFloat(threshold*100, 'f', 0, 64))
	if math.Abs(diffPixels-math.Round(diffPixels)) > 0.5 {
		fmt.Printf("  注：%s 报的是浮点（HDRI 构建），已取整；原始值 %s\n", tool, strconv.FormatFloat(diffPixels, 'f', -1, 64))
	}
	conclusion := "[DIFF]"
	if pass {
		conclusion = "[PASS]"
	}
	fmt.Printf("  结论     %s\n", conclusion)
	fmt.Printf("  diff 图：%s\n", diffPath)

	// AE is a pixel *count*, so it is reported as an integer even when the tool is
	// an HDRI build returning a float; the ratio below keeps the full precision.
	diffPixelsOut := any(nil)
	if !math.IsNaN(diffPixels) {
		diffPixelsOut = int(math.Round(diffPixels))
	}
	ratioOut := any(nil)
	if !math.IsNaN(ratio) {
		ratioOut = ratio
	}
	report := diffReport{
		Prototype:  name,
		Baseline:   meta.Image,
		Shot:       shotArg,
		Size:       a,
		DiffPixels: diffPixelsOut,
		DiffRatio:  ratioOut,
		RawMetric:  diffText,
		Threshold:  threshold,
		Pass:       pass,
		DiffImage:  diffPath,
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outDir, slug+"-report.json"), append(body, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Println()
	fmt.Println("  注意：像素 diff 只能告诉你「有多少不一样」，不能告诉你「哪不一样」。")
	fmt.Println("  弱模型读数字（diffRatio）就够了；要定位就打开 diff 图看红色区域。")
	fmt.Println(bar())
	if !pass {
		return toolError{code: 1, msg: ""}
	}
	return nil
}

// diffReport is the machine-readable half of a pixel comparison: the number a
// reviewer (or a model) acts on, next to the image an eye looks at.
type diffReport struct {
	Prototype string   `json:"prototype"`
	Baseline  string   `json:"baseline"`
	Shot      string   `json:"shot"`
	Size      viewport `json:"size"`
	// nil when unparseable — a missing number must serialise as null, not 0.
	DiffPixels any     `json:"diffPixels"`
	DiffRatio  any     `json:"diffRatio"`
	RawMetric  string  `json:"rawMetricOutput"`
	Threshold  float64 `json:"threshold"`
	Pass       bool    `json:"pass"`
	DiffImage  string  `json:"diffImage"`
}

// couldNotStart distinguishes "the comparison never ran" from "the images differ".
func couldNotStart(err error) bool {
	var exitErr *exec.ExitError
	return err != nil && !errors.As(err, &exitErr)
}

// parseMetric reads the AE count out of whatever ImageMagick printed. NaN means
// "unreadable", which the caller must report as a failed judgement — treating it
// as zero difference is the false green this file exists to avoid.
func parseMetric(diffText string) float64 {
	found := metricRE.FindString(diffText)
	if found == "" {
		return math.NaN()
	}
	v, err := strconv.ParseFloat(found, 64)
	if err != nil {
		return math.NaN()
	}
	return v
}

func jsonString(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return strconv.Quote(s)
	}
	return string(b)
}

func sortedKeys(m map[string]protoEntry) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// manifestOrder lists the prototypes in the order the manifest file itself uses.
// Geometry output is one block per prototype, so following the file keeps the
// ported tool's output diff-free; a manifest we cannot walk falls back to sorted.
func manifestOrder(root string, m map[string]protoEntry) []string {
	order := readManifestKeyOrder(root)
	if len(order) == 0 {
		return sortedKeys(m)
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range order {
		if _, ok := m[k]; ok && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	for _, k := range sortedKeys(m) {
		if !seen[k] {
			out = append(out, k)
		}
	}
	return out
}

// Both writers emit the manifest with 2-space indent, so a prototype key is
// exactly a line indented by four spaces ending in ": {". Anything else (a
// hand-minified manifest) falls back to sorted order.
var manifestKeyLineRE = regexp.MustCompile(`(?m)^    "((?:[^"\\]|\\.)*)": \{$`)

func readManifestKeyOrder(root string) []string {
	body, err := os.ReadFile(filepath.Join(root, manifestRel))
	if err != nil {
		return nil
	}
	idx := strings.Index(string(body), `"prototypes"`)
	if idx < 0 {
		return nil
	}
	var keys []string
	for _, m := range manifestKeyLineRE.FindAllStringSubmatch(string(body)[idx:], -1) {
		var name string
		if err := json.Unmarshal([]byte(`"`+m[1]+`"`), &name); err != nil {
			return nil
		}
		keys = append(keys, name)
	}
	return keys
}

func findCompareTool() string {
	for _, t := range []string{"magick", "compare"} {
		if _, err := exec.LookPath(t); err == nil {
			return t
		}
	}
	return ""
}
