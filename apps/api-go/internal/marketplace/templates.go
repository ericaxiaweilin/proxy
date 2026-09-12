package marketplace

// OpportunityTemplate is a publish-flow catalog entry: a pre-composed
// user-facing scene ("喝咖啡", "奥黛骑行拍照", ...) that a publisher picks
// in one tap instead of typing a free-form demand. The catalog is a
// static in-code constant — it is read-model presentation data, not
// user state, so it needs no repository or migration (same tier as
// SeedDefaults).
//
// OPP-TEMPLATE-001. Each card carries everything the two-step publish
// flow needs:
//   - Group: HOT (one-tap popular), THEME (complete compositions), MORE
//   - Tags: shown as chips on the card + copied into the demand
//   - PriceHint: suggested publish price, Range: reference band the UI
//     shows before the user commits ("参考 150–300K")
//   - Standards: the default service terms card (time / duration /
//     venue style) — the compliance-safe public-place default the
//     operator approved ("公共场所见面 · 2 小时 · 现场消费双方自结").
type OpportunityTemplate struct {
	ID       string   `json:"id"`
	Group    string   `json:"group"` // HOT | THEME | MORE
	Title    string   `json:"title"`
	Sub      string   `json:"sub"`      // card caption (e.g. 咖啡馆)
	Icon     string   `json:"icon"`     // HOT card icon key
	Mark     string   `json:"mark"`     // THEME/MORE card glyph
	Tags     []string `json:"tags"`
	Price    string   `json:"price"`  // suggested publish price
	Range    string   `json:"range"` // reference band, e.g. 150–300K
	Standard string   `json:"standard"` // default service terms note
}

// opportunityTemplates is the full catalog. Prices follow the same VND
// shorthand the market cards use (K = thousand ₫); the mobile publish
// form maps Price/Range onto the existing price fields — the wire
// format of PublishMarketOpportunity does not change.
var opportunityTemplates = []OpportunityTemplate{
	// HOT — one tap, the everyday asks.
	{ID: "coffee", Group: "HOT", Title: "喝咖啡", Sub: "咖啡馆", Icon: "coffee", Tags: []string{"咖啡", "咖啡馆"}, Price: "200K", Range: "150–300K", Standard: "公共咖啡馆见面 · 2 小时 · 现场消费双方自结。"},
	{ID: "dining", Group: "HOT", Title: "吃饭", Sub: "餐厅", Icon: "dining", Tags: []string{"用餐", "餐厅"}, Price: "250K", Range: "200–400K", Standard: "公共餐厅见面 · 2 小时 · 餐饮消费双方自结。"},
	{ID: "ktv", Group: "HOT", Title: "唱歌", Sub: "KTV", Icon: "music", Tags: []string{"唱歌", "KTV"}, Price: "300K", Range: "200–450K", Standard: "正规 KTV / 公开娱乐场所 · 2 小时 · 房费及现场消费双方自结。"},
	{ID: "photo", Group: "HOT", Title: "拍照", Sub: "街拍 / 旅行照", Icon: "photo", Tags: []string{"拍照", "街区"}, Price: "350K", Range: "250–500K", Standard: "公共场景拍摄 · 2 小时 · 默认轻量随拍 · 场地门票（如有）双方自结。"},
	{ID: "walk", Group: "HOT", Title: "City Walk", Sub: "街区漫游", Icon: "walk", Tags: []string{"City Walk", "街区"}, Price: "250K", Range: "180–350K", Standard: "公共路线同行 · 默认 2 小时 · 路线可现场确认。"},
	{ID: "exhibition", Group: "HOT", Title: "看展", Sub: "美术馆", Icon: "exhibition", Tags: []string{"看展", "美术馆"}, Price: "250K", Range: "180–350K", Standard: "公共展馆同行 · 默认 2 小时 · 门票及现场消费双方自结。"},
	// THEME — complete compositions (scene + style + terms).
	{ID: "ao-bike-photo", Group: "THEME", Title: "奥黛骑行拍照", Mark: "衣", Tags: []string{"奥黛", "骑行", "拍照", "老城区"}, Price: "450K", Range: "350–650K", Standard: "公共路线骑行 + 拍照 · 默认 3 小时 · 服装、车辆等费用按实际确认。"},
	{ID: "sunset-coffee", Group: "THEME", Title: "日落咖啡", Mark: "☼", Tags: []string{"日落", "咖啡", "湖边"}, Price: "250K", Range: "180–350K", Standard: "湖边 / 公共咖啡馆 · 2 小时 · 现场消费双方自结。"},
	{ID: "film-walk", Group: "THEME", Title: "胶片 City Walk", Mark: "▣", Tags: []string{"胶片", "City Walk", "老城区"}, Price: "320K", Range: "250–450K", Standard: "公共街区漫游 + 随拍 · 2–3 小时 · 胶片冲扫等耗材费用按实际确认。"},
	{ID: "night-ktv", Group: "THEME", Title: "夜晚 KTV", Mark: "♪", Tags: []string{"夜晚", "唱歌", "KTV"}, Price: "320K", Range: "250–480K", Standard: "正规 KTV / 公开娱乐场所 · 2 小时 · 房费及现场消费双方自结。"},
	// MORE — the long tail, findable via search.
	{ID: "cycling", Group: "MORE", Title: "骑行", Sub: "户外路线", Mark: "🚲", Tags: []string{"骑行", "户外"}, Price: "300K", Range: "220–450K", Standard: "公共骑行路线 · 默认 2 小时 · 车辆租赁等费用按实际确认。"},
	{ID: "shopping", Group: "MORE", Title: "逛街", Sub: "商场 / 街区", Mark: "袋", Tags: []string{"逛街", "商场"}, Price: "250K", Range: "180–350K", Standard: "公共商场或街区 · 默认 2 小时 · 各自购物消费自结。"},
	{ID: "movie", Group: "MORE", Title: "观影", Sub: "影院", Mark: "▶", Tags: []string{"观影", "影院"}, Price: "220K", Range: "150–320K", Standard: "正规影院 · 电影票及现场消费双方自结。"},
	{ID: "explore", Group: "MORE", Title: "探店", Sub: "本地店", Mark: "⌂", Tags: []string{"探店", "本地店"}, Price: "280K", Range: "200–400K", Standard: "公开营业场所 · 默认 2 小时 · 探店消费双方自结。"},
	{ID: "sport", Group: "MORE", Title: "运动", Sub: "运动场", Mark: "◎", Tags: []string{"运动", "运动场"}, Price: "280K", Range: "200–400K", Standard: "正规运动场所 · 默认 2 小时 · 场地费用双方自结。"},
	{ID: "translate", Group: "MORE", Title: "现场翻译", Sub: "商务 / 生活", Mark: "文", Tags: []string{"翻译", "现场"}, Price: "500K", Range: "400–800K", Standard: "按明确场景提供翻译协助 · 默认 2 小时 · 交通门票等现场费用双方自结。"},
}
