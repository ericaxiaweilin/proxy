package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
)

// geometry is the QR drawing maths as it exists in the shipping component. The
// units are modules: a value of 1.0 is one cell of the n×n grid, and the component
// renders it through an SVG viewBox of 0 0 n n scaled to `size` pixels.
type geometry struct {
	dotRadius       float64 // 点圆角（DOT_RADIUS）
	dotInset        float64 // 点缩进（DOT_INSET）；点边长 = 1 - 2*inset
	finderRadius    float64 // 定位角外圈圆角，相对 7 模块（FINDER_RADIUS）
	finderHoleInset float64 // 外圈挖空的收缩量（FINDER_HOLE_INSET）
	coreRadius      float64 // 3×3 内芯圆角，相对 3 模块（FINDER_CORE_RADIUS）
	logoRatio       float64 // 徽标直径 / 码边长（LOGO_RATIO）
	logoRingRatio   float64 // 徽标白圈宽度 / 码边长（LOGO_RING_RATIO）
}

// geometryConstants are the names the component declares. The sweep reads them from
// proxy-qr-code.tsx instead of copying them, because a copied set drifts: the Python
// version and the component disagreed about dot shape for a whole round, and the
// sweep still reported 144/144.
var geometryConstants = []string{
	"DOT_RADIUS", "DOT_INSET", "FINDER_RADIUS", "FINDER_HOLE_INSET",
	"FINDER_CORE_RADIUS", "LOGO_RATIO", "LOGO_RING_RATIO",
}

func readGeometry(path string) (geometry, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return geometry{}, fmt.Errorf("read component %s: %w", path, err)
	}

	text := string(body)
	values := make(map[string]float64, len(geometryConstants))
	for _, name := range geometryConstants {
		// Only a top-level numeric literal counts: `const X = 0.22;`. A comment
		// describing the number, or a computed value, must not silently substitute.
		re := regexp.MustCompile(`(?m)^const ` + name + ` = ([0-9]+(?:\.[0-9]+)?);`)
		match := re.FindStringSubmatch(text)
		if match == nil {
			return geometry{}, fmt.Errorf(
				"%s: did not find `const %s = <number>;` — the sweep renders the component's own geometry, "+
					"so renaming or removing the constant has to stop it rather than draw a stale one", path, name)
		}
		v, err := strconv.ParseFloat(match[1], 64)
		if err != nil {
			return geometry{}, fmt.Errorf("%s: %s is not a number (%q): %w", path, name, match[1], err)
		}
		values[name] = v
	}

	geo := geometry{
		dotRadius:       values["DOT_RADIUS"],
		dotInset:        values["DOT_INSET"],
		finderRadius:    values["FINDER_RADIUS"],
		finderHoleInset: values["FINDER_HOLE_INSET"],
		coreRadius:      values["FINDER_CORE_RADIUS"],
		logoRatio:       values["LOGO_RATIO"],
		logoRingRatio:   values["LOGO_RING_RATIO"],
	}
	// dot 边长必须为正，否则整片墨都不见了 —— 那会渲染成"码是空的"而不是报错。
	if geo.dotInset*2 >= 1 {
		return geometry{}, fmt.Errorf("%s: DOT_INSET=%g leaves a dot edge of %g — nothing would be drawn",
			path, geo.dotInset, 1-2*geo.dotInset)
	}
	return geo, nil
}
