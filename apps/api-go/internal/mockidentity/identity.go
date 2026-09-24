// Package mockidentity 是 mock 人物身份的**唯一事实源**（IDENTITY-ID-001）。
//
// 背景（实测）：同一个显示名 "Linh" 曾在 4 个地方各自硬编码 ——
//
//	cmd/api/main.go（发布订单候选，randomuser 外链）
//	internal/realityscene/service.go（场景真人，unsplash 外链）
//	internal/facet/service.go（朋友/关系）
//	internal/citycompanion/ internal/localnet/（城市协助作者名）
//
// 于是同一个人在首页和发布订单各显示一张头像，且无法判断是否同一个人。
//
// 规矩（用户要求）：
//   - 身份 = 系统生成的账号 id（不可变、唯一、与显示名解耦）；
//   - 显示名可编辑、可重复（由注册邮箱派生初值），改名字不影响身份；
//   - 头像来自该账号的媒体资产（identity.profiles.avatar_path = assets/<id>）；
//   - 任何 surface 都经本包按 facet 键取身份，**不得**各自硬编码姓名/头像。
package mockidentity

// CreatorFacetKeys 是 mock Creator 的固定 facet 键（种子与各 surface 共用）。
// hana / nam（2026-09-19）：首页真人推荐里的 Hana、Nam 一直用 stock 占位，
// 测试账号在动态里发来两人单人正脸（F组拆分，已验非同一人），转正为真人账户。
var CreatorFacetKeys = []string{"linh", "mai", "an", "thao", "yen", "minh", "trang", "hana", "nam"}

// HomeRailPerson 是首页「真人推荐」rail 上的一个人：facet 键 + 显示名 + 一句话简介。
//
// HOME-RAIL-ACCOUNT-001（2026-09-23）：首页那条 rail 读的是客户端 fixture
// （apps/mobile/src/recommend-fixtures.ts 的 SCENE_RECOMMEND），不是服务端 feed。
// 此前 28 个人里只有 7 个在服务端真有账号，其余 21 个点 + 只会得到一句
// 「还没有账号，暂时加不了好友」—— 而卡片上顶着「真人」徽标；5 个场景
// （ACTIVITY / TRIP / CREATOR / TRANSLATE / MEDICAL）甚至一个真人都没有。
//
// 规矩：造 mock 人物可以，但**造出来的人必须有账号**。账号 id / 显示名 / 写真
// 三件齐，与 rail 卡片一一对应。缺账号的人不是「暂时加不了」，是**不存在** ——
// 把不存在的人放进「真人」列表，是拿列表的标题骗人。
//
// 这份表是 rail 人物的服务端事实源；客户端的 SCENE_RECOMMEND 是同一份数据的
// 展示侧镜像。两边必须一一对应，由 HOME-RAIL-ACCOUNT-001 双向钉住
// （Go 侧读客户端 fixture 逐条比对，客户端侧断言每个人都能解析到账号）。
type HomeRailPerson struct {
	Key  string
	Name string
	Bio  string
}

// HomeRailPeople 是首页 rail 的全部人物（28 人，覆盖 8 个场景）。
// Key 与客户端 fixture 的 `u_<key>` 后缀一致；显示名与简介取卡片上那一句，
// 不再另编（与 seed_creator_portraits.sql 对 trang/hana/nam 的既有口径一致）。
var HomeRailPeople = []HomeRailPerson{
	// PHOTO
	{Key: "linh", Name: "Linh", Bio: "胶片 / 街拍 / 河内老城"},
	{Key: "minh", Name: "Minh", Bio: "Sony A7C / 慢门人像"},
	{Key: "hana", Name: "Hana", Bio: "日系清新 / 自然光"},
	{Key: "nam", Name: "Nam", Bio: "Sony / 夜景 / 城市爬楼"},
	{Key: "vy", Name: "Vy", Bio: "胶片冲洗 / 暗房"},
	{Key: "quynh_anh", Name: "Quỳnh Anh", Bio: "Canon R6 / 婚礼跟拍"},
	{Key: "duy_khang", Name: "Duy Khang", Bio: "Fuji X100V / 旅行"},
	// COMPANION
	{Key: "thao_nhi", Name: "Thảo Nhi", Bio: "西湖 / 还剑湖 散步搭子"},
	{Key: "huy", Name: "Huy", Bio: "咖啡闲聊 / 读书会"},
	{Key: "mai", Name: "Mai", Bio: "奥黛骑行老城"},
	{Key: "an", Name: "An", Bio: "陪看展 / 美术馆"},
	{Key: "khoa", Name: "Khoa", Bio: "夜骑 / 跑步搭子"},
	// COFFEE_MEAL
	{Key: "trang", Name: "Trang", Bio: "Cà phê sữa đá / 河内老店"},
	{Key: "tu", Name: "Tú", Bio: "Pho 24 / Bun Cha 探店"},
	{Key: "nhi", Name: "Nhi", Bio: "Banh Mi + Egg Coffee"},
	// ACTIVITY
	{Key: "long", Name: "Long", Bio: "本周市集 / 周末读书会"},
	{Key: "phuong", Name: "Phương", Bio: "Live House / 独立乐队"},
	{Key: "kien", Name: "Kiên", Bio: "展览 / 当代艺术"},
	// TRIP
	{Key: "my", Name: "My", Bio: "下龙湾一日游搭子"},
	{Key: "duc", Name: "Đức", Bio: "沙坝 / 番西邦徒步"},
	{Key: "ly", Name: "Lý", Bio: "宁平 / 三谷游船"},
	// CREATOR
	{Key: "phuong_thanh", Name: "Phương Thanh", Bio: "独立音乐 / 录音棚"},
	{Key: "hong_anh", Name: "Hồng Anh", Bio: "短视频脚本 / 拍摄"},
	{Key: "son", Name: "Sơn", Bio: "插画 / 写稿"},
	// TRANSLATE
	{Key: "thu_trang", Name: "Thu Trang", Bio: "中越 / 英越 翻译 · 菜单/合同"},
	{Key: "hai", Name: "Hải", Bio: "医院陪同 / 药店代购"},
	{Key: "ngoc", Name: "Ngọc", Bio: "英越同传 · 商务"},
	// MEDICAL
	{Key: "lan", Name: "Lan", Bio: "Bach Mai / K 医院陪同"},
}

// HomeRailFacetKeys 返回首页 rail 人物的 facet 键。
func HomeRailFacetKeys() []string {
	keys := make([]string, 0, len(HomeRailPeople))
	for _, p := range HomeRailPeople {
		keys = append(keys, p.Key)
	}
	return keys
}

// AllFacetKeys 返回全部 mock 人物 facet 键（Creator + rail），去重且保序。
// 身份唯一性的测试按这份表跑，新加一个人就自动被覆盖。
func AllFacetKeys() []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(CreatorFacetKeys)+len(HomeRailPeople))
	all := append(append([]string{}, CreatorFacetKeys...), HomeRailFacetKeys()...)
	for _, key := range all {
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	return out
}

// AccountIDForFacetKey 返回 facet 键对应的系统账号 id。
func AccountIDForFacetKey(key string) string {
	return "user_mockcreator_" + key
}

// AvatarAssetIDForFacetKey 返回该账号头像所在的媒体资产 id。
func AvatarAssetIDForFacetKey(key string) string {
	return "ma_creator_" + key + "_portrait_v1"
}

// PortraitStorageKeyForFacetKey 返回该账号写真在 media store 里的文件名。
// 种子用它判断「字节到底在不在磁盘上」——写 READY 之前必须能 os.Stat 到
// （MEDIA-FILE-001：声称 READY 却没有字节的行，客户端会画成黑圈）。
func PortraitStorageKeyForFacetKey(key string) string {
	return "creator_" + key + "_portrait_v1.jpg"
}

// AvatarPathForFacetKey 返回可直接渲染的服务端头像路径。
// 客户端约定：以 "/" 开头的 photos/头像项按服务端路径处理（拼 API base URL）。
func AvatarPathForFacetKey(key string) string {
	return "/v1/media/thumb/" + AvatarAssetIDForFacetKey(key)
}
