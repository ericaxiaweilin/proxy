// Command genfixtures 生成 R15.16 媒体管线测试 fixture
// (architecture/fixtures/social-media/matrix/)。
//
// 设计目标:
//   1. 完全 self-contained: 只用 stdlib (image, image/color, image/jpeg)
//   2. 输出 9 类典型照片 + 2 类拒收 (screenshot / ad-banner)
//   3. 每张图都有显式可识别的"特征区域"用于 (a) dominant color
//      测能识别 (b) composition worker 测能 face/body 检出
//   4. 比例精确对齐 (3:4 / 4:5 / 9:16 / 1:1 / 4:3 / 16:9 / 21:9)
//   5. 不靠任何真实人脸 — 用高对比色块/几何图形模拟主体
//
// 9+2 类:
//   single-portrait-half   4:5  → 上半身人像 (脸 + 肩)
//   single-portrait-full   9:16 → 全身人像 (头 + 身 + 脚)
//   single-landscape-half  4:3  → 半躺半身 / 横构半身
//   single-landscape-full  3:1  → 横构全身 (街拍)
//   group-portrait-2       1:1  → 2 人合拍
//   group-portrait-4       1:1  → 4 人合拍
//   landscape-skyline      16:9 → 城市风景
//   object-product         4:5  → 物体 (杯子) 居中
//   object-flatlay         1:1  → 物体 (俯拍多件) 4 宫格
//   ad-banner-text-heavy   16:9 → 广告 / 海报, 文字密, UI 贴 AD
//                              徽标 (不拒)
//   screenshot-ui          9:19.5 → App 截图, UI 贴 SCREENSHOT
//                              徽标, 归类 SYSTEM (不拒)
//
// 重要: 11 个 fixture 都不是被拒内容。代理不拒发内容, 最多只在
// UI 上贴标签 (AD / SCREENSHOT / 等)。内容拒 (黄/政治/暴力)
// 是 R15.17 计划要加的 moderation 状态机, 现在还没接上, 任何
// 政策门取决于人工 review (见 architecture/Implementation_Status.md
// R15.17 计划项)。
//
// 用法:
//   go run ./internal/media/cmd/genfixtures
//
// 输出:
//   architecture/fixtures/social-media/matrix/<id>.jpg
//   + manifest.json (各 id 的预期 dominant_color / compositionHint)
package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log"
	"os"
	"path/filepath"
)

const (
	matrixDir = "/Users/thanhhuyennguyen/Desktop/kake/architecture/fixtures/social-media/matrix"
	jpgQual   = 90
)

// Subject 模拟主体。
type Subject struct {
	Kind     string  // "face" | "body" | "object" | "group"
	Count    int     // 1 / 2 / 4
	CenterX  float64 // [0,1] normalized
	CenterY  float64 // [0,1] normalized
	HalfSize float64 // [0,1] normalized half-width
	Hue      uint8   // dominant hue for this subject
}

// FixtureManifest 输出 manifest, 让 Go 测能 expect 预期 dominantColor。
// IsAdLike / IsScreenshot 标记: 这些图内容上不是被拒 — 跟身
// 体/政治/黄无关 — 他们在 UI 表达上是"广告/截屏" (贴上标签让
// 用户识别)。代理会按 PRD 贴 AD/SYSTEM 徽标, 不设限。
type FixtureManifest struct {
	Id            string  `json:"id"`
	Width         int     `json:"width"`
	Height        int     `json:"height"`
	AspectRatio   float64 `json:"aspectRatio"`
	SubjectType   string  `json:"subjectType"`
	SubjectCount  int     `json:"subjectCount"`
	ExpectedHueR  uint8   `json:"expectedHueR"`
	ExpectedHueG  uint8   `json:"expectedHueG"`
	ExpectedHueB  uint8   `json:"expectedHueB"`
	ToleranceHue  float64 `json:"toleranceHue"`
	// IsAdLike: 16:9 色彩浓照, UI 贴 AD 徽标, 仍可发 (不被拒)。
	IsAdLike bool `json:"isAdLike"`
	// IsScreenshot: 9:19.5 纯 UI 截图, 归类为 SYSTEM 内容 (推文
	// 墙, 不发 Proxy 动态) — 仍可上传, 只是不指向个人。
	IsScreenshot bool `json:"isScreenshot"`
}

func main() {
	abs, _ := filepath.Abs(matrixDir)
	if err := os.MkdirAll(abs, 0o755); err != nil {
		log.Fatalf("mkdir: %v", err)
	}
	log.Printf("output dir: %s", abs)

	specs := []struct {
		id         string
		w, h       int
		subjects   []Subject
		background color.RGBA
		extra      func(img *image.RGBA)
		manifest   FixtureManifest
	}{
		// 1. 半身人像 4:5 — 头 + 肩
		{
			id: "single-portrait-half-4x5", w: 1200, h: 1500,
			subjects: []Subject{{
				Kind: "face", Count: 1, CenterX: 0.5, CenterY: 0.35, HalfSize: 0.22, Hue: 220,
			}},
			background: color.RGBA{240, 235, 230, 255},
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 1,
				ExpectedHueR: 220, ExpectedHueG: 0, ExpectedHueB: 0, // blue (face placeholder)
				ToleranceHue: 0.30,
			},
		},
		// 2. 全身人像 9:16 — 头 + 身 + 脚
		{
			id: "single-portrait-full-9x16", w: 900, h: 1600,
			subjects: []Subject{{
				Kind: "body", Count: 1, CenterX: 0.5, CenterY: 0.5, HalfSize: 0.28, Hue: 30,
			}},
			background: color.RGBA{245, 240, 235, 255},
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 1,
				ExpectedHueR: 30, ExpectedHueG: 0, ExpectedHueB: 0,
				ToleranceHue: 0.30,
			},
		},
		// 3. 横构半身 4:3
		{
			id: "single-landscape-half-4x3", w: 1600, h: 1200,
			subjects: []Subject{{
				Kind: "face", Count: 1, CenterX: 0.5, CenterY: 0.5, HalfSize: 0.18, Hue: 130,
			}},
			background: color.RGBA{180, 200, 170, 255}, // moss green bg (avoid cream)
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 1,
				ExpectedHueR: 130, ExpectedHueG: 0, ExpectedHueB: 0,
				ToleranceHue: 0.30,
			},
		},
		// 4. 横构全身 3:1 — 街拍
		{
			id: "single-landscape-full-3x1", w: 1800, h: 600,
			subjects: []Subject{{
				Kind: "body", Count: 1, CenterX: 0.5, CenterY: 0.5, HalfSize: 0.10, Hue: 240,
			}},
			background: color.RGBA{200, 220, 240, 255},
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 1,
				ExpectedHueR: 240, ExpectedHueG: 0, ExpectedHueB: 0,
				ToleranceHue: 0.30,
			},
		},
		// 5. 2 人合拍 1:1
		{
			id: "group-portrait-2-1x1", w: 1500, h: 1500,
			subjects: []Subject{
				{Kind: "face", Count: 2, CenterX: 0.30, CenterY: 0.40, HalfSize: 0.20, Hue: 0},
				{Kind: "face", Count: 2, CenterX: 0.70, CenterY: 0.40, HalfSize: 0.20, Hue: 60},
			},
			background: color.RGBA{240, 230, 220, 255},
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 2,
				ExpectedHueR: 0, ExpectedHueG: 0, ExpectedHueB: 0, // avg of red+yellow → orange ~ 30
				ToleranceHue: 0.40,
			},
		},
		// 6. 4 人合拍 1:1
		{
			id: "group-portrait-4-1x1", w: 1500, h: 1500,
			subjects: []Subject{
				{Kind: "face", Count: 4, CenterX: 0.25, CenterY: 0.30, HalfSize: 0.15, Hue: 0},
				{Kind: "face", Count: 4, CenterX: 0.75, CenterY: 0.30, HalfSize: 0.15, Hue: 60},
				{Kind: "face", Count: 4, CenterX: 0.25, CenterY: 0.70, HalfSize: 0.15, Hue: 180},
				{Kind: "face", Count: 4, CenterX: 0.75, CenterY: 0.70, HalfSize: 0.15, Hue: 240},
			},
			background: color.RGBA{230, 230, 230, 255},
			manifest: FixtureManifest{
				SubjectType: "PERSON", SubjectCount: 4,
				ExpectedHueR: 130, ExpectedHueG: 0, ExpectedHueB: 0, // avg of all 4 hues
				ToleranceHue: 0.50,
			},
		},
		// 7. 风景 16:9 — sky+ground 双色 (没主体)
		{
			id: "landscape-skyline-16x9", w: 1920, h: 1080,
			subjects:   []Subject{},
			background: color.RGBA{0, 0, 0, 255}, // ignored; use extra to split
			extra: func(img *image.RGBA) {
				drawTwoColorLandscape(img, color.RGBA{120, 170, 220, 255}, color.RGBA{90, 130, 80, 255})
			},
			manifest: FixtureManifest{
				SubjectType: "LANDSCAPE", SubjectCount: 0,
				ExpectedHueR: 105, ExpectedHueG: 0, ExpectedHueB: 0, // avg sky(blue)+ground(green)
				ToleranceHue: 0.40,
			},
		},
		// 8. 物体 4:5 — 居中
		{
			id: "object-product-4x5", w: 1200, h: 1500,
			subjects: []Subject{{
				Kind: "object", Count: 1, CenterX: 0.5, CenterY: 0.5, HalfSize: 0.20, Hue: 0,
			}},
			background: color.RGBA{220, 220, 220, 255}, // mid-grey (avoid white dominance)
			manifest: FixtureManifest{
				SubjectType: "PRODUCT", SubjectCount: 1,
				ExpectedHueR: 0, ExpectedHueG: 0, ExpectedHueB: 0,
				ToleranceHue: 0.30,
			},
		},
		// 9. 物体平铺 1:1 — 4 件
		{
			id: "object-flatlay-1x1", w: 1500, h: 1500,
			subjects: []Subject{
				{Kind: "object", Count: 4, CenterX: 0.30, CenterY: 0.30, HalfSize: 0.13, Hue: 200},
				{Kind: "object", Count: 4, CenterX: 0.70, CenterY: 0.30, HalfSize: 0.13, Hue: 240},
				{Kind: "object", Count: 4, CenterX: 0.30, CenterY: 0.70, HalfSize: 0.13, Hue: 100},
				{Kind: "object", Count: 4, CenterX: 0.70, CenterY: 0.70, HalfSize: 0.13, Hue: 30},
			},
			background: color.RGBA{210, 210, 200, 255}, // warm grey (avoid cream/white)
			manifest: FixtureManifest{
				SubjectType: "PRODUCT", SubjectCount: 4,
				ExpectedHueR: 130, ExpectedHueG: 0, ExpectedHueB: 0, // avg
				ToleranceHue: 0.50,
			},
		},
		// 10. 广告 banner 16:9 — 16:9 色彩浓, UI 贴 AD 徽标, 仍可发
		{
			id: "ad-banner-text-heavy-16x9", w: 1920, h: 1080,
			subjects:   []Subject{},
			background: color.RGBA{0, 0, 0, 255},
			extra: func(img *image.RGBA) {
				drawTextStripes(img, color.RGBA{255, 255, 255, 255}, color.RGBA{0, 0, 0, 255})
			},
			manifest: FixtureManifest{
				SubjectType: "AD_BANNER", SubjectCount: 0,
				IsAdLike: true,
				ExpectedHueR: 0, ExpectedHueG: 0, ExpectedHueB: 0, // b&w stripes
				ToleranceHue: 0.10,
			},
		},
		// 11. App 截图 9:19.5 — SYSTEM 类, UI 贴 SCREENSHOT 徽标
		{
			id: "screenshot-ui-9x19.5", w: 1170, h: 2532,
			subjects:   []Subject{},
			background: color.RGBA{0, 0, 0, 255},
			extra: func(img *image.RGBA) {
				drawUIScreenshot(img)
			},
			manifest: FixtureManifest{
				SubjectType: "SCREENSHOT", SubjectCount: 0,
				IsScreenshot: true,
				ExpectedHueR: 128, ExpectedHueG: 0, ExpectedHueB: 0,
				ToleranceHue: 0.40,
			},
		},
	}

	for _, s := range specs {
		img := image.NewRGBA(image.Rect(0, 0, s.w, s.h))
		// background
		for y := 0; y < s.h; y++ {
			for x := 0; x < s.w; x++ {
				img.Set(x, y, s.background)
			}
		}
		// subjects
		for _, subj := range s.subjects {
			drawSubject(img, s.w, s.h, subj)
		}
		// extra
		if s.extra != nil {
			s.extra(img)
		}
		// write jpg
		out := filepath.Join(abs, s.id+".jpg")
		f, err := os.Create(out)
		if err != nil {
			log.Fatalf("create %s: %v", out, err)
		}
		if err := jpeg.Encode(f, img, &jpeg.Options{Quality: jpgQual}); err != nil {
			log.Fatalf("encode %s: %v", out, err)
		}
		_ = f.Close()

		// manifest
		m := s.manifest
		m.Id = s.id
		m.Width = s.w
		m.Height = s.h
		m.AspectRatio = float64(s.w) / float64(s.h)
		mf, _ := os.Create(filepath.Join(abs, s.id+".json"))
		_ = json.NewEncoder(mf).Encode(m)
		_ = mf.Close()
		fmt.Printf("✓ %s (%dx%d, %.3f)\n", s.id, s.w, s.h, m.AspectRatio)
	}

	// master manifest
	idx := struct {
		Fixtures []string `json:"fixtures"`
		Count    int      `json:"count"`
	}{Count: len(specs)}
	for _, s := range specs {
		idx.Fixtures = append(idx.Fixtures, s.id)
	}
	mf, _ := os.Create(filepath.Join(abs, "manifest.json"))
	_ = json.NewEncoder(mf).Encode(idx)
	_ = mf.Close()
	log.Printf("DONE: %d fixtures in %s", len(specs), abs)
}

func drawSubject(img *image.RGBA, w, h int, s Subject) {
	cx := int(s.CenterX * float64(w))
	cy := int(s.CenterY * float64(h))
	hs := int(s.HalfSize * float64(w))
	if s.HalfSize*float64(w) > s.HalfSize*float64(h) {
		hs = int(s.HalfSize * float64(h))
	}
	col := hueToRGBA(s.Hue)

	switch s.Kind {
	case "face":
		// 圆 + 颈
		drawDisk(img, cx, cy, hs, col)
		// 颈/肩
		drawRect(img, cx-hs/2, cy+hs*4/5, hs, hs/2, color.RGBA{col.R / 2, col.G / 2, col.B / 2, 255})
	case "body":
		// 头
		drawDisk(img, cx, cy-hs*3/4, hs*3/8, col)
		// 身 (长矩形)
		drawRect(img, cx-hs*3/8, cy-hs*1/2, hs*3/4, hs, col)
	case "object":
		// 圆角矩形
		drawRect(img, cx-hs, cy-hs, hs*2, hs*2, col)
		// 高光
		drawDisk(img, cx-hs/3, cy-hs/3, hs/4, color.RGBA{255, 255, 255, 200})
	case "group":
		drawDisk(img, cx, cy, hs, col)
	}
}

func drawDisk(img *image.RGBA, cx, cy, r int, col color.RGBA) {
	for y := -r; y <= r; y++ {
		for x := -r; x <= r; x++ {
			if x*x+y*y <= r*r {
				img.Set(cx+x, cy+y, col)
			}
		}
	}
}

func drawRect(img *image.RGBA, x, y, w, h int, col color.RGBA) {
	for j := 0; j < h; j++ {
		for i := 0; i < w; i++ {
			img.Set(x+i, y+j, col)
		}
	}
}

func drawTwoColorLandscape(img *image.RGBA, sky, ground color.RGBA) {
	b := img.Bounds()
	mid := b.Dy() * 55 / 100 // horizon at 55%
	for y := 0; y < b.Dy(); y++ {
		c := sky
		if y > mid {
			c = ground
		}
		for x := 0; x < b.Dx(); x++ {
			img.Set(x, y, c)
		}
	}
	// mountain silhouette
	for i := 0; i < 5; i++ {
		peakX := b.Dx() * (15 + i*15) / 100
		peakY := mid - 60
		drawTriangle(img, peakX, peakY, 100, 80, color.RGBA{60, 80, 100, 255})
	}
}

func drawTriangle(img *image.RGBA, cx, baseY, halfW, height int, col color.RGBA) {
	for y := 0; y < height; y++ {
		ww := halfW * (height - y) / height
		for x := -ww; x <= ww; x++ {
			img.Set(cx+x, baseY-y, col)
		}
	}
}

func drawTextStripes(img *image.RGBA, fg, bg color.RGBA) {
	b := img.Bounds()
	// horizontal white text stripes on black
	stripeH := b.Dy() / 12
	for s := 0; s < 12; s++ {
		y0 := s*stripeH + stripeH/4
		for y := y0; y < y0+stripeH/2; y++ {
			if y < 0 || y >= b.Dy() {
				continue
			}
			for x := 0; x < b.Dx(); x++ {
				img.Set(x, y, fg)
			}
		}
	}
	_ = bg
}

func drawUIScreenshot(img *image.RGBA) {
	b := img.Bounds()
	// simulate app: header bar + content cards
	headerH := b.Dy() / 12
	drawRect(img, 0, 0, b.Dx(), headerH, color.RGBA{30, 30, 50, 255})
	// cards
	for i := 0; i < 6; i++ {
		y0 := headerH + 40 + i*(b.Dy()/7)
		drawRect(img, 30, y0, b.Dx()-60, b.Dy()/9, color.RGBA{80, 80, 90, 255})
		// text inside
		for ln := 0; ln < 3; ln++ {
			drawRect(img, 50, y0+15+ln*18, b.Dx()-200, 8, color.RGBA{200, 200, 200, 255})
		}
	}
}

func hueToRGBA(h uint8) color.RGBA {
	// 12-hue wheel
	segs := [][3]uint8{
		{255, 0, 0},     // 0
		{255, 128, 0},   // 30
		{255, 255, 0},   // 60
		{128, 255, 0},   // 100
		{0, 255, 0},     // 130
		{0, 255, 128},   // 160
		{0, 255, 255},   // 180
		{0, 128, 255},   // 200
		{0, 0, 255},     // 220
		{128, 0, 255},   // 280
		{255, 0, 255},   // 300
		{255, 0, 128},   // 320
	}
	idx := int(h) * len(segs) / 256
	if idx >= len(segs) {
		idx = len(segs) - 1
	}
	rgb := segs[idx]
	return color.RGBA{rgb[0], rgb[1], rgb[2], 255}
}
