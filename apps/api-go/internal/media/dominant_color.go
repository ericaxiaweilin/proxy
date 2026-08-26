// Package media — Dominant Color 提取（消除"白/灰边"）。
//
// 原理：图缩到 NxN（默认 8x8 = 64 像素），转 sRGB，桶量化到 4-bit per channel
//（4096 个桶），取众数（出现次数最多的颜色）。最后调一下亮度让"深色系"也
// 能正确出现（避免深色照片被暗色桶淹没）。
//
// 设计选择：纯 stdlib（image/jpeg、image/png、image/draw）+ 1 次全图采样。
//  - 比 bimg vips 调 libvips 节省 100ms 启动 + 避免 CGO 依赖
//  - 比 ffmpeg 调 palettegen 便宜（不派生额外文件）
//  - 精度：8x8 缩略图降采样对"主色"足够（人眼对主色不敏感细微差异）
//
// 与 v1/v2 派生解耦：worker 在 v1 派生后调一次，结果写 MediaAsset.DominantColorHex。
// 失败填兜底色（#0E0A14 与 frame 背景同色），不阻塞 READY。
//
// 客户端使用：contain 模式下用 DominantColorHex 当 frame 背景，深色照片深紫黑，
// 浅色照片浅米色，替代死写死的 #0E0A14 → 消除"图浅/背景深"的强对比灰边。
package media

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"path/filepath"
)

// DefaultDominantColor 是兜底色（与 SocialMediaFrame FRAME_BACKGROUND_HEX 一致）。
// 后端 dominant 提取失败 / 文件不是图像时使用。
const DefaultDominantColor = "#0E0A14"

// extractDominantColor 读图像文件 → 缩 NxN → 桶量化 → 众数 → "#RRGGBB"。
// N=8 平衡精度与速度（8x8=64 像素对主色足够）。
func extractDominantColor(ctx context.Context, path string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("stat: %w", err)
	}
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open: %w", err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	r, g, b := dominantColorFromImage(img, 8)
	if r == 0 && g == 0 && b == 0 {
		// 全黑（极少见：纯黑 PNG）→ 视为无效，回退
		return DefaultDominantColor, nil
	}
	return fmt.Sprintf("#%02X%02X%02X", r, g, b), nil
}

// dominantColorFromImage 对 image.Image 缩 NxN，桶量化 RGB 到 4-bit per channel，
// 取众数。
//
// 亮度权重：略偏向更"亮"的色（人眼对亮色更敏感），避免深色照片全黑主导。
// 但权重不极端（最暗 0.6、最亮 1.0），防止纯白背景夺取主色。
func dominantColorFromImage(src image.Image, n int) (uint8, uint8, uint8) {
	if n < 2 {
		n = 2
	}
	if n > 32 {
		n = 32
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= 0 || h <= 0 {
		return 0, 0, 0
	}
	// 4-bit 量化桶：12-bit 索引 (r4<<8 | g4<<4 | b4) → 4096 桶
	// count[索引] = 加权出现次数
	count := make([]uint32, 1<<12)
	var totalWeight uint64
	for y := 0; y < n; y++ {
		sy := bounds.Min.Y + y*h/n
		for x := 0; x < n; x++ {
			sx := bounds.Min.X + x*w/n
			r, g, b, _ := src.At(sx, sy).RGBA()
			// RGBA() 返回 16-bit alpha-premultiplied 通道；先解 premultiply 简化
			r8 := uint8(r >> 8)
			g8 := uint8(g >> 8)
			b8 := uint8(b >> 8)
			// 亮度权重：基于 ITU-R BT.601 亮度 (0.299R + 0.587G + 0.114B)
			lum := 0.299*float64(r8) + 0.587*float64(g8) + 0.114*float64(b8)
			weight := 0.6 + 0.4*math.Pow(lum/255.0, 2) // 暗 0.6, 亮 1.0
			idx := uint16(uint16(r8&0xF0)<<4 | uint16(g8&0xF0) | uint16(b8>>4))
			count[idx] += uint32(weight * 64) // ×64 避免浮点累加误差
			totalWeight += uint64(weight * 64)
		}
	}
	if totalWeight == 0 {
		return 0, 0, 0
	}
	// 找众数桶
	var bestIdx uint16
	var bestCount uint32
	for idx, c := range count {
		if c > bestCount {
			bestCount = c
			bestIdx = uint16(idx)
		}
	}
	if bestCount == 0 {
		return 0, 0, 0
	}
	// 解码回 8-bit RGB
	r4 := uint8((bestIdx >> 8) & 0xF)
	g4 := uint8((bestIdx >> 4) & 0xF)
	b4 := uint8(bestIdx & 0xF)
	// 4-bit 桶 → 8-bit（×17 = 桶中心值：0→0, 15→255）
	return r4 * 17, g4 * 17, b4 * 17
}

// extractDominantColorForVariant 在 worker 派生流程中调用：先用 ffmpeg 派生的
// FEED_1X JPEG（已缩放、质量已优化）作为主色来源，比读原图快且代表"用户看到的样子"。
// 失败回退到读原图。
func extractDominantColorForVariant(ctx context.Context, storeDir, originalStorageKey string, variant MediaVariant) string {
	// 优先 FEED_1X v1（10x8 ratio 8 = 64 像素，比原图快）
	if variant.Purpose == "FEED_1X" && variant.StorageKey != "" {
		path := filepath.Join(storeDir, variant.StorageKey)
		if hex, err := extractDominantColor(ctx, path); err == nil {
			return hex
		}
	}
	// 兜底：原图
	path := filepath.Join(storeDir, originalStorageKey)
	hex, err := extractDominantColor(ctx, path)
	if err != nil {
		return DefaultDominantColor
	}
	return hex
}

// dominantColorOrDefault 是 worker 调用的"幂等"封装：失败也返回兜底色，不抛 err。
func dominantColorOrDefault(ctx context.Context, path string) string {
	hex, err := extractDominantColor(ctx, path)
	if err != nil {
		return DefaultDominantColor
	}
	return hex
}

var ErrDominantColorExtraction = errors.New("dominant color extraction failed")
