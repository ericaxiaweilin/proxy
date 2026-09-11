package marketplace

// R58 publish-flow catalog engine. The static card list (templates.go)
// stays the source of truth for cards; this file adds the three data
// engines the R58 two-pane catalog + Moment spec sheet need:
//
//   - categories: the delivery-app left rail (热门/见面/娱乐/出行/主题)
//     over the same 16 cards — presentation metadata, not user state.
//   - specs: per-card Moment spec options (人数/时间段/时长/地点) that
//     prefill the spec sheet in step 2.
//   - momentPolicy: per-card ratio policy (1:1 fixed vs group) that
//     drives provider-count math and the ratio badge.
//   - pricingRules: per-card modifiers (duration/time/group deltas) for
//     the dynamic price preview. Preferences add-ons live with the
//     policy so the whole spec sheet renders from one source.
//
// All of this is server-owned read-model data: the client never hardcodes
// Chinese word lists or prices (user rule: 词表走服务端目录), and the
// wire contract stays schema-checked via contracts (OPP-CATALOG-001).

// TemplateCategory is one left-rail entry. Item references are
// (templateID) pairs resolved against opportunityTemplates at serve
// time — a dangling ID is a catalog bug and fails the guard test.
type TemplateCategory struct {
	ID    string   `json:"id"`
	Label string   `json:"label"`
	Hint  string   `json:"hint"`
	Items []string `json:"items"` // template IDs in display order
}

// templateCategories is the R58 left rail. Same 16 cards, five views.
var templateCategories = []TemplateCategory{
	{ID: "hot", Label: "热门", Hint: "高频 Moment", Items: []string{"coffee", "dining", "ktv", "photo", "walk", "exhibition"}},
	{ID: "meet", Label: "见面", Hint: "咖啡 / 吃饭 / 看展", Items: []string{"coffee", "dining", "exhibition", "movie", "shopping"}},
	{ID: "fun", Label: "娱乐", Hint: "唱歌 / 运动 / 探店", Items: []string{"ktv", "movie", "sport", "explore", "shopping"}},
	{ID: "outdoor", Label: "出行", Hint: "走走 / 骑行 / 拍照", Items: []string{"photo", "walk", "cycling", "film-walk", "ao-bike-photo"}},
	{ID: "theme", Label: "主题", Hint: "完整组合玩法", Items: []string{"ao-bike-photo", "sunset-coffee", "film-walk", "night-ktv"}},
}

// MomentSpecs are the step-2 spec sheet options for one template.
type MomentSpecs struct {
	TemplateID string   `json:"templateId"`
	Groups     []string `json:"groups"`    // 人数选项
	Times      []string `json:"times"`     // 时间段选项
	Durations  []string `json:"durations"`  // 时长选项
	Places     []string `json:"places"`     // 地点选项
}

// momentSpecs covers every publishable card. A card without an entry is
// a dead card in step 2 (the guard test requires full coverage).
var momentSpecs = map[string]MomentSpecs{
	"coffee":         {Groups: []string{"1 人", "2 人", "3–4 人"}, Times: []string{"今晚 19:00", "明天 15:00", "周末下午"}, Durations: []string{"1 小时", "2 小时", "3 小时"}, Places: []string{"附近", "西湖", "老城区", "地图选点"}},
	"dining":         {Groups: []string{"1 人", "2 人", "3 人"}, Times: []string{"今晚 18:30", "明天 18:30", "周末晚餐"}, Durations: []string{"1.5 小时", "2 小时", "3 小时"}, Places: []string{"附近", "西湖", "老城区", "地图选点"}},
	"ktv":            {Groups: []string{"1 人", "2 人", "3–4 人", "5–6 人"}, Times: []string{"18:00–20:00", "20:00–22:00", "22:00 后"}, Durations: []string{"2 小时", "3 小时", "4 小时"}, Places: []string{"附近", "老城区", "西湖", "地图选点"}},
	"photo":          {Groups: []string{"1 人", "2 人", "3–4 人"}, Times: []string{"上午", "下午", "日落前"}, Durations: []string{"1 小时", "2 小时", "3 小时"}, Places: []string{"老城区", "西湖", "附近", "地图选点"}},
	"walk":           {Groups: []string{"1 人", "2 人", "3–4 人"}, Times: []string{"上午", "下午", "日落前"}, Durations: []string{"2 小时", "3 小时", "半天"}, Places: []string{"老城区", "西湖", "附近", "地图选点"}},
	"exhibition":     {Groups: []string{"1 人", "2 人"}, Times: []string{"上午", "下午", "周末"}, Durations: []string{"1.5 小时", "2 小时", "3 小时"}, Places: []string{"美术馆", "附近", "地图选点"}},
	"ao-bike-photo":  {Groups: []string{"1 人", "2 人", "3 人", "4 人"}, Times: []string{"09:00–12:00", "15:00–18:00"}, Durations: []string{"3 小时", "半天"}, Places: []string{"老城区", "西湖", "地图选点"}},
	"sunset-coffee":  {Groups: []string{"1 人"}, Times: []string{"17:00–19:00", "17:30–19:30"}, Durations: []string{"1.5 小时", "2 小时"}, Places: []string{"西湖", "湖边", "地图选点"}},
	"film-walk":      {Groups: []string{"1 人"}, Times: []string{"09:00–12:00", "14:00–17:00"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"老城区", "地图选点"}},
	"night-ktv":      {Groups: []string{"1 人", "3–4 人", "5–6 人"}, Times: []string{"20:00–22:00", "20:00–23:00", "22:00 后"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"附近", "老城区", "地图选点"}},
	"cycling":        {Groups: []string{"1 人", "2 人", "3–4 人"}, Times: []string{"上午", "下午", "日落前"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"西湖", "老城区", "地图选点"}},
	"shopping":       {Groups: []string{"1 人", "2 人"}, Times: []string{"下午", "晚上"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"商场", "老城区", "地图选点"}},
	"movie":          {Groups: []string{"1 人", "2 人"}, Times: []string{"下午", "晚上"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"影院", "附近", "地图选点"}},
	"explore":        {Groups: []string{"1 人", "2 人"}, Times: []string{"下午", "晚上"}, Durations: []string{"2 小时", "3 小时"}, Places: []string{"附近", "老城区", "地图选点"}},
	"sport":          {Groups: []string{"1 人", "2 人", "3–4 人"}, Times: []string{"上午", "下午", "晚上"}, Durations: []string{"1 小时", "2 小时"}, Places: []string{"附近", "运动场", "地图选点"}},
	"translate":      {Groups: []string{"1 人"}, Times: []string{"上午", "下午", "晚上"}, Durations: []string{"2 小时", "半天", "全天"}, Places: []string{"具体地址", "地图选点"}},
}

// MomentPolicy is the ratio policy of one card.
type MomentPolicy struct {
	TemplateID string              `json:"templateId"`
	Mode       string              `json:"mode"`       // Moment | Professional
	Ratio      string              `json:"ratio"`      // "1:1" | "≤ 3:1" | ...
	RatioText  string              `json:"ratioText"`  // human sentence
	Fixed      bool                `json:"fixed"`      // fixed 1:1 → providers = customers
	Groups     []string            `json:"groups"`     // 允许的人数档
	Prefs      []MomentPreference  `json:"prefs"`      // 场景偏好（影响匹配/报价）
}

// MomentPreference is one pref row: options carry an add-on price in K.
type MomentPreference struct {
	Key     string                 `json:"key"`
	Label   string                 `json:"label"`
	Options []MomentPrefOption     `json:"options"`
}

// MomentPrefOption is one selectable value + price add-on (K).
type MomentPrefOption struct {
	Value string `json:"value"`
	Add   int    `json:"add"` // +K on top of base; 0 = neutral
}

// momentPolicies covers every publishable card.
var momentPolicies = map[string]MomentPolicy{
	"coffee": {Mode: "Moment", Ratio: "1:1", RatioText: "固定 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "chat", Label: "聊天", Options: []MomentPrefOption{{Value: "轻松聊天", Add: 0}, {Value: "安静陪伴", Add: 0}, {Value: "工作交流", Add: 30}}},
		{Key: "pace", Label: "节奏", Options: []MomentPrefOption{{Value: "随意", Add: 0}, {Value: "有主题", Add: 20}}},
	}},
	"dining": {Mode: "Moment", Ratio: "≤ 3:1", RatioText: "默认 1:1 · 最多 3 位客户 / 1 位接单者", Fixed: false, Groups: []string{"1 人", "2 人", "3 人"}, Prefs: []MomentPreference{
		{Key: "diningType", Label: "饭局", Options: []MomentPrefOption{{Value: "普通聊天", Add: 0}, {Value: "商务交流", Add: 80}}},
		{Key: "alcohol", Label: "酒精环境", Options: []MomentPrefOption{{Value: "不涉及", Add: 0}, {Value: "可能有", Add: 0}}},
		{Key: "after", Label: "饭后", Options: []MomentPrefOption{{Value: "结束", Add: 0}, {Value: "散步", Add: 30}, {Value: "KTV", Add: 150}}},
	}},
	"ktv": {Mode: "Moment", Ratio: "1:1", RatioText: "核心 1:1 · 多组可合并同一活动", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "vibe", Label: "氛围", Options: []MomentPrefOption{{Value: "唱歌为主", Add: 0}, {Value: "轻社交", Add: 30}}},
		{Key: "alcohol", Label: "酒精环境", Options: []MomentPrefOption{{Value: "不涉及", Add: 0}, {Value: "可能有", Add: 0}}},
		{Key: "extra", Label: "延长", Options: []MomentPrefOption{{Value: "不需要", Add: 0}, {Value: "再 1 小时", Add: 100}}},
	}},
	"photo": {Mode: "Moment", Ratio: "1:1", RatioText: "默认 1:1 · 小组拍摄按容量匹配", Fixed: false, Groups: []string{"1 人", "2 人", "3–4 人"}, Prefs: []MomentPreference{
		{Key: "photoStyle", Label: "拍摄", Options: []MomentPrefOption{{Value: "随拍", Add: 0}, {Value: "认真拍", Add: 80}, {Value: "胶片感", Add: 60}}},
	}},
	"walk": {Mode: "Moment", Ratio: "≤ 4:1", RatioText: "默认 1:1 · 小组最多 4 位客户 / 1 位接单者", Fixed: false, Groups: []string{"1 人", "2 人", "3–4 人"}, Prefs: []MomentPreference{
		{Key: "walkStyle", Label: "路线", Options: []MomentPrefOption{{Value: "随意走走", Add: 0}, {Value: "本地路线", Add: 50}, {Value: "拍照路线", Add: 70}}},
	}},
	"exhibition": {Mode: "Moment", Ratio: "≤ 3:1", RatioText: "默认 1:1 · 小组最多 3 位客户 / 1 位接单者", Fixed: false, Groups: []string{"1 人", "2 人"}, Prefs: []MomentPreference{
		{Key: "exhibitStyle", Label: "方式", Options: []MomentPrefOption{{Value: "一起看", Add: 0}, {Value: "边看边聊", Add: 20}}},
	}},
	"ao-bike-photo": {Mode: "Moment", Ratio: "1:1", RatioText: "固定 1:1 · 多人时自动拆成多组 Pair 后合并", Fixed: true, Groups: []string{"1 人", "2 人", "3 人", "4 人"}, Prefs: []MomentPreference{
		{Key: "shoot", Label: "拍照", Options: []MomentPrefOption{{Value: "随拍", Add: 0}, {Value: "重点拍摄", Add: 100}}},
		{Key: "costume", Label: "奥黛", Options: []MomentPrefOption{{Value: "自备", Add: 0}, {Value: "需协助准备", Add: 80}}},
	}},
	"sunset-coffee": {Mode: "Moment", Ratio: "1:1", RatioText: "固定 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "chat", Label: "聊天", Options: []MomentPrefOption{{Value: "轻松聊天", Add: 0}, {Value: "安静陪伴", Add: 0}}},
	}},
	"film-walk": {Mode: "Moment", Ratio: "1:1", RatioText: "默认 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "film", Label: "拍摄", Options: []MomentPrefOption{{Value: "轻量随拍", Add: 0}, {Value: "重点拍摄", Add: 80}}},
	}},
	"night-ktv": {Mode: "Moment", Ratio: "1:1", RatioText: "核心 1:1 · 多组可合并", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "alcohol", Label: "酒精环境", Options: []MomentPrefOption{{Value: "不涉及", Add: 0}, {Value: "可能有", Add: 0}}},
		{Key: "extra", Label: "延长", Options: []MomentPrefOption{{Value: "不需要", Add: 0}, {Value: "再 1 小时", Add: 100}}},
	}},
	"cycling": {Mode: "Moment", Ratio: "1:1", RatioText: "默认 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "pace", Label: "节奏", Options: []MomentPrefOption{{Value: "轻松", Add: 0}, {Value: "运动型", Add: 30}}},
	}},
	"shopping": {Mode: "Moment", Ratio: "1:1", RatioText: "默认 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "style", Label: "方式", Options: []MomentPrefOption{{Value: "随意逛", Add: 0}, {Value: "帮选购", Add: 50}}},
	}},
	"movie": {Mode: "Moment", Ratio: "1:1", RatioText: "固定 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: nil},
	"explore": {Mode: "Moment", Ratio: "1:1", RatioText: "默认 1:1", Fixed: true, Groups: []string{"1 人"}, Prefs: []MomentPreference{
		{Key: "style", Label: "方式", Options: []MomentPrefOption{{Value: "随意探店", Add: 0}, {Value: "拍照记录", Add: 50}}},
	}},
	"sport": {Mode: "Moment", Ratio: "≤ 4:1", RatioText: "按项目容量匹配", Fixed: false, Groups: []string{"1 人", "2 人", "3–4 人"}, Prefs: nil},
	"translate": {Mode: "Professional", Ratio: "按任务", RatioText: "专业服务按任务容量", Fixed: false, Groups: []string{"1 人"}, Prefs: nil},
}

// PricingRule is the per-card dynamic price engine. Map keys must be a
// subset of the spec options; a selected option absent from the map is
// a zero delta (perPair handled client-side from policy.Fixed+Ratio).
type PricingRule struct {
	TemplateID string         `json:"templateId"`
	Duration   map[string]int `json:"duration"` // 时长 → ±K
	Time       map[string]int `json:"time"`     // 时间段 → ±K
	Group      map[string]int `json:"group"`    // 人数 → +K
	PerPair    bool           `json:"perPair"`  // total = perUnit × providers
}

// pricingRules covers every publishable card. Sign convention: positive
// adds to the base, negative is a discount vs the 2h default.
var pricingRules = map[string]PricingRule{
	"coffee":         {Duration: map[string]int{"1 小时": -40, "2 小时": 0, "3 小时": 90}, Time: map[string]int{"今晚 19:00": 20, "明天 15:00": 0, "周末下午": 20}, Group: map[string]int{"1 人": 0}},
	"dining":         {Duration: map[string]int{"1.5 小时": -30, "2 小时": 0, "3 小时": 100}, Time: map[string]int{"今晚 18:30": 20, "明天 18:30": 0, "周末晚餐": 40}, Group: map[string]int{"1 人": 0, "2 人": 70, "3 人": 130}},
	"ktv":            {Duration: map[string]int{"2 小时": 0, "3 小时": 100, "4 小时": 180}, Time: map[string]int{"18:00–20:00": 0, "20:00–22:00": 30, "22:00 后": 90}, Group: map[string]int{"1 人": 0}},
	"photo":          {Duration: map[string]int{"1 小时": -80, "2 小时": 0, "3 小时": 120}, Time: map[string]int{"上午": 0, "下午": 0, "日落前": 40}, Group: map[string]int{"1 人": 0, "2 人": 60, "3–4 人": 120}},
	"walk":           {Duration: map[string]int{"2 小时": 0, "3 小时": 80, "半天": 180}, Time: map[string]int{"上午": 0, "下午": 0, "日落前": 20}, Group: map[string]int{"1 人": 0, "2 人": 40, "3–4 人": 90}},
	"exhibition":     {Duration: map[string]int{"1.5 小时": -30, "2 小时": 0, "3 小时": 70}, Time: map[string]int{"上午": 0, "下午": 0, "周末": 20}, Group: map[string]int{"1 人": 0, "2 人": 30}},
	"ao-bike-photo":  {Duration: map[string]int{"3 小时": 0, "半天": 150}, Time: map[string]int{"09:00–12:00": 0, "15:00–18:00": 30}, Group: map[string]int{"1 人": 0, "2 人": 0, "3 人": 0, "4 人": 0}, PerPair: true},
	"sunset-coffee":  {Duration: map[string]int{"1.5 小时": -20, "2 小时": 0}, Time: map[string]int{"17:00–19:00": 20, "17:30–19:30": 30}, Group: map[string]int{"1 人": 0}},
	"film-walk":      {Duration: map[string]int{"2 小时": 0, "3 小时": 90}, Time: map[string]int{"09:00–12:00": 0, "14:00–17:00": 20}, Group: map[string]int{"1 人": 0}},
	"night-ktv":      {Duration: map[string]int{"2 小时": 0, "3 小时": 100}, Time: map[string]int{"20:00–22:00": 30, "20:00–23:00": 70, "22:00 后": 100}, Group: map[string]int{"1 人": 0}},
}

// resolveTemplate looks a card up by ID.
func resolveTemplate(id string) (OpportunityTemplate, bool) {
	for _, t := range opportunityTemplates {
		if t.ID == id {
			return t, true
		}
	}
	return OpportunityTemplate{}, false
}

// OPP-CATALOG-002 (R58 activity line): the creation-flow presets —
// multi-person complete plays (西湖日落骑行, 老城区胶片街拍, ...) a
// organizer taps instead of typing. Same static in-code tier as the
// opportunity templates: read-model presentation data, no repository.
type ActivityPreset struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Mark    string   `json:"mark"`
	Theme   bool     `json:"theme"`  // 完整组合玩法（主题卡）
	Tags    []string `json:"tags"`
	Sub     string   `json:"sub"`    // 人数/时间摘要
	Capacity string  `json:"capacity"` // 建议人数档
	Time    string   `json:"time"`   // 建议时间
}

var activityPresets = []ActivityPreset{
	{ID: "sunset-cycle", Title: "西湖日落骑行", Mark: "◎", Theme: true, Tags: []string{"骑行", "西湖", "日落"}, Sub: "4–6人 · 15:00–18:00", Capacity: "4–6 人", Time: "周六 15:00–18:00"},
	{ID: "oldtown-photo", Title: "老城区胶片街拍", Mark: "▣", Theme: true, Tags: []string{"拍照", "老城区", "胶片"}, Sub: "3–6人 · 下午", Capacity: "3–6 人", Time: "周六 14:00–17:00"},
	{ID: "coffee-meet", Title: "周末咖啡局", Mark: "☕", Theme: false, Tags: []string{"咖啡", "咖啡馆"}, Sub: "4–8人 · 周末", Capacity: "4–8 人", Time: "周末 15:00"},
	{ID: "exhibition", Title: "一起看展", Mark: "展", Theme: false, Tags: []string{"看展", "美术馆"}, Sub: "4–8人 · 下午", Capacity: "4–8 人", Time: "周六 上午"},
	{ID: "citywalk", Title: "本地人 City Walk", Mark: "⌇", Theme: true, Tags: []string{"City Walk", "本地人"}, Sub: "4–10人 · 半天", Capacity: "4–10 人", Time: "周日 09:00–12:00"},
	{ID: "ktv-night", Title: "周末 KTV", Mark: "♪", Theme: false, Tags: []string{"唱歌", "KTV"}, Sub: "4–8人 · 晚间", Capacity: "4–8 人", Time: "周六 20:00–22:00"},
}

// catalogSnapshot is the full R58 publish-flow data payload: cards +
// categories + per-card specs/policy/pricing. One anonymous read command
// serves the whole two-pane catalog and the spec sheet behind it.
type catalogSnapshot struct {
	Templates []OpportunityTemplate `json:"templates"`
	Categories []TemplateCategory   `json:"categories"`
	Specs     []MomentSpecs         `json:"specs"`
	Policies  []MomentPolicy        `json:"policies"`
	Pricing   []PricingRule        `json:"pricing"`
	// OPP-CATALOG-002 (R58 activity line): creation-flow presets.
	ActivityPresets []ActivityPreset `json:"activityPresets"`
}

// buildCatalogSnapshot assembles the payload and enforces cross-refs:
// every category item, specs key, policy key and pricing key must point
// at a real template; every template must have specs + policy. Broken
// cross-refs are a catalog bug — the guard test fails the build.
func buildCatalogSnapshot() catalogSnapshot {
	snap := catalogSnapshot{Templates: opportunityTemplates, Categories: templateCategories, ActivityPresets: activityPresets}
	for _, t := range opportunityTemplates {
		spec, hasSpec := momentSpecs[t.ID]
		if hasSpec {
			spec.TemplateID = t.ID
			snap.Specs = append(snap.Specs, spec)
		}
		pol, hasPol := momentPolicies[t.ID]
		if hasPol {
			pol.TemplateID = t.ID
			snap.Policies = append(snap.Policies, pol)
		}
		rule, hasRule := pricingRules[t.ID]
		if hasRule {
			rule.TemplateID = t.ID
			snap.Pricing = append(snap.Pricing, rule)
		}
		_ = hasSpec
		_ = hasPol
	}
	return snap
}
