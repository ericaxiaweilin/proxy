// Package insight 是运营后台「了解用户、辅助小美撮合」的读模型：
//
//   - DemandGap：需求画像与供需缺口——发出来的单有没有人接、接得快不快、哪一类 / 哪一片缺人；
//   - Segments：基于用户标签的分群洞察——标签覆盖了多少人、各轴最多的取值、某个标签的人还有什么别的标签。
//
// 两条硬规矩：
//  1. 不给比值，把两侧的真实体量并排摆出来（需求 N、供给 M），分母接近 0 的比值是噪声；
//  2. 分群数字做小格子抑制：任何少于 MinCell（5）人的格子一律不出数，只说「少于 5」。
//     少于几个人的分群等于在指认个人。
package insight

import (
	"context"
	"time"
)

// MinCell 是任何分群数字能被显示的最小人数。
const MinCell = 5

// ---------------------------------------------------------------- 供需缺口

type Funnel struct {
	Published     int `json:"published"`
	WithApplicant int `json:"withApplicant"`
	Confirmed     int `json:"confirmed"`
	// Unfilled24h：发出超过 24 小时、一个报名都没有。
	Unfilled24h int `json:"unfilled24h"`
	// MedianMinutesToFirstApplicant：发出到第一个报名的中位分钟数；没有任何报名时为 nil（不是 0）。
	MedianMinutesToFirstApplicant *float64 `json:"medianMinutesToFirstApplicant"`
}

type ThemeRow struct {
	Theme         string   `json:"theme"`
	Published     int      `json:"published"`
	WithApplicant int      `json:"withApplicant"`
	Confirmed     int      `json:"confirmed"`
	MedianMinutes *float64 `json:"medianMinutesToFirstApplicant"`
}

// AreaRow 的 Cell 是 0.1° 网格（约 11km，"21.0,105.8"）。Demand / Supply 并排给，不给比值。
type AreaRow struct {
	Cell     string `json:"cell"`
	Demand   int    `json:"demand"`
	Supply   int    `json:"supply"`
	NoSupply bool   `json:"noSupply"`
	Unfilled int    `json:"unfilled24h"`
}

type UnfilledOpp struct {
	ID           string    `json:"id"`
	Theme        string    `json:"theme"`
	Title        string    `json:"title"`
	PriceLabel   string    `json:"priceLabel"`
	Cell         string    `json:"cell,omitempty"`
	MatchingMode string    `json:"matchingMode,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	AgeHours     float64   `json:"ageHours"`
}

type DemandGap struct {
	WindowDays int        `json:"windowDays"`
	Funnel     Funnel     `json:"funnel"`
	Themes     []ThemeRow `json:"themes"`
	Areas      []AreaRow  `json:"areas"`
	// NoLocation：发出时没带坐标的单——它们进不了「哪一片缺人」，数出来而不是悄悄丢掉。
	NoLocation int           `json:"noLocation"`
	Unfilled   []UnfilledOpp `json:"unfilled"`
	Directed   int           `json:"directedExcluded"`
}

// ---------------------------------------------------------------- 分群洞察

// Cell 是一个被抑制过的计数：Users 少于 MinCell 时 Users = nil、Suppressed = true。
type Cell struct {
	Value      string `json:"value"`
	Users      *int   `json:"users"`
	Suppressed bool   `json:"suppressed"`
}

// SuppressCell 做小格子抑制。
func SuppressCell(value string, users int) Cell {
	if users < MinCell {
		return Cell{Value: value, Suppressed: true}
	}
	return Cell{Value: value, Users: &users}
}

type Coverage struct {
	// ActiveUsers：窗口内有过任何行为事件或下过单的人。TaggedUsers：其中至少有一个未过期标签的人。
	ActiveUsers int `json:"activeUsers"`
	TaggedUsers int `json:"taggedUsers"`
	// 标签条数分布（每人未过期标签数）：0 / 1-4 / 5-9 / 10-19 / 20+，针对活跃用户。
	Buckets              []Bucket `json:"buckets"`
	AvgTagsPerTaggedUser *float64 `json:"avgTagsPerTaggedUser"`
}

type Bucket struct {
	Label string `json:"label"`
	Users int    `json:"users"`
}

type Segments struct {
	Coverage Coverage `json:"coverage"`
	// Axis / Top：被点开的那个轴最多的取值（已抑制）。
	Axis string `json:"axis,omitempty"`
	Top  []Cell `json:"top,omitempty"`
	// With：被点开的 (axis, value) 的人还有哪些别的标签（已抑制）。
	WithAxis   string `json:"withAxis,omitempty"`
	WithValue  string `json:"withValue,omitempty"`
	AlsoHave   []Cell `json:"alsoHave,omitempty"`
	CohortSize *Cell  `json:"cohort,omitempty"`
}

// InterestRow 是「行为与兴趣」页的一行：人群里最普遍的兴趣类标签。Users < MinCell 的整行不出现（不是显示 0）。
type InterestRow struct {
	Tag        string  `json:"tag"` // 如 "话题·摄影"
	Axis       string  `json:"axis"`
	Value      string  `json:"value"`
	Users      int     `json:"users"`
	Score      float64 `json:"score"`      // 这些人对该标签的平均强度
	Confidence float64 `json:"confidence"` // 平均置信度
}

// ProviderRow 是接单资料已上线（非草稿）的服务方的基本信息。
type ProviderRow struct {
	UserID   string   `json:"userId"`
	Name     string   `json:"name"`
	Handle   string   `json:"handle"`
	City     string   `json:"city"`
	Services []string `json:"services"`
}

// SourceCount 是一个行为源在窗口内的真实量：管线有没有在吃数据，一眼可见。
type SourceCount struct {
	Source   string `json:"source"`
	Label    string `json:"label"`
	Consent  string `json:"consent"` // PASSIVE（要采集同意）| ACTIVE（用户主动做的事）
	Last7d   int64  `json:"last7d"`
	Total    int64  `json:"total"`
}

type Source interface {
	// Sources：各行为源的量（OPS-TAG-PIPELINE-001）。
	Sources(ctx context.Context, now time.Time) ([]SourceCount, error)
	// Providers 列出服务方（limit 上限 500）；Provider 取一个（不存在返回 false）。
	Providers(ctx context.Context, limit int) ([]ProviderRow, error)
	Provider(ctx context.Context, userID string) (ProviderRow, bool, error)
	// TopInterests：各兴趣类轴（话题 / 场景 / 活动 / 场所类型）里最普遍的标签，已做小格子抑制。
	TopInterests(ctx context.Context, now time.Time, limit int) ([]InterestRow, error)
	DemandGap(ctx context.Context, now time.Time, days int) (DemandGap, error)
	Segments(ctx context.Context, now time.Time, axis, withAxis, withValue string) (Segments, error)
}

// EvalCase 是撮合评估的一个案例：一张公开市场单、它所有仍有效的报名人、发单方最终选定的那个人（OPS-MATCH-EVAL-001）。
type EvalCase struct {
	OpportunityID string
	Applicants    []string
	Chosen        string
	Lat, Lng      *float64
}
