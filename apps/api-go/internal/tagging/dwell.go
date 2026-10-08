package tagging

import (
	"fmt"
	"strings"
)

// 停留的口径按**对象类型**分，不用统一的固定秒数（TAG-DWELL-001）。
//
// 依据：X 这类推荐系统是把不同行为拆成独立信号、各自加权；而且「主动点进去之后停留」才是强信号，
// 信息流里划过时的被动停留很弱。人物更特殊——看人像久不代表想约她（兴趣偏差 + 敏感画像），
// 所以人物的被动停留**不**给任何口味类标签加分，只认主动动作（点进主页、关注、发消息…）。
//
// 一次停留折成 0..1 的「信用」，替代原来「停留毫秒线性累加」：看得再久，一次浏览最多 1，
// 一次长时间挂机不会把一个主题顶满。1.0 = 认真看了一次。

type DwellClass string

const (
	// DwellPost：信息流里的帖子卡片（被动，划过时的停留）。
	DwellPost DwellClass = "POST_FEED"
	// DwellActivity：主动点进的活动详情页。
	DwellActivity DwellClass = "ACTIVITY_DETAIL"
)

type dwellTier struct {
	AtMs   int
	Credit float64
}

// 我们的数据量和算力比不上大平台：只分两档（看过 / 认真看），门槛偏高偏粗，宁可少记也不记噪声。
// 每档「停留 ≥ AtMs 毫秒，记 Credit」，AtMs 升序；低于第一档 = 0（一眼划过 / 误触）。
var dwellTiers = map[DwellClass][]dwellTier{
	DwellPost:     {{3000, 0.30}, {10000, 1.00}},
	DwellActivity: {{5000, 0.50}, {15000, 1.00}},
}

// DwellCredit：一次停留（毫秒）折成的信用。未知对象类型 = 0（不认识的不给分）。
func DwellCredit(class DwellClass, ms int) float64 {
	credit := 0.0
	for _, t := range dwellTiers[class] {
		if ms >= t.AtMs {
			credit = t.Credit
		}
	}
	return credit
}

// dwellCreditSQL 生成同一张表的 SQL CASE 表达式，让库里聚合和 Go 里的 DwellCredit 永远一个口径。
func dwellCreditSQL(class DwellClass, col string) string {
	tiers := dwellTiers[class]
	var b strings.Builder
	b.WriteString("(CASE")
	for i := len(tiers) - 1; i >= 0; i-- {
		fmt.Fprintf(&b, " WHEN %s >= %d THEN %.2f", col, tiers[i].AtMs, tiers[i].Credit)
	}
	b.WriteString(" ELSE 0 END)")
	return b.String()
}
