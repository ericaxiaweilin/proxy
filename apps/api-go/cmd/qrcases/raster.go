package main

import (
	"image"
	"image/color"
	"math"

	"golang.org/x/image/draw"
)

// supersample is the rasteriser's internal resolution factor. The component ships a
// vector path, so a one-sample-per-pixel sweep would snap every edge and change the
// ink area of a 0.87-module dot — the very quantity this sweep exists to measure.
// Sampling 4x and box-filtering lands within a fraction of a pixel of what a real
// SVG rasteriser produces, at every size in the grid.
const supersample = 4

// ink is color.ink (#17131F) and paper is color.white, the two fills the component uses.
var (
	ink   = color.NRGBA{R: 0x17, G: 0x13, B: 0x1f, A: 0xff}
	paper = color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
)

// render draws one case at `size` pixels: white field, rounded dots, the three finder
// shapes (outer minus hole, plus core — the same result the evenodd path produces),
// then the white badge ring with the logo clipped to a circle inside it.
func render(size int, matrix [][]bool, geo geometry, logo image.Image, ratio float64) image.Image {
	n := len(matrix)
	module := float64(size) / float64(n)
	dot := 1 - geo.dotInset*2

	// ratio == geo.logoRatio is the shipping value; the other rows sweep it to show
	// where the margin dies. Python branched on that equality and computed the same
	// number either way, so the branch is gone.
	var mark image.Image
	var badge, logoSize float64
	pos := 0.0
	if ratio > 0 {
		logoSize = float64(iround(float64(size) * ratio))
		ringPad := float64(iround(float64(size) * geo.logoRingRatio))
		badge = logoSize + ringPad*2
		pos = (float64(size) - badge) / 2
		mark = resize(logo, int(logoSize))
	}

	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	step := 1.0 / float64(supersample)
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			var r, g, b uint32
			for sy := 0; sy < supersample; sy++ {
				for sx := 0; sx < supersample; sx++ {
					x := float64(px) + step*float64(sx) + step/2
					y := float64(py) + step*float64(sy) + step/2
					c := paint(x, y, n, module, geo, dot, matrix, mark, badge, pos, logoSize)
					r += uint32(c.R)
					g += uint32(c.G)
					b += uint32(c.B)
				}
			}
			total := uint32(supersample * supersample)
			out.SetNRGBA(px, py, color.NRGBA{R: byte(r / total), G: byte(g / total), B: byte(b / total), A: 0xff})
		}
	}
	return out
}

// paint returns the colour of one sample point, in pixels.
func paint(x, y float64, n int, module float64, geo geometry, dot float64,
	matrix [][]bool, mark image.Image, badge, pos, logoSize float64) color.NRGBA {
	mx := int(math.Floor(x / module))
	my := int(math.Floor(y / module))
	if mx < 0 || my < 0 || mx >= n || my >= n {
		return paper
	}

	// The badge is a View stacked on top of the SVG in the component, so it is
	// painted first here and covers the dots and finders underneath it. Deciding the
	// ink layers first would let a dot win at the centre and the sweep would grade a
	// code whose middle was never actually obscured.
	if mark != nil && badge > 0 {
		bx, by := x-pos, y-pos
		radius := badge / 2
		if inCircle(bx, by, radius, radius, radius) {
			lx, ly := bx-(badge-logoSize)/2, by-(badge-logoSize)/2
			logoRadius := logoSize / 2
			if inCircle(lx, ly, logoRadius, logoRadius, logoRadius) {
				px := clamp(int(math.Floor(lx)), 0, int(logoSize)-1)
				py := clamp(int(math.Floor(ly)), 0, int(logoSize)-1)
				return color.NRGBAModel.Convert(mark.At(px, py)).(color.NRGBA)
			}
			return paper
		}
	}

	// The three finder corners claim their whole 7×7 block: inside one, no dot is
	// drawn and the finder shapes take over (inFinder in the component).
	corner := finderCorner(mx, my, n)
	if corner >= 0 {
		ox, oy := finderOrigin(corner, n)
		fx := x/module - float64(ox)
		fy := y/module - float64(oy)
		outer := 7 * geo.finderRadius
		inOuter := inRoundedRect(fx, fy, 0, 0, 7, 7, outer)
		inHole := inRoundedRect(fx, fy, 1, 1, 5, 5, outer-geo.finderHoleInset)
		inCore := inRoundedRect(fx, fy, 2, 2, 3, 3, 3*geo.coreRadius)
		if inCore || (inOuter && !inHole) {
			return ink
		}
		return paper
	}

	if matrix[my][mx] {
		dx := x/module - float64(mx)
		dy := y/module - float64(my)
		if inRoundedRect(dx, dy, geo.dotInset, geo.dotInset, dot, dot, geo.dotRadius) {
			return ink
		}
	}
	return paper
}

// finderCorner returns 0/1/2 for the top-left, top-right, bottom-left 7×7 corners
// (component order) or -1 when the module is not inside one.
func finderCorner(mx, my, n int) int {
	switch {
	case mx <= 6 && my <= 6:
		return 0
	case mx >= n-7 && my <= 6:
		return 1
	case mx <= 6 && my >= n-7:
		return 2
	}
	return -1
}

func finderOrigin(corner, n int) (int, int) {
	switch corner {
	case 1:
		return n - 7, 0
	case 2:
		return 0, n - 7
	default:
		return 0, 0
	}
}

// inRoundedRect is the exact inside-test of the component's rounded-rect subpath:
// a signed distance field with corner radius r, clamped to half the short edge the
// way an SVG arc clamps an over-large radius.
func inRoundedRect(px, py, x, y, w, h, r float64) bool {
	if r < 0 {
		return false
	}
	if max := math.Min(w, h) / 2; r > max {
		r = max
	}
	qx := math.Abs(px-(x+w/2)) - (w/2 - r)
	qy := math.Abs(py-(y+h/2)) - (h/2 - r)
	d := math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - r
	return d <= 0
}

func inCircle(px, py, cx, cy, r float64) bool {
	dx, dy := px-cx, py-cy
	return dx*dx+dy*dy <= r*r
}

// resize scales the logo to a logoSize square and flattens it onto paper. The
// component draws the mark inside a white badge, so an alpha-aware composite is what
// actually ships — keeping the alpha channel and reading its RGB instead would paint
// the logo's transparent pixels black and make the sweep grade a code the app never
// shows.
func resize(src image.Image, side int) image.Image {
	scaled := image.NewNRGBA(image.Rect(0, 0, side, side))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, src.Bounds().Sub(src.Bounds().Min), draw.Over, nil)

	flat := image.NewNRGBA(image.Rect(0, 0, side, side))
	draw.Draw(flat, flat.Bounds(), image.NewUniform(paper), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), scaled, image.Point{}, draw.Over)
	return flat
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func iround(v float64) int { return int(math.Floor(v + 0.5)) }
