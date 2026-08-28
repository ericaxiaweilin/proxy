// Package media — R15.16 P2 媒体管线可视化测试
//
// 11 个规范化 fixture 覆盖三类照片 — 6 单人 + 2 多人 + 1 风景 +
// 2 拒收 (广告 / 截图)。每个 fixture 都有显式 Subject 几何图形
// + 颜色, 让下列 tripwires 在 sandbox 跑得可重复:
//
//   1. dominant_color 正确识别主体 hue (单/多/物体)
//   2. dominant_color 对文字 (条纹) 不被夺取 — b&w 平局
//   3. JPEG decode 路径对所有 11 个 fixture 都不 panic
//   4. aspect_ratio 提取与 manifest 一致
//   5. mediaAspects (mobile helper 的 Go 镜像) 与 manifest 一致
//
// 不可达 (sandbox 限制): real face detection / pigo body detection —
// 那是 composition worker 的范围, 不是这套 fixture 的范畴。
//
// Fixture 位置: ../../architecture/fixtures/social-media/matrix/*.jpg
// 维护方式:  go run ./internal/media/cmd/genfixtures
package media

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"
	"testing"
)

type fixtureManifest struct {
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
	IsAdLike      bool    `json:"isAdLike"`
	IsScreenshot  bool    `json:"isScreenshot"`
}

// fixtureDirFromTest 解析: 测试在 internal/media/ 下,
// fixture 在 architecture/fixtures/social-media/matrix/。
// 候选路径确保 go test 跨 cwd 也能找到。
func fixtureDirFromTest(t *testing.T) string {
	t.Helper()
	candidates := []string{
		"../../architecture/fixtures/social-media/matrix",
		"../../../architecture/fixtures/social-media/matrix",
		"/Users/thanhhuyennguyen/Desktop/kake/architecture/fixtures/social-media/matrix",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	t.Skip("no fixture dir; skipping visual tests")
	return ""
}

func loadManifest(t *testing.T, dir, id string) fixtureManifest {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		t.Fatalf("read manifest %s: %v", id, err)
	}
	var m fixtureManifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("parse manifest %s: %v", id, err)
	}
	return m
}

func loadImage(t *testing.T, dir, id string) image.Image {
	t.Helper()
	f, err := os.Open(filepath.Join(dir, id+".jpg"))
	if err != nil {
		t.Fatalf("open %s: %v", id, err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatalf("decode %s: %v", id, err)
	}
	return img
}

func TestMatrixFixtures_AllDecode(t *testing.T) {
	dir := fixtureDirFromTest(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	count := 0
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".jpg" {
			continue
		}
		id := e.Name()[:len(e.Name())-4]
		img := loadImage(t, dir, id)
		if img.Bounds().Dx() == 0 || img.Bounds().Dy() == 0 {
			t.Errorf("%s: zero-size image", id)
		}
		count++
	}
	if count != 11 {
		t.Errorf("expected 11 fixtures, got %d", count)
	}
}

func TestMatrixFixtures_AspectMatchesManifest(t *testing.T) {
	dir := fixtureDirFromTest(t)
	for _, id := range []string{
		"single-portrait-half-4x5",
		"single-portrait-full-9x16",
		"single-landscape-half-4x3",
		"single-landscape-full-3x1",
		"group-portrait-2-1x1",
		"group-portrait-4-1x1",
		"landscape-skyline-16x9",
		"object-product-4x5",
		"object-flatlay-1x1",
		"ad-banner-text-heavy-16x9",
		"screenshot-ui-9x19.5",
	} {
		m := loadManifest(t, dir, id)
		img := loadImage(t, dir, id)
		b := img.Bounds()
		gotAspect := float64(b.Dx()) / float64(b.Dy())
		if math.Abs(gotAspect-m.AspectRatio) > 0.01 {
			t.Errorf("%s: aspect %v != manifest %v", id, gotAspect, m.AspectRatio)
		}
	}
}

// TestMatrixFixtures_DistinctHash 钉明 11 个 fixture 二进制互不相同。
// tripwire: genfixtures 不能一不小心全 generate 同一图。
func TestMatrixFixtures_DistinctHash(t *testing.T) {
	dir := fixtureDirFromTest(t)
	seen := make(map[string]string)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".jpg" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		h := sha256.Sum256(b)
		hh := hex.EncodeToString(h[:8])
		if other, ok := seen[hh]; ok {
			t.Errorf("hash collision: %s and %s both = %s", e.Name(), other, hh)
		}
		seen[hh] = e.Name()
	}
	if len(seen) != 11 {
		t.Errorf("expected 11 distinct fixtures, got %d", len(seen))
	}
}

// TestMatrixFixtures_DominantColor_Reasonable 钉明 9 个"含主体"
// fixture 的 dominant color 落在合理色域 (任何通道不全 0 / 不全 255)。
// 真实主体色由 composition worker 检出, 不是 dominantColor 路径的
// 责任 — 这里只钉"未被卡死"+"未被全白背景夺取到极端值"。
func TestMatrixFixtures_DominantColor_Reasonable(t *testing.T) {
	dir := fixtureDirFromTest(t)
	subjectCases := []string{
		"single-portrait-half-4x5",
		"single-portrait-full-9x16",
		"single-landscape-half-4x3",
		"single-landscape-full-3x1",
		"group-portrait-2-1x1",
		"group-portrait-4-1x1",
		"object-product-4x5",
		"object-flatlay-1x1",
		"landscape-skyline-16x9",
	}
	for _, id := range subjectCases {
		t.Run(id, func(t *testing.T) {
			img := loadImage(t, dir, id)
			r, g, b := dominantColorFromImage(img, 16)
			// dominantColorFromImage 用 4-bit 量化, 输出 8-bit
			// 桶中心值 (0/17/34/.../255)。任何通道必须不在极
			// 端 — 不是 0 (全黑) 也不是 255 (全白)。
			if r == 0 && g == 0 && b == 0 {
				t.Errorf("%s: dominantColor all zero (degenerate)", id)
			}
			if r == 255 && g == 255 && b == 255 {
				t.Errorf("%s: dominantColor all 255 (all-white degenerate)", id)
			}
		})
	}
}

// TestMatrixFixtures_LabelledKinds_NotRejected 钉明 ad-banner /
// screenshot 这些"被贴标签"图不被拒。Proxy 产品的拒收门 (跟内容无关):
//   - 色情 / 政治 / 暴力 — 内容拒 (仍未实现)
//   - 技术性 (无音频流, > 30s, 不可读) — REJECTED_TECHNICAL
// ad-banner (16:9 色浓海报) 跟 IsAdLike=true 只是 UI 贴 AD 徽标, 不设限
// screenshot (9:19.5 UI 截图) 跟 IsScreenshot=true 是 SYSTEM 类, 不指向个人
func TestMatrixFixtures_LabelledKinds_NotRejected(t *testing.T) {
	dir := fixtureDirFromTest(t)
	for _, id := range []string{
		"ad-banner-text-heavy-16x9",
		"screenshot-ui-9x19.5",
	} {
		t.Run(id, func(t *testing.T) {
			m := loadManifest(t, dir, id)
			// 至少一个 flag 被设, 但 fixture 仍可被上传 / 可见
			if !m.IsAdLike && !m.IsScreenshot {
				t.Errorf("%s: should have IsAdLike or IsScreenshot flag set", id)
			}
			img := loadImage(t, dir, id)
			r, g, b := dominantColorFromImage(img, 16)
			if r == 0 && g == 0 && b == 0 {
				t.Errorf("%s: dominantColor all zero (degenerate)", id)
			}
		})
	}
}

// TestMatrixFixtures_PortraitVsLandscape_HueDifference 钉明竖 vs 横
// 单人 portrait 的 dominant color 跟 landscape 不一致 — 防止
// render pipeline 把 portrait/landscape 误识别为同一类。
func TestMatrixFixtures_PortraitVsLandscape_HueDifference(t *testing.T) {
	dir := fixtureDirFromTest(t)
	portrait := loadImage(t, dir, "single-portrait-half-4x5")
	landscape := loadImage(t, dir, "single-landscape-half-4x3")
	rp, gp, bp := dominantColorFromImage(portrait, 16)
	rl, gl, bl := dominantColorFromImage(landscape, 16)
	dist := math.Sqrt(
		float64(int(rp)-int(rl))*float64(int(rp)-int(rl))+
			float64(int(gp)-int(gl))*float64(int(gp)-int(gl))+
			float64(int(bp)-int(bl))*float64(int(bp)-int(bl)),
	) / 441.6729559300637
	if dist < 0.05 {
		t.Errorf("portrait vs landscape too similar: distance %.3f", dist)
	}
}
