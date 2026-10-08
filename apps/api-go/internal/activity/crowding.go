package activity

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/proxy-app/proxy-api/internal/command"
)

// STORE-CROWD-001（2026-10-08 用户定）：下单时发现这家店这个时段偏满，**提示**建议换其他店 —— 不拦截下单。
//
// 为什么是「估算 + 提示」：我们不知道合作店铺什么时候真的满。一家正常的咖啡店 90 分钟内放得下几十人，
// 按 50 人（≈25 对）算；同一时段往一家店安排 25 对就吵闹拥挤、体验差，而且产品鼓励线下一对一约，
// 几十对挤在一起本身就尴尬。所以到了线只是建议换，用户仍然可以选这家。
//
// 「同一家店同一时段」怎么认：活动的时间在库里只是文字标签（「周六 15:00–17:00」），没有结构化开始时间，
// 所以按「同一个场地（现实场景 id，没有就用场地名）+ 同一个时间标签」算 —— 同一家店同一时段开了
// 两场活动也会加在一起。标签不同但时间重叠的（「周六 15:00」vs「周六 15:00–17:00」）认不出来，会低估；
// 等活动带上结构化开始时间再换成 90 分钟滑动窗口，本文件的输入输出不用动。
const (
	CrowdCapacityPeople = 50
	CrowdWarnPct        = 80
	// 这次下单自己要加进来的人数：For You 一单是「我 + 一位小美」。
	CrowdAddingPeople    = 2
	crowdMaxAlternatives = 3
)

// VenueSlotLoad 是一场活动在「场地 × 时间标签」上的现状（由仓储读出）。
type VenueSlotLoad struct {
	ActivityID string `json:"activityId"`
	Title      string `json:"title"`
	VenueName  string `json:"venueName"`
	SceneID    string `json:"sceneId"`
	TimeLabel  string `json:"timeLabel"`
	Capacity   int    `json:"capacity"` // 0 = 没设名额上限
	Joined     int    `json:"joined"`
	// People 是这场活动里 CONFIRMED 报名的人数（一对 2 人，没有同行人 1 人）。
	People int `json:"people"`
}

func (v VenueSlotLoad) venueKey() string {
	if v.SceneID != "" {
		return "scene:" + v.SceneID
	}
	return "venue:" + strings.ToLower(strings.TrimSpace(v.VenueName))
}

// CrowdAlternative 是一个更空的选择：同一个时间标签、不同的场地。
type CrowdAlternative struct {
	ActivityID string `json:"activityId"`
	Title      string `json:"title"`
	VenueName  string `json:"venueName"`
	TimeLabel  string `json:"timeLabel"`
	LoadPct    int    `json:"loadPct"`
}

// Crowding 是 GetVenueCrowding 的答案。
type Crowding struct {
	ActivityID     string `json:"activityId"`
	VenueName      string `json:"venueName"`
	TimeLabel      string `json:"timeLabel"`
	CapacityPeople int    `json:"capacityPeople"`
	// PeopleNow 是这个场地这个时段现在已经有多少人；Projected 是算上这一单之后。
	PeopleNow int `json:"peopleNow"`
	Projected int `json:"projected"`
	// LoadPct 是 Projected 相对上限的百分比（可以超过 100）。
	LoadPct int `json:"loadPct"`
	// Crowded：算上这一单之后到了「偏满」线（80%）。只是建议换，不拦下单。
	Crowded      bool               `json:"crowded"`
	Alternatives []CrowdAlternative `json:"alternatives"`
	// Estimate 恒为 true：这是估算，不是商家上报的真实承载。界面据此措辞（「可能比较拥挤」）。
	Estimate bool `json:"estimate"`
}

func pct(people int) int { return people * 100 / CrowdCapacityPeople }

// ComputeCrowding 是纯函数：给定同一个时间标签下的所有活动现状，回答目标活动这一单偏不偏满、可换什么。
// all 必须包含目标活动自己；target 不在 all 里 ⇒ 第二个返回值 false（找不到就不乱说）。
func ComputeCrowding(targetID string, all []VenueSlotLoad) (Crowding, bool) {
	var target *VenueSlotLoad
	for i := range all {
		if all[i].ActivityID == targetID {
			target = &all[i]
			break
		}
	}
	if target == nil {
		return Crowding{}, false
	}
	perVenue := map[string]int{}
	for _, v := range all {
		if v.TimeLabel == target.TimeLabel {
			perVenue[v.venueKey()] += v.People
		}
	}
	now := perVenue[target.venueKey()]
	out := Crowding{
		ActivityID: target.ActivityID, VenueName: target.VenueName, TimeLabel: target.TimeLabel,
		CapacityPeople: CrowdCapacityPeople, PeopleNow: now, Projected: now + CrowdAddingPeople,
		Estimate: true, Alternatives: []CrowdAlternative{},
	}
	out.LoadPct = pct(out.Projected)
	out.Crowded = out.LoadPct >= CrowdWarnPct
	if !out.Crowded {
		return out, true // 不偏满就不推荐别的：不拿「换家店」去打扰一个本来没问题的下单
	}
	seen := map[string]bool{target.venueKey(): true}
	var alts []CrowdAlternative
	for _, v := range all {
		if v.TimeLabel != target.TimeLabel || seen[v.venueKey()] || v.ActivityID == target.ActivityID {
			continue
		}
		if v.Capacity > 0 && v.Joined >= v.Capacity {
			continue // 满员的活动不是「更空的选择」
		}
		projected := perVenue[v.venueKey()] + CrowdAddingPeople
		if pct(projected) >= CrowdWarnPct {
			continue // 同样偏满的不推荐
		}
		alts = append(alts, CrowdAlternative{ActivityID: v.ActivityID, Title: v.Title, VenueName: v.VenueName, TimeLabel: v.TimeLabel, LoadPct: pct(projected)})
	}
	sort.SliceStable(alts, func(i, j int) bool {
		if alts[i].LoadPct != alts[j].LoadPct {
			return alts[i].LoadPct < alts[j].LoadPct
		}
		return alts[i].ActivityID < alts[j].ActivityID
	})
	// 同一个场地只推荐一场（它已经按最空的排在前面了）。
	for _, a := range alts {
		key := ""
		for _, v := range all {
			if v.ActivityID == a.ActivityID {
				key = v.venueKey()
			}
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out.Alternatives = append(out.Alternatives, a)
		if len(out.Alternatives) >= crowdMaxAlternatives {
			break
		}
	}
	return out, true
}

// CrowdingReader 由能读场地时段现状的仓储实现（PG 实现；内存仓没有报名人数的概念，不实现 ⇒ 不可用）。
// 可选接口，别的包的测试仓不用跟着改。
type CrowdingReader interface {
	// VenueSlotLoads 返回与 activityID 同一个时间标签的所有活动（含它自己）的现状。
	// activityID 不存在 ⇒ ErrActivityNotFound。
	VenueSlotLoads(ctx context.Context, activityID string) ([]VenueSlotLoad, error)
}

var ErrCrowdingUnsupported = errors.New("venue crowding not supported by repository")

type crowdingPayload struct {
	ActivityID string `json:"activityId"`
}

func (s *Service) getVenueCrowding(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	var p crowdingPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.ActivityID) == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_ID", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_activity_id", nil)
	}
	reader, ok := s.repository.(CrowdingReader)
	if !ok {
		// 没有估算能力（内存模式）：如实说「不可用」，客户端什么都不提示 —— 绝不编一个「不拥挤」。
		return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "UNAVAILABLE", map[string]any{"available": false}, nil)
	}
	loads, err := reader.VenueSlotLoads(ctx, p.ActivityID)
	if errors.Is(err, ErrActivityNotFound) {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ACTIVITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.list_failed", nil)
	}
	crowding, found := ComputeCrowding(p.ActivityID, loads)
	if !found {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "READ", map[string]any{"available": true, "crowding": crowding}, nil)
}
