// Package media — MediaCompositionHint (§5.2.2)
//
// 主体类型 + 关键区域。前端只消费此合同，不复制检测逻辑。
// 见 docs/media-pipeline/COMPOSITION_WORKER_SPEC.md
//
// 坐标全部归一化到 [0,1]，相对于原图宽高。
package media

import "time"

const CompositionRecipeVersion = "composition_recipe_v1"

// MediaBox 归一化矩形。
type MediaBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// MediaCompositionHint 主体类型 + 关键区域。
type MediaCompositionHint struct {
	SubjectType   string      `json:"subjectType"`
	SubjectCount  int         `json:"subjectCount"`
	FaceBoxes     []MediaBox  `json:"faceBoxes"`
	BodyBoxes     []MediaBox  `json:"bodyBoxes"`
	TextSafeArea  *MediaBox   `json:"textSafeArea,omitempty"`
	FocalPoint    *MediaBox   `json:"focalPoint,omitempty"`
	SafeCropRect  *MediaBox   `json:"safeCropRect,omitempty"`
	Confidence    float64     `json:"confidence"`
	RecipeVersion string      `json:"recipeVersion"`
	ComputedAt    time.Time   `json:"computedAt"`
}

// SubjectType 枚举（与前端 @proxy/contracts MediaSubjectTypeSchema 对齐）。
const (
	SubjectPerson             = "PERSON"
	SubjectProduct            = "PRODUCT"
	SubjectTextHeavy          = "TEXT_HEAVY"
	SubjectScene              = "SCENE"
	SubjectMixedPersonProduct = "MIXED_PERSON_PRODUCT"
	SubjectMixedPersonText    = "MIXED_PERSON_TEXT"
	SubjectUnknown            = "UNKNOWN"
)

// LowConfidenceThreshold 是前端回落 contain 的阈值（与前端 resolveFillStrategy 一致）。
const LowConfidenceThreshold = 0.4

// MergeSafeCropRect 合并多框 + 5% padding，得到 safeCropRect。
// 入参：归一化坐标框。返回：归一化坐标框，已 clamp 到 [0,1]。
func MergeSafeCropRect(boxes []MediaBox) *MediaBox {
	if len(boxes) == 0 {
		return nil
	}
	minX, minY := 1.0, 1.0
	maxX, maxY := 0.0, 0.0
	for _, b := range boxes {
		if b.X < minX {
			minX = b.X
		}
		if b.Y < minY {
			minY = b.Y
		}
		if b.X+b.Width > maxX {
			maxX = b.X + b.Width
		}
		if b.Y+b.Height > maxY {
			maxY = b.Y + b.Height
		}
	}
	const pad = 0.05
	minX = clamp01(minX - pad)
	minY = clamp01(minY - pad)
	maxX = clamp01(maxX + pad)
	maxY = clamp01(maxY + pad)
	rect := MediaBox{X: minX, Y: minY, Width: maxX - minX, Height: maxY - minY}
	return &rect
}

// UnionBoxes 合并两个可选 safeCropRect（多源：人脸+身体 / 文字+人脸 等）。
func UnionBoxes(a, b *MediaBox) *MediaBox {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	minX := minF(a.X, b.X)
	minY := minF(a.Y, b.Y)
	maxX := maxF(a.X+a.Width, b.X+b.Width)
	maxY := maxF(a.Y+a.Height, b.Y+b.Height)
	rect := MediaBox{X: minX, Y: minY, Width: maxX - minX, Height: maxY - minY}
	return &rect
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
