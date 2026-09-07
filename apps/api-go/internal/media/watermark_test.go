package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// WATERMARK-001: overlay renderer is deterministic and produces a
// non-empty PNG of sane dimensions without any external binary.
func TestWatermarkRenderDeterministic(t *testing.T) {
	a, err := renderWatermarkPNG("Proxy ab61fdae 20260907")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	b, err := renderWatermarkPNG("Proxy ab61fdae 20260907")
	if err != nil {
		t.Fatalf("render again: %v", err)
	}
	if len(a) == 0 || len(a) != len(b) {
		t.Fatalf("watermark render not deterministic: %d vs %d bytes", len(a), len(b))
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(a))
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if cfg.Width < 100 || cfg.Height != 30 {
		t.Fatalf("unexpected overlay geometry: %+v", cfg)
	}
	if watermarkTextFor("ma_ab61fdae735b74daf67d86d4", time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)) == "" {
		t.Fatal("watermark text empty")
	}
}

func decodeVariantJPEG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return jpeg.Decode(f)
}

// WATERMARK-001 e2e: a generated FEED_1X variant carries burned-in
// pixels that differ from the unmarked source region (bottom-right
// corner). Skipped where ffmpeg is unavailable. Runs against the v1
// pipeline (the serving path for thumb/play URLs).
func TestWatermarkBurnedIntoVariant(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "src.jpg")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	// Solid mid-gray source: any burned dark/light mark changes corners.
	img := image.NewRGBA(image.Rect(0, 0, 640, 480))
	for y := 0; y < 480; y++ {
		for x := 0; x < 640; x++ {
			img.Set(x, y, color.RGBA{128, 128, 128, 255})
		}
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	asset := MediaAsset{MediaAssetID: "ma_wm_test_001", MediaType: "IMAGE"}
	variants, err := generateImageVariants(t.Context(), src, dir, asset, time.Now())
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	var feedPath string
	for _, v := range variants {
		if v.Purpose == "FEED_1X" {
			feedPath = filepath.Join(dir, v.StorageKey)
		}
	}
	if feedPath == "" {
		t.Fatal("no FEED_1X variant produced")
	}
	marked, err := decodeVariantJPEG(feedPath)
	if err != nil {
		t.Fatalf("decode variant: %v", err)
	}
	b := marked.Bounds()
	// Sample bottom-right corner where the mark lands; solid gray
	// source must differ there after burn-in.
	changed := false
	for y := b.Max.Y - 34; y < b.Max.Y - 2; y += 2 {
		for x := b.Max.X - 170; x < b.Max.X - 2; x += 2 {
			r, g, bl, _ := marked.At(x, y).RGBA()
			if r>>8 != 128 || g>>8 != 128 || bl>>8 != 128 {
				changed = true
				break
			}
		}
		if changed {
			break
		}
	}
	if !changed {
		t.Fatal("variant bottom-right corner unchanged: watermark missing")
	}
}
