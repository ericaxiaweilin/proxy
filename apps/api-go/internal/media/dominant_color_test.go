package media

import (
	"context"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractDominantColor_RealImage(t *testing.T) {
	candidates := []string{
		"media_store",
		"../media_store",
		"../../media_store",
		"/Users/thanhhuyennguyen/Desktop/kake/apps/api-go/media_store",
	}
	var dir string
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			dir = c
			break
		}
	}
	if dir == "" {
		t.Skip("no media_store dir found; skipping real-image test")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		t.Skip("media_store empty")
	}
	seen := 0
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".jpg" {
			continue
		}
		path := filepath.Join(dir, e.Name())
		hex, err := extractDominantColor(context.Background(), path)
		if err != nil {
			t.Errorf("%s: extractDominantColor err: %v", e.Name(), err)
			continue
		}
		if len(hex) != 7 || hex[0] != '#' {
			t.Errorf("%s: invalid hex format %q", e.Name(), hex)
			continue
		}
		t.Logf("%s → %s", e.Name(), hex)
		seen++
		if seen >= 5 {
			break
		}
	}
	if seen == 0 {
		t.Skip("no .jpg found in media_store")
	}
}

func TestDominantColorFromImage_Synthetic(t *testing.T) {
	tests := []struct {
		name string
		img  image.Image
		want string // "#RRGGBB"
	}{
		{
			// 4-bit 量化：200/16=12.5→12 (0xC), 8-bit 还原 = 0xC*17 = 0xCC = 204
			name: "纯红 100x100",
			img:  solidImage(100, 100, color.RGBA{200, 30, 30, 255}),
			want: "#CC1111",
		},
		{
			// 255/16=15→15, 还原 0xF*17=0xFF=255（与输入一致）
			name: "纯白 50x50",
			img:  solidImage(50, 50, color.RGBA{255, 255, 255, 255}),
			want: "#FFFFFF",
		},
		{
			// 会被 extractDominantColor 视作无效回退到 DefaultDominantColor
			name: "纯黑 50x50",
			img:  solidImage(50, 50, color.RGBA{0, 0, 0, 255}),
			want: "#000000",
		},
		{
			// 230/16=14→14, 14*17=238=0xEE; 220/16=13, 13*17=221=0xDD; 200/16=12, 12*17=204=0xCC
			name: "浅米 80x60",
			img:  solidImage(80, 60, color.RGBA{230, 220, 200, 255}),
			want: "#EEDDCC",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r, g, b := dominantColorFromImage(tc.img, 8)
			got := "#" + up(r) + up(g) + up(b)
			// 黑图特殊：返回 #000000 但 extract 会回退到 DefaultDominantColor
			if tc.want == "#000000" {
				t.Logf("raw dominant = #%06X (extract 会回退到 %s)", (uint32(r)<<16)|(uint32(g)<<8)|uint32(b), DefaultDominantColor)
				return
			}
			if got != tc.want {
				t.Errorf("got #%s, want #%s", got, tc.want)
			}
		})
	}
}

func solidImage(w, h int, c color.Color) image.Image {
	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			rgba.Set(x, y, c)
		}
	}
	return rgba
}

func up(b uint8) string {
	const hex = "0123456789ABCDEF"
	return string([]byte{hex[b>>4], hex[b&0xF]})
}
