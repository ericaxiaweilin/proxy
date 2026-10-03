package activity

import (
	"strings"
	"time"
	"unicode/utf8"
)

// ORDER-RECIPE-001（用户「我的订单没有存原始的 recipe 么 订单明细丢失的东西还是很多」）：
// 以前一笔报名只落 (activity_id, actor_id, order_no, joined_at)。下单成功页上的
// 那张票（活动 / 时间 / 地点+区域 / 费用 / 一起的人 / 同行人）全是客户端当场从
// 四宫格状态拼出来的，没有任何地方存——「我的订单」只能拿活动**现在**的样子凑，
// 同行人、当时选的地点和时间段都丢了，活动改过的话连标题费用都对不上。
//
// 现在下单那一刻存一份快照：
//   - activity：服务端从活动行里取（可信，不接受客户端改写），含下单后的人数。
//   - recipe：用户在 For You 四宫格里选定的组合（同行人 / 地点 / 时间段），
//     只是「当时给你看的是什么」的记录，客户端提供，服务端只做清洗和截断。
// 快照写入后不再改；「我的订单」照它原样重画同一张票。

// JoinRecipe 是 JoinActivity 可选携带的下单上下文（For You 四宫格的选择）。
type JoinRecipe struct {
	Source    string           `json:"source,omitempty"`
	Companion *RecipeCompanion `json:"companion,omitempty"`
	Place     *RecipePlace     `json:"place,omitempty"`
	Time      string           `json:"time,omitempty"`
}

// RecipeCompanion 是系统推荐的同行人（不代表对方已确认参加）。
type RecipeCompanion struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name"`
	Bio      string `json:"bio,omitempty"`
	PhotoURL string `json:"photoUrl,omitempty"`
}

// RecipePlace 是票上「地点」一栏：场景名 + 区域。
type RecipePlace struct {
	Name string `json:"name"`
	Area string `json:"area,omitempty"`
}

// OrderSnapshotActivity 是下单那一刻活动的样子（服务端取值）。
type OrderSnapshotActivity struct {
	ActivityID     string `json:"activityId"`
	Code           string `json:"code,omitempty"`
	Title          string `json:"title"`
	Desc           string `json:"desc,omitempty"`
	Benefit        string `json:"benefit,omitempty"`
	People         string `json:"people,omitempty"`
	Time           string `json:"time,omitempty"`
	VenueIcon      string `json:"venueIcon,omitempty"`
	VenueName      string `json:"venueName,omitempty"`
	VenueType      string `json:"venueType,omitempty"`
	RealitySceneID string `json:"realitySceneId,omitempty"`
	PriceLabel     string `json:"priceLabel,omitempty"`
	MoneyFlow      string `json:"moneyFlow,omitempty"`
	VenueSpend     string `json:"venueSpend,omitempty"`
	CoverImageURL  string `json:"coverImageUrl,omitempty"`
	// ACTIVITY-COVER-001：封面资产 id 进快照。票券是**历史记录**（票面快照是
	// 判重与展示的事实源，HOME-FORYOU-ORDER-007），活动后来换了封面不能改写
	// 已经发出去的票 —— 所以这里存的是下单那一刻的资产 id。
	// CoverImageURL 一并留着：它是 R17.x 的死字段，形状不变。
	CoverMediaAssetID string `json:"coverMediaAssetId,omitempty"`
	Joined            int    `json:"joined"`
	Capacity          int    `json:"capacity,omitempty"`
}

// OrderSnapshot 是一笔报名在下单那一刻的完整票面（recipe）。
type OrderSnapshot struct {
	OrderNo   string                `json:"orderNo"`
	OrderedAt time.Time             `json:"orderedAt"`
	Source    string                `json:"source,omitempty"`
	Activity  OrderSnapshotActivity `json:"activity"`
	Time      string                `json:"time,omitempty"`
	Place     *RecipePlace          `json:"place,omitempty"`
	Companion *RecipeCompanion      `json:"companion,omitempty"`
}

func clip(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// sanitizeRecipe 清洗客户端提供的下单上下文：只认登记过的来源、截断长度、
// 头像只收 http(s) 链接（打包在 App 里的本地图没有可存的地址，就不存）。
func sanitizeRecipe(r JoinRecipe) JoinRecipe {
	out := JoinRecipe{Time: clip(r.Time, 80)}
	if r.Source == "FOR_YOU" {
		out.Source = r.Source
	}
	if r.Companion != nil && clip(r.Companion.Name, 60) != "" {
		c := RecipeCompanion{ID: clip(r.Companion.ID, 80), Name: clip(r.Companion.Name, 60), Bio: clip(r.Companion.Bio, 200)}
		if u := strings.TrimSpace(r.Companion.PhotoURL); len(u) <= 500 && (strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) {
			c.PhotoURL = u
		}
		out.Companion = &c
	}
	if r.Place != nil && clip(r.Place.Name, 80) != "" {
		out.Place = &RecipePlace{Name: clip(r.Place.Name, 80), Area: clip(r.Place.Area, 60)}
	}
	return out
}

// BuildOrderSnapshot 组装下单快照。a 是报名成功后的活动（人数已含本单）。
func BuildOrderSnapshot(a Activity, orderNo string, orderedAt time.Time, recipe JoinRecipe) OrderSnapshot {
	normalizeActivityForOutput(&a)
	r := sanitizeRecipe(recipe)
	snap := OrderSnapshot{
		OrderNo:   orderNo,
		OrderedAt: orderedAt.UTC(),
		Source:    r.Source,
		Activity: OrderSnapshotActivity{
			ActivityID: a.ID, Code: a.Code, Title: a.Title, Desc: a.Desc, Benefit: a.Benefit, People: a.People,
			Time: a.Time, VenueIcon: a.VenueIcon, VenueName: a.VenueName, VenueType: a.VenueType, RealitySceneID: a.RealitySceneID,
			PriceLabel: a.PriceLabel, MoneyFlow: a.MoneyFlow, VenueSpend: a.VenueSpend, CoverImageURL: a.CoverImageURL, CoverMediaAssetID: a.CoverMediaAssetID,
			Joined: a.Joined, Capacity: a.Capacity,
		},
		Time:      r.Time,
		Place:     r.Place,
		Companion: r.Companion,
	}
	if snap.Time == "" {
		snap.Time = a.Time
	}
	if snap.Place == nil && a.VenueName != "" {
		snap.Place = &RecipePlace{Name: a.VenueName}
	}
	return snap
}
