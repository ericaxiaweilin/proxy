package media

import (
	"context"
	"crypto/sha1"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

// Confidentiality watermark pipeline (R36.x WATERMARK-001).
//
// Every derived image variant (thumbs, feed sizes, gallery, share OG)
// carries a burned-in dark watermark identifying the source asset and
// the derivation date, so a leaked screenshot/file can be traced back
// to the exact Proxy media asset. The watermark is rendered once per
// unique text and cached under the store dir; ffmpeg `overlay` burns
// it in (no libfreetype needed — the stock macOS ffmpeg lacks
// drawtext). PLACEHOLDER blocks are exempt: they carry no content.
//
// This is asset-level tracing. Viewer-level tracing (who fetched
// what, when) is the access log in the api media handlers.
func watermarkTextFor(mediaAssetID string, now time.Time) string {
	short := mediaAssetID
	if len(short) > 8 {
		short = short[len(short)-8:]
	}
	return fmt.Sprintf("Proxy %s %s", short, now.UTC().Format("20060102"))
}

func renderWatermarkPNG(text string) ([]byte, error) {
	face := basicfont.Face7x13
	width := font.MeasureString(face, text).Ceil() + 24
	height := 30
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	// Dark translucent bar.
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.RGBA{0, 0, 0, 115}}, image.Point{}, draw.Src)
	// Soft light text with a darker shadow for readability on any photo.
	shadow := &font.Drawer{Dst: img, Src: image.NewUniform(color.RGBA{0, 0, 0, 150}), Face: face, Dot: fixed.P(13, 21)}
	shadow.DrawString(text)
	main := &font.Drawer{Dst: img, Src: image.NewUniform(color.RGBA{255, 255, 255, 165}), Face: face, Dot: fixed.P(12, 20)}
	main.DrawString(text)
	var buf []byte
	w := &byteSliceWriter{buf: &buf}
	if err := png.Encode(w, img); err != nil {
		return nil, err
	}
	return buf, nil
}

type byteSliceWriter struct {
	buf *[]byte
}

func (w *byteSliceWriter) Write(p []byte) (int, error) {
	*w.buf = append(*w.buf, p...)
	return len(p), nil
}

func watermarkOverlayPath(storeDir, text string) (string, error) {
	sum := sha1.Sum([]byte("proxy-wm-v1|" + text))
	path := filepath.Join(storeDir, fmt.Sprintf(".proxy-wm-%x.png", sum[:8]))
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	pngBytes, err := renderWatermarkPNG(text)
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(storeDir, ".proxy-wm-*.png")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(pngBytes); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return path, nil
}

// applyConfidentialWatermark burns the asset watermark into the variant
// image at bottom-right, in place (via temp file + rename).
func applyConfidentialWatermark(ctx context.Context, storeDir, variantPath, mediaAssetID string, now time.Time) error {
	overlay, err := watermarkOverlayPath(storeDir, watermarkTextFor(mediaAssetID, now))
	if err != nil {
		return fmt.Errorf("watermark overlay render failed: %w", err)
	}
	tmp, err := os.CreateTemp(storeDir, ".proxy-wm-apply-*.jpg")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	args := []string{"-y", "-i", variantPath, "-i", overlay,
		"-filter_complex", "overlay=W-w-14:H-h-12", tmpPath}
	if out, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("watermark overlay failed: %w: %s", err, clippedOutput(out))
	}
	if err := os.Rename(tmpPath, variantPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}
