package realityscene

import "sort"

// SCENE-BADGE-001：打卡徽章（服务端规则源，与 mobile scene-badges.ts 对齐）。
//
// 打卡不是终点：打卡景点、集类别、留足迹都要有看得见的回报。规则只在这
// 一处定义（纯函数，可单测），CheckInScene 成功后判定并把新获得的徽章
// append-only 落库；客户端只读展示 + 在打卡响应里拿「新获得」提示。
//
// 场景 Type 分类（与 launchScenes 对齐）：
//   湖边：hoankiem / tranquoc / trucbach
//   老城：hoankiem / phunghung / train / longbien
//   经典：hoankiem / longbien / vanmieu / tranquoc
//   咖啡：threebeans / threebeans_bn
//   Xiaomei 绑定：threebeans / trucbach / phunghung / manzi

// SceneBadge 是一个徽章定义。
type SceneBadge struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Desc string `json:"desc"`
	Icon string `json:"icon"`
}

// EarnedBadge 是已获得的徽章（append-only 证据）。
type EarnedBadge struct {
	BadgeID  string `json:"badgeId"`
	EarnedAt string `json:"earnedAt"` // RFC3339
	SceneID  string `json:"sceneId,omitempty"`
}

// SceneBadges 目录（与 mobile 端同序）。
var SceneBadges = []SceneBadge{
	{ID: "first_checkin", Name: "初到打卡", Desc: "在任何场景完成第一次 GPS 打卡。", Icon: "📍"},
	{ID: "checkin_3", Name: "打卡新秀", Desc: "累计在 3 个不同场景打卡。", Icon: "🥉"},
	{ID: "checkin_5", Name: "打卡常客", Desc: "累计在 5 个不同场景打卡。", Icon: "🥈"},
	{ID: "checkin_10", Name: "打卡达人", Desc: "累计在 10 个不同场景打卡。", Icon: "🥇"},
	{ID: "lake_trio", Name: "湖畔三连", Desc: "打卡全部湖边场景（还剑湖、西湖寺畔、竹帛湖）。", Icon: "🌊"},
	{ID: "coffee_hunter", Name: "咖啡猎手", Desc: "打卡全部咖啡场景（Three Beans 河内 + 北宁）。", Icon: "☕"},
	{ID: "oldtown_walk", Name: "老城漫步", Desc: "打卡老城街区（还剑湖、壁画街、火车街、龙编桥）。", Icon: "🏮"},
	{ID: "landmark", Name: "经典打卡", Desc: "打卡一处经典景点（还剑湖 / 龙编桥 / 文庙 / 镇国寺）。", Icon: "🏛️"},
	{ID: "xiaomei_company", Name: "与小美同框", Desc: "在一位小美的绑定场景打卡，她也会常来这里。", Icon: "✨"},
	{ID: "footprint_10", Name: "足迹地图", Desc: "给 10 个不同场景留下足迹。", Icon: "🗺️"},
}

// sceneBadgeRequirements 各集合类徽章要求的场景 id。
var sceneBadgeRequirements = map[string][]string{
	"lake_trio":      {"hoankiem", "tranquoc", "trucbach"},
	"coffee_hunter":  {"threebeans", "threebeans_bn"},
	"oldtown_walk":   {"hoankiem", "phunghung", "train", "longbien"},
	"landmark":       {"hoankiem", "longbien", "vanmieu", "tranquoc"},
	"xiaomei_company": {"threebeans", "trucbach", "phunghung", "manzi"},
}

// EvaluateSceneBadges 判定当前应获得的全部徽章 id（目录顺序）。
func EvaluateSceneBadges(checkedInSceneIds, visitedSceneIds []string) []string {
	checked := make(map[string]bool, len(checkedInSceneIds))
	for _, id := range checkedInSceneIds {
		checked[id] = true
	}
	visited := make(map[string]bool, len(visitedSceneIds))
	for _, id := range visitedSceneIds {
		visited[id] = true
	}
	earned := make(map[string]bool)
	n := len(checked)
	if n >= 1 {
		earned["first_checkin"] = true
	}
	if n >= 3 {
		earned["checkin_3"] = true
	}
	if n >= 5 {
		earned["checkin_5"] = true
	}
	if n >= 10 {
		earned["checkin_10"] = true
	}
	hasAll := func(ids []string) bool {
		for _, id := range ids {
			if !checked[id] {
				return false
			}
		}
		return true
	}
	hasAny := func(ids []string) bool {
		for _, id := range ids {
			if checked[id] {
				return true
			}
		}
		return false
	}
	if hasAll(sceneBadgeRequirements["lake_trio"]) {
		earned["lake_trio"] = true
	}
	if hasAll(sceneBadgeRequirements["coffee_hunter"]) {
		earned["coffee_hunter"] = true
	}
	if hasAll(sceneBadgeRequirements["oldtown_walk"]) {
		earned["oldtown_walk"] = true
	}
	if hasAny(sceneBadgeRequirements["landmark"]) {
		earned["landmark"] = true
	}
	if hasAny(sceneBadgeRequirements["xiaomei_company"]) {
		earned["xiaomei_company"] = true
	}
	if len(visited) >= 10 {
		earned["footprint_10"] = true
	}
	out := make([]string, 0, len(SceneBadges))
	for _, b := range SceneBadges {
		if earned[b.ID] {
			out = append(out, b.ID)
		}
	}
	return out
}

// NewlyEarnedBadges 返回 shouldHave - alreadyEarned（保持目录顺序）。
func NewlyEarnedBadges(shouldHave, alreadyEarned []string) []string {
	have := make(map[string]bool, len(alreadyEarned))
	for _, id := range alreadyEarned {
		have[id] = true
	}
	out := make([]string, 0)
	for _, id := range shouldHave {
		if !have[id] {
			out = append(out, id)
		}
	}
	return out
}

// SortBadgeIDs 稳定排序（便于 diff / 测试断言）。
func SortBadgeIDs(ids []string) []string {
	out := append([]string(nil), ids...)
	sort.Strings(out)
	return out
}
