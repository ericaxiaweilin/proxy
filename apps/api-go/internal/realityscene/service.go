package realityscene

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/mockidentity"
)

type UserState struct {
	SceneID        string     `json:"sceneId"`
	Saved          bool       `json:"saved"`
	Planned        bool       `json:"planned"`
	PrivateVisited bool       `json:"privateVisited"`
	VisitedAt      *time.Time `json:"visitedAt,omitempty"`
}

// SceneSource 标明这条场景的数据是哪来的。
//
// 不许省：目录里 11 条 OSM 的坐标是查过的，用户提交的一条都没查过。混在一起
// 又不标来源，用户就没法判断该不该信 —— 这正是刚删掉的那五个假数字干的事。
type SceneSource string

const (
	SourceOSM       SceneSource = "OSM"       // 坐标/地址来自 OSM(Nominatim) 反查
	SourceCommunity SceneSource = "COMMUNITY" // 用户提交，坐标未经核实
)

// ProposalConfirmationsNeeded 是一条社区提案要几个**其他人**确认才上架。
const ProposalConfirmationsNeeded = 2

// Proposal 是用户提交的一条新场景。上架前它只是提案，不出现在场景目录里。
type Proposal struct {
	ID string `json:"id"`
	// ProposedBy 不出现在 JSON 里：客户端只需要 own/confirmed 两个布尔，
	// 把提交者的 id 发出去等于把"谁在现场/谁提的"这种名单信息开了一个口子。
	ProposedBy  string      `json:"-"`
	Name        string      `json:"name"`
	Area        string      `json:"area"`
	Type        string      `json:"type"`
	Address     string      `json:"address,omitempty"`
	Latitude    float64     `json:"latitude"`
	Longitude   float64     `json:"longitude"`
	Description string      `json:"description,omitempty"`
	Best        string      `json:"best"`
	Status      string      `json:"status"`
	Source      SceneSource `json:"source"`
	// Confirmations 是**除提交者以外**确认过的人数（真数，不是热度）。
	Confirmations int `json:"confirmations"`
	// Own 表示这条是不是当前用户提的 —— 自己不能确认自己的提案。
	Own bool `json:"own"`
	// ConfirmedByMe 表示当前用户已经确认过 —— 决定按钮显示"确认"还是"已确认"。
	Confirmed bool `json:"confirmed"`
	// confirmedBy 是**除提交者外**确认过的人。不进 JSON（名单不对外）。
	confirmedBy []string
}

type Scene struct {
	ID, Name, Area, Type, Best, Description string
	// SCENE-CONTRIB-001: 数据来源（OSM 已核实 / 社区提交未核实）。
	// 客户端必须把它显示出来 —— 不标来源等于默认"已核实"。
	Source SceneSource
	// Address 是门牌/街道级地址，与 Area（区名）是两件事。
	// 可以为空 —— 没记录就不许拿 Area 冒充（SCENE-ADDRESS-001）。
	Address                                                  string `json:"address"`
	Latitude, Longitude, DistanceMeters, RecommendationScore float64
	// SCENE-REAL-COUNTS-001: 这三个是**真实派生**的计数（来自
	// reality.user_scene_states 的聚合），不是写死的常数。
	//
	// SCENE-NO-FABRICATED-001: 这里曾经还有 Quality / Posts / Creators /
	// Activities / Invites 五个 int，全部是迁移 SQL 里手写死的整数 —— 全仓
	// 没有 post↔scene 的关联、没有任何"质量"评分的来源。它们大部分连 UI
	// 都不显示，却拿去算"推荐度"，等于用编的数字决定用户先看到谁。已删除。
	SavedCount, VisitedCount, PlannedCount int
	// SCENE-CHECKIN-001: 当前"在这里"的人数 —— 未过期 check-in 的真聚合数。
	// 没有声明就是 0，不是写死的"热度"。
	HereCount int
	Active    bool
	// ImageURL mirrors heroImageFor so list consumers (home rail) render
	// the same photo as the detail hero without a second fetch (R36.x).
	ImageURL string `json:"imageUrl"`
}

// Detail is the R27 scene read model. A Scene is a time-bound behavior context,
// not another name for a venue. Catalog truth remains in Repository; the
// projections below are replaceable derived data and never create attendance,
// visit, or order evidence.
type Detail struct {
	SceneID         string        `json:"sceneId"`
	VenueID         string        `json:"venueId"`
	VenueName       string        `json:"venueName"`
	HeroImageURL    string        `json:"heroImageUrl"`
	MediaVersion    int           `json:"mediaVersion"`
	SelectedVariant string        `json:"selectedVariant"`
	Variants        []Variant     `json:"variants"`
	LiveState       LiveState     `json:"liveState"`
	Menu            []MenuItem    `json:"menu"`
	FullMenu        []MenuItem    `json:"fullMenu"`
	Humans          []Human       `json:"humans"`
	Actions         []SceneAction `json:"actions"`
	TruthBoundary   string        `json:"truthBoundary"`
}

type Variant struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Window      string   `json:"window"`
	StartMinute int      `json:"-"`
	EndMinute   int      `json:"-"`
	Facets      []string `json:"facets"`
	BestFor     string   `json:"bestFor"`
}

type LiveState struct {
	State       string    `json:"state"`
	Label       string    `json:"label"`
	BestWindow  string    `json:"bestWindow"`
	CapacityPct int       `json:"capacityPct"`
	FreshUntil  time.Time `json:"freshUntil"`
}

type MenuItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	PriceLabel string `json:"priceLabel"`
	SceneFit   string `json:"sceneFit"`
	Available  bool   `json:"available"`
	ImageURL   string `json:"imageUrl"`
}

type Human struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	Availability string `json:"availability"`
	FitReason    string `json:"fitReason"`
	SceneFit     int    `json:"sceneFit"`
	IsAI         bool   `json:"isAI"`
	AvatarURL    string `json:"avatarUrl"`
}

type SceneAction struct {
	Type         string `json:"type"`
	Label        string `json:"label"`
	State        string `json:"state"`
	MoneyMeaning string `json:"moneyMeaning"`
}

func (s Scene) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Area string `json:"area"`
		Type string `json:"type"`
		// SCENE-ADDRESS-001: 这里漏了 address，客户端就永远读不到 ——
		// 结构体上有字段没用，MarshalJSON 才是接口真正的形状。
		Address   string  `json:"address,omitempty"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Best      string  `json:"best"`
		Active    bool    `json:"active"`
		// SCENE-CONTRIB-001: 来源必须跟着场景一起走 —— 客户端靠它区分
		// "查过的" 和 "用户填的"。
		Source              string  `json:"source"`
		Description         string  `json:"description"`
		DistanceMeters      float64 `json:"distanceMeters,omitempty"`
		RecommendationScore float64 `json:"recommendationScore,omitempty"`
		ImageURL            string  `json:"imageUrl,omitempty"`
		// SCENE-REAL-COUNTS-001: 真实派生计数。
		SavedCount   int `json:"savedCount"`
		VisitedCount int `json:"visitedCount"`
		PlannedCount int `json:"plannedCount"`
		// SCENE-CHECKIN-001
		HereCount int `json:"hereCount"`
	}{s.ID, s.Name, s.Area, s.Type, s.Address, s.Latitude, s.Longitude, s.Best, s.Active, string(s.Source), s.Description, s.DistanceMeters, s.RecommendationScore, s.ImageURL, s.SavedCount, s.VisitedCount, s.PlannedCount, s.HereCount})
}

// CheckinTTL 是一次「我在这里」活多久。
//
// 选 90 分钟而不是"直到用户手动取消"：check-in 是一次**现场声明**，人会走。
// 一个永不消失的"我在这里"是假信号 —— 它会让场景永远显示有人，而这正是
// 我们要避免的那种死数据。到期自动作废，不需要用户记得取消。
const CheckinTTL = 90 * time.Minute

type Repository interface {
	ListUserStates(context.Context, string) ([]UserState, error)
	SetUserState(context.Context, string, string, string, bool, time.Time) error
	ListScenes(context.Context) ([]Scene, error)
	ListNearbyScenes(context.Context, float64, float64, float64, int) ([]Scene, error)
	// SCENE-CHECKIN-001
	CheckInScene(context.Context, string, string, *int, time.Time) error
	CancelCheckIn(context.Context, string, string) error
	ListScenePresence(context.Context, time.Time) (map[string]int, error)
	// 本人当前还在有效期内的 check-in（scene id 列表）—— 客户端重开 app 时
	// 要靠它把"我在这里"按钮的选中态恢复回来，不能只靠本地内存。
	ListMyCheckIns(context.Context, string, time.Time) ([]string, error)
	// SCENE-BADGE-001：已获得徽章（append-only）。
	EarnBadge(context.Context, string, EarnedBadge) error
	ListMyEarnedBadges(context.Context, string) ([]EarnedBadge, error)
	// SCENE-CONTRIB-001
	ProposeScene(context.Context, Proposal, time.Time) error
	ConfirmSceneProposal(context.Context, string, string, time.Time) (int, error)
	ListProposals(context.Context, string) ([]Proposal, error)
	// 已上架的社区场景（确认数够了的），作为 Scene 进目录，带 Source=COMMUNITY。
	ListApprovedCommunityScenes(context.Context) ([]Scene, error)
}

// sceneCheckin 是一次现场声明。distanceM 为 nil 表示声明时没有位置
// （未授权或没定位到）—— 声明依然有效，只是没有距离佐证。
type sceneCheckin struct {
	sceneID, actorID string
	expiresAt        time.Time
	distanceM        *int
}

type memoryRepository struct {
	mu        sync.Mutex
	m         map[string]UserState
	scenes    []Scene
	checkins  map[string]sceneCheckin
	proposals []Proposal
	// SCENE-BADGE-001：已获得徽章（append-only，按 actor 存）。
	earnedBadges map[string][]EarnedBadge
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{m: map[string]UserState{}, scenes: launchScenes(), checkins: map[string]sceneCheckin{}, earnedBadges: map[string][]EarnedBadge{}}
}

type proposalNotFound struct{ id string }

func (e *proposalNotFound) Error() string { return "scene proposal not found: " + e.id }

type cannotConfirmOwnProposal struct{ id string }

func (e *cannotConfirmOwnProposal) Error() string {
	return "cannot confirm your own scene proposal: " + e.id
}
func (r *memoryRepository) ListUserStates(_ context.Context, actorID string) ([]UserState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []UserState{}
	for key, state := range r.m {
		if len(key) > len(actorID) && key[:len(actorID)+1] == actorID+"|" {
			out = append(out, state)
		}
	}
	return out, nil
}
func (r *memoryRepository) SetUserState(_ context.Context, actorID, sceneID, field string, enabled bool, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := actorID + "|" + sceneID
	state := r.m[key]
	state.SceneID = sceneID
	switch field {
	case "saved":
		state.Saved = enabled
	case "planned":
		state.Planned = enabled
	case "private_visited":
		state.PrivateVisited = enabled
		if enabled {
			visitedAt := now.UTC()
			state.VisitedAt = &visitedAt
		} else {
			state.VisitedAt = nil
		}
	}
	r.m[key] = state
	return nil
}

func (r *memoryRepository) CheckInScene(_ context.Context, actorID, sceneID string, distanceM *int, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.checkins[sceneID+"|"+actorID] = sceneCheckin{sceneID: sceneID, actorID: actorID, expiresAt: now.UTC().Add(CheckinTTL), distanceM: distanceM}
	return nil
}
func (r *memoryRepository) CancelCheckIn(_ context.Context, actorID, sceneID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.checkins, sceneID+"|"+actorID)
	return nil
}
func (r *memoryRepository) ListScenePresence(_ context.Context, now time.Time) (map[string]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int{}
	for _, c := range r.checkins {
		if c.expiresAt.After(now.UTC()) {
			out[c.sceneID]++
		}
	}
	return out, nil
}
func (r *memoryRepository) ListMyCheckIns(_ context.Context, actorID string, now time.Time) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []string{}
	for _, c := range r.checkins {
		if c.actorID == actorID && c.expiresAt.After(now.UTC()) {
			out = append(out, c.sceneID)
		}
	}
	return out, nil
}

// SCENE-CONTRIB-001: 社区提交 + 确认。
//
// 提交者不能确认自己的提案 —— 这条规则放在**服务层**（HandleContext）拒绝，
// 不放这里：这里只负责存。放在存储层只会变成"写进去了但查询时要记得过滤"，
// 那种约束早晚会有人忘记。
func (r *memoryRepository) EarnBadge(_ context.Context, actorID string, badge EarnedBadge) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.earnedBadges[actorID] = append(r.earnedBadges[actorID], badge)
	return nil
}

func (r *memoryRepository) ListMyEarnedBadges(_ context.Context, actorID string) ([]EarnedBadge, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]EarnedBadge(nil), r.earnedBadges[actorID]...), nil
}

func (r *memoryRepository) ProposeScene(_ context.Context, p Proposal, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.proposals {
		if existing.ID == p.ID {
			return nil
		}
	}
	if p.Best == "" {
		p.Best = "以现场公告为准"
	}
	p.Status, p.Source = "PENDING", SourceCommunity
	p.Confirmations, p.Own, p.Confirmed = 0, false, false
	_ = now
	r.proposals = append(r.proposals, p)
	return nil
}
func (r *memoryRepository) ConfirmSceneProposal(_ context.Context, proposalID, actorID string, _ time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.proposals {
		if r.proposals[i].ID != proposalID {
			continue
		}
		if r.proposals[i].ProposedBy == actorID {
			return 0, &cannotConfirmOwnProposal{id: proposalID}
		}
		for _, who := range r.proposals[i].confirmedBy {
			if who == actorID {
				return r.proposals[i].Confirmations, nil // 已经确认过，幂等
			}
		}
		r.proposals[i].confirmedBy = append(r.proposals[i].confirmedBy, actorID)
		r.proposals[i].Confirmations = len(r.proposals[i].confirmedBy)
		if r.proposals[i].Confirmations >= ProposalConfirmationsNeeded {
			r.proposals[i].Status = "APPROVED"
		}
		return r.proposals[i].Confirmations, nil
	}
	return 0, &proposalNotFound{id: proposalID}
}
func (r *memoryRepository) ListProposals(_ context.Context, actorID string) ([]Proposal, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Proposal{}
	for _, p := range r.proposals {
		view := p
		view.Own = p.ProposedBy == actorID
		view.Confirmed = false
		for _, who := range p.confirmedBy {
			if who == actorID {
				view.Confirmed = true
			}
		}
		if view.Best == "" {
			view.Best = "以现场公告为准"
		}
		out = append(out, view)
	}
	return out, nil
}
func (r *memoryRepository) ListApprovedCommunityScenes(_ context.Context) ([]Scene, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Scene{}
	for _, p := range r.proposals {
		if p.Status != "APPROVED" {
			continue
		}
		out = append(out, Scene{
			ID: p.ID, Name: p.Name, Area: p.Area, Type: p.Type, Address: p.Address,
			Latitude: p.Latitude, Longitude: p.Longitude, Best: p.Best, Active: false,
			Description: p.Description, Source: SourceCommunity,
		})
	}
	return out, nil
}

// applyUserCounts 按 reality.user_scene_states 真算三个计数。r.m 的 key 是
// "actorID|sceneID"，所以按 sceneID 分桶。
//
// ListScenes 和 ListNearbyScenes **都要**调：Postgres 版是在同一条 SQL 里
// JOIN tally 算的，内存版以前只在 ListScenes 里算，nearby 拿到的永远是 0 ——
// 于是"推荐度"在两条路径上算出来的不是同一个数。
func (r *memoryRepository) applyUserCounts(scenes []Scene) {
	saved, visited, planned := map[string]int{}, map[string]int{}, map[string]int{}
	for _, state := range r.m {
		if state.Saved {
			saved[state.SceneID]++
		}
		if state.PrivateVisited {
			visited[state.SceneID]++
		}
		if state.Planned {
			planned[state.SceneID]++
		}
	}
	for i := range scenes {
		scenes[i].SavedCount = saved[scenes[i].ID]
		scenes[i].VisitedCount = visited[scenes[i].ID]
		scenes[i].PlannedCount = planned[scenes[i].ID]
	}
}
func (r *memoryRepository) ListScenes(_ context.Context) ([]Scene, error) {
	out := append([]Scene(nil), r.scenes...)
	// SCENE-REAL-COUNTS-001: 计数按 user_scene_states 真算，不是常数。
	r.applyUserCounts(out)
	return out, nil
}
func (r *memoryRepository) ListNearbyScenes(_ context.Context, lat, lng, radiusKM float64, limit int) ([]Scene, error) {
	out := make([]Scene, 0, len(r.scenes))
	for _, scene := range r.scenes {
		scene.DistanceMeters = haversineMeters(lat, lng, scene.Latitude, scene.Longitude)
		if scene.DistanceMeters <= radiusKM*1000 {
			out = append(out, scene)
		}
	}
	// 先算真计数，再算推荐度 —— 顺序反了推荐度就永远按 0 算。
	r.applyUserCounts(out)
	for i := range out {
		out[i].RecommendationScore = recommendationScore(out[i])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RecommendationScore == out[j].RecommendationScore {
			return out[i].DistanceMeters < out[j].DistanceMeters
		}
		return out[i].RecommendationScore > out[j].RecommendationScore
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func haversineMeters(aLat, aLng, bLat, bLng float64) float64 {
	const earth = 6371000.0
	p1, p2 := aLat*math.Pi/180, bLat*math.Pi/180
	dp := (bLat - aLat) * math.Pi / 180
	dl := (bLng - aLng) * math.Pi / 180
	h := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return earth * 2 * math.Atan2(math.Sqrt(h), math.Sqrt(1-h))
}

// SCENE-NO-FABRICATED-001: 推荐度只用**真实信号** —— 用户自己的行为计数
// （收藏/去过/计划去）+ 距离。
//
// 改之前是 `quality*0.55 + log1p(posts + 2*creators + 4*activities + 2*invites)*8
// - 距离`：那五个整数全是迁移里手写死的常数，全仓没有任何来源。一个从没
// 有人去过的场景因为 seed 里 posts=312 就能排在有人收藏的场景前面 —— 这是
// 用编的数字决定用户先看到谁。
//
// 现在没人动过就是 0，排序退回"按距离近的在前"，这是诚实的默认值。
func recommendationScore(s Scene) float64 {
	engagement := float64(s.SavedCount + 2*s.VisitedCount + 2*s.PlannedCount)
	return math.Log1p(engagement)*8.0 - (s.DistanceMeters/1000)*2.5
}

// launchScenes 是**没有配数据库**时的内存目录。它必须和迁移里的
// reality.scenes seed 保持一致 —— TestSceneSeedMatchesMigrationSeed 会钉住
// 两边 id 集合，不一致直接红。
//
// SCENE-NO-FABRICATED-001 的两条硬规则：
//  1. 目录里只放**真实存在的地点**。坐标与地址以 OSM(Nominatim) 反查为准，
//     不是估的。以前目录里的 complex01 / banana / bonsaidon 是本 app 自有的
//     演示场所（搜不到任何公开记录），westlake 是"环湖路线"不是一个点 ——
//     它们已在迁移里置为 HIDDEN，不再出现在这里。
//  2. 目录里**没有任何"热度/质量/人数"常数**。开放时间查不到就写
//     「以现场公告为准」，不编一个看着专业的时间段。
func launchScenes() []Scene {
	scenes := []Scene{
		// ——— 河内 · 公共景点（户外、无门禁）———
		{ID: "hoankiem", Name: "Hồ Hoàn Kiếm", Area: "Hoàn Kiếm", Type: "公共景点 · 湖边", Address: "Hồ Hoàn Kiếm, Phường Hoàn Kiếm, Hà Nội", Latitude: 21.0288313, Longitude: 105.8525357, Best: "全天开放", Active: true, Description: "河内老城中心的公共湖景：清晨太极与跑步、白天环湖、周末步行街。"},
		{ID: "trucbach", Name: "Hồ Trúc Bạch", Area: "Ba Đình", Type: "公共景点 · 湖边", Address: "Hồ Trúc Bạch, Phường Ba Đình, Hà Nội", Latitude: 21.0463247, Longitude: 105.8384008, Best: "全天开放", Active: true, Description: "老城边的小型湖，环湖步道适合散步和傍晚停留。"},
		{ID: "phunghung", Name: "Phùng Hưng Mural Street", Area: "Hoàn Kiếm", Type: "公共景点 · 街区", Address: "Phố Phùng Hưng, Phố Cổ, Hoàn Kiếm, Hà Nội", Latitude: 21.0360490, Longitude: 105.8460019, Best: "全天开放", Active: true, Description: "老城骑楼下的壁画街，适合街拍和散步。"},
		{ID: "longbien", Name: "Cầu Long Biên", Area: "Hồng Hà", Type: "公共景点 · 桥", Address: "Cầu Long Biên, Phường Hồng Hà, Hà Nội", Latitude: 21.0431405, Longitude: 105.8581747, Best: "全天开放", Active: true, Description: "横跨红河的百年铁桥，步行道可过河，日落与火车经过时人最多。"},
		// ——— 河内 · 有门禁 / 按场次开放（Active=false：详情页显示"近期适合"）———
		// train street 经常因管制封闭，能否进要看当天通告 —— 这不是我们该猜的。
		{ID: "train", Name: "Hanoi Train Street", Area: "Hoàn Kiếm", Type: "公共景点 · 街区", Address: "Hanoi Train Street, Phố Hà Trung, Phố Cổ, Hoàn Kiếm, Hà Nội", Latitude: 21.0295823, Longitude: 105.8433206, Best: "以现场公告为准", Active: false, Description: "贴着居民区的铁路窄巷，能否进入取决于当日管制通告。"},
		{ID: "vanmieu", Name: "Văn Miếu – Quốc Tử Giám", Area: "Văn Miếu", Type: "公共景点 · 古迹", Address: "Văn Miếu - Quốc Tử Giám, Hà Nội", Latitude: 21.0287903, Longitude: 105.8359533, Best: "08:00–17:00 · 售票", Active: false, Description: "越南第一所国子监，售票参观的老城古迹。"},
		{ID: "tranquoc", Name: "Chùa Trấn Quốc · Hồ Tây", Area: "Tây Hồ", Type: "公共景点 · 寺庙", Address: "Chùa Trấn Quốc, Đường Thanh Niên, Yên Phụ, Tây Hồ, Hà Nội", Latitude: 21.0478837, Longitude: 105.8368375, Best: "以现场公告为准", Active: false, Description: "西湖东岸半岛上的古寺，是西湖日落最常去的观景点。"},
		{ID: "manzi", Name: "Manzi Art Space", Area: "Ba Đình", Type: "艺术 · 展览", Address: "14 Phan Huy Ích, Ba Đình, Hà Nội", Latitude: 21.0414885, Longitude: 105.8455896, Best: "以现场公告为准", Active: false, Description: "老别墅改的独立展览空间，按展期开放。"},
		// ——— 商家：Three Beans（有照片、有菜单，是本 app 目前唯一的真实商家）———
		{ID: "threebeans", Name: "Three Beans · Cầu Giấy", Area: "Cầu Giấy", Type: "咖啡 · 动态场景", Address: "Đường Cầu Giấy, Dịch Vọng, Cầu Giấy, Hà Nội", Latitude: 21.0359, Longitude: 105.7906, Best: "以门店公告为准", Active: true, Description: "同一门店按时间切换咖啡、出片、下班社交与周末活动场景。"},
		// SCENE-ADDRESS-001: 目录里第一条非河内场景。Bắc Ninh 用户此前打
		// 开场景地图一个场景都搜不到（nearby 半径内没有任何记录）。
		// 坐标 21.1861,106.0707 反查得到 Suối Hoa, TP Bắc Ninh —— 与仓库
		// 自己的反查夹具（geocode_test.go）解析结果一致。
		{ID: "threebeans_bn", Name: "Three Beans · Bắc Ninh", Area: "Bắc Ninh", Type: "咖啡 · 动态场景", Address: "Lê Văn Thịnh, Suối Hoa, TP Bắc Ninh", Latitude: 21.1861, Longitude: 106.0707, Best: "以门店公告为准", Active: true, Description: "Bắc Ninh 市中心的咖啡场景：早班咖啡、下午办公与周末小型活动。"},
		// Nominatim: Nguyen Phi Y Lan Park, Kinh Bac Ward, Bắc Ninh City
		// 21.1861461,106.0742127 —— 与 threebeans_bn 相距约 350 m，两个场景
		// 同时落在 Bắc Ninh 市中心步行范围内。
		{ID: "nguyenphilan", Name: "Công viên Nguyên Phi Ỷ Lan", Area: "Bắc Ninh", Type: "公共景点 · 公园", Address: "Công viên Nguyên Phi Ỷ Lan, Phường Kinh Bắc, TP Bắc Ninh", Latitude: 21.1861461, Longitude: 106.0742127, Best: "全天开放", Active: true, Description: "Bắc Ninh 市中心的公共公园，傍晚人最多。"},
	}
	// 这张表里的每一条坐标/地址都是查过的 —— 统一标 OSM，而不是留空让客户端
	// 猜。用户提交的场景走另一条路（Source=COMMUNITY），不会混进这张表。
	for i := range scenes {
		scenes[i].Source = SourceOSM
	}
	return scenes
}

type Service struct{ repo Repository }

func New() *Service { return NewWithRepository(newMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = newMemoryRepository()
	}
	return &Service{repo: repo}
}
func (s *Service) ListScenes(ctx context.Context) ([]Scene, error) {
	scenes, err := s.repo.ListScenes(ctx)
	if err != nil {
		return nil, err
	}
	// SCENE-CONTRIB-001: 确认数够了的社区提案进目录。它们带 Source=COMMUNITY，
	// 客户端必须标出来 —— 不标就是拿"用户填的"冒充"查过的"。
	community, err := s.repo.ListApprovedCommunityScenes(ctx)
	if err != nil {
		return nil, err
	}
	scenes = append(scenes, community...)
	scenes, err = s.withPresence(ctx, scenes)
	if err != nil {
		return nil, err
	}
	return withSceneImages(scenes), nil
}
func (s *Service) ListNearbyScenes(ctx context.Context, lat, lng, radiusKM float64, limit int) ([]Scene, error) {
	scenes, err := s.repo.ListNearbyScenes(ctx, lat, lng, radiusKM, limit)
	if err != nil {
		return nil, err
	}
	scenes, err = s.withPresence(ctx, scenes)
	if err != nil {
		return nil, err
	}
	return withSceneImages(scenes), nil
}

// withPresence 填 HereCount —— 未过期 check-in 的真聚合数。
//
// SCENE-CHECKIN-001: 这是目录里唯一**会自己变化**的数字：人走了它就掉。
// 取不到在场数据就如实报错，不填 0 蒙过去 —— "没人在这里" 和 "不知道有没有人
// 在这里" 是两件不同的事，不许互相冒充。
func (s *Service) withPresence(ctx context.Context, scenes []Scene) ([]Scene, error) {
	presence, err := s.repo.ListScenePresence(ctx, time.Now())
	if err != nil {
		return nil, err
	}
	for i := range scenes {
		scenes[i].HereCount = presence[scenes[i].ID]
	}
	return scenes, nil
}

func withSceneImages(scenes []Scene) []Scene {
	for i := range scenes {
		if scenes[i].ImageURL == "" {
			scenes[i].ImageURL = heroImageFor(scenes[i].ID)
		}
	}
	return scenes
}

func (s *Service) GetDetail(ctx context.Context, sceneID, requestedVariant string, now time.Time) (Detail, bool, error) {
	scenes, err := s.repo.ListScenes(ctx)
	if err != nil {
		return Detail{}, false, err
	}
	var scene Scene
	found := false
	for _, candidate := range scenes {
		if candidate.ID == sceneID {
			scene, found = candidate, true
			break
		}
	}
	if !found {
		return Detail{}, false, nil
	}
	variants := variantsFor(scene)
	selected := variants[0]
	minute := now.Hour()*60 + now.Minute()
	for _, candidate := range variants {
		if requestedVariant == candidate.ID || (requestedVariant == "" && minute >= candidate.StartMinute && minute < candidate.EndMinute) {
			selected = candidate
			break
		}
	}
	state := "GOOD_SOON"
	label := "近期适合"
	if minute >= selected.StartMinute && minute < selected.EndMinute {
		state, label = "AVAILABLE_NOW", "现在适合"
	}
	if !scene.Active && state == "AVAILABLE_NOW" {
		state, label = "GOOD_SOON", "近期适合"
	}
	return Detail{
		SceneID: scene.ID, VenueID: venueIDFor(scene), VenueName: scene.Name,
		HeroImageURL: heroImageFor(scene.ID), MediaVersion: 1,
		SelectedVariant: selected.ID, Variants: variants,
		LiveState: LiveState{State: state, Label: label, BestWindow: selected.Window, CapacityPct: capacityFor(selected.ID, minute), FreshUntil: now.UTC().Add(5 * time.Minute)},
		Menu:      menuFor(selected.ID), FullMenu: fullMenu(), Humans: humansFor(selected.ID),
		Actions: []SceneAction{
			{Type: "DIRECT_INVITE", Label: "邀请真人", State: "REQUIRES_HUMAN_ACCEPTANCE", MoneyMeaning: "费用约定，不代表已付款或收入"},
			{Type: "OPEN_TASK", Label: "发布机会", State: "ACCEPTS_APPLICATIONS", MoneyMeaning: "标价是完成任务可获得的报酬"},
			{Type: "PUBLIC_ACTIVITY", Label: "报名活动", State: "REGISTRATION_ONLY", MoneyMeaning: "价格是参与者需支付的报名或消费费用"},
		},
		TruthBoundary: "推荐不预订真人；报名不等于到场；AI 预览不产生到访、出席或订单证据。",
	}, true, nil
}

func heroImageFor(sceneID string) string {
	if sceneID == "threebeans" {
		return "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=86"
	}
	return "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=86"
}

func venueIDFor(scene Scene) string {
	if scene.ID == "threebeans" {
		return "venue_threebeans_caugiay"
	}
	return "venue_" + scene.ID
}
func variantsFor(scene Scene) []Variant {
	if scene.ID == "threebeans" {
		return []Variant{
			{ID: "morning", Name: "Morning Coffee", Window: "07:30–10:30", StartMinute: 450, EndMinute: 630, Facets: []string{"安静", "快速", "一起办公"}, BestFor: "快速咖啡、独处办公、通勤前碰面"},
			{ID: "sunlight", Name: "Sunlight Coffee", Window: "14:00–17:00", StartMinute: 840, EndMinute: 1020, Facets: []string{"自然光", "出片", "轻社交"}, BestFor: "喝咖啡、拍照、第一次见面"},
			{ID: "afterwork", Name: "Afterwork Coffee", Window: "17:30–20:30", StartMinute: 1050, EndMinute: 1230, Facets: []string{"下班后", "聊天", "轻约会"}, BestFor: "双人到四人的轻社交"},
			{ID: "weekend", Name: "Weekend Social", Window: "周末 14:00–19:00", StartMinute: 840, EndMinute: 1140, Facets: []string{"多人局", "活动", "Creator"}, BestFor: "公开活动和认识新朋友"},
		}
	}
	return []Variant{{ID: "best-time", Name: scene.Type, Window: scene.Best, StartMinute: 0, EndMinute: 1440, Facets: []string{scene.Type}, BestFor: scene.Description}}
}
func capacityFor(variant string, minute int) int {
	base := map[string]int{"morning": 61, "sunlight": 39, "afterwork": 74, "weekend": 81}[variant]
	if base == 0 {
		base = 52
	}
	if minute%60 > 45 {
		base += 4
	}
	return base
}
func menuFor(variant string) []MenuItem {
	all := fullMenu()
	items := []MenuItem{all[0], all[1]}
	if variant == "afterwork" {
		items = []MenuItem{all[2], all[1]}
	}
	if variant == "weekend" {
		items = append(items, all[3])
	}
	return items
}

func fullMenu() []MenuItem {
	return []MenuItem{
		{ID: "sku_corn_coffee", Name: "Cafe Kem Bắp", PriceLabel: "45K+", SceneFit: "高 UGC Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=520&q=84"},
		{ID: "sku_matcha", Name: "Matcha Latte", PriceLabel: "50K", SceneFit: "高出片 Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=520&q=84"},
		{ID: "sku_passion", Name: "Passion Guava", PriceLabel: "45K", SceneFit: "Afterwork Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&w=520&q=84"},
		{ID: "sku_popcorn", Name: "Bắp Rang Bơ", PriceLabel: "55K", SceneFit: "多人分享", Available: true, ImageURL: "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=520&q=84"},
	}
}
func humansFor(variant string) []Human {
	role := "Cafe / Lifestyle"
	availability := "本周可约"
	if variant == "morning" {
		role, availability = "Coffee / Work", "上午可约"
	}
	if variant == "weekend" {
		role, availability = "Host / Lifestyle", "周末可约"
	}
	return []Human{{ID: "creator_mai", Name: "Mai", Role: role, Availability: availability, FitReason: "同类 Scene 有真实完成记录", SceneFit: 96, IsAI: false, AvatarURL: mockidentity.AvatarPathForFacetKey("mai")}, {ID: "creator_linh", Name: "Linh", Role: "Photo / Lifestyle", Availability: "近期可约", FitReason: "出片与到访转化稳定", SceneFit: 92, IsAI: false, AvatarURL: mockidentity.AvatarPathForFacetKey("linh")}, {ID: "creator_trang", Name: "Trang", Role: "Food / UGC", Availability: "周末可约", FitReason: "相关 SKU 内容经验", SceneFit: 88, IsAI: false, AvatarURL: mockidentity.AvatarPathForFacetKey("trang")}}
}
func (s *Service) Supports(t string) bool {
	return t == "ListMyBadges" || t == "ListMyRealitySceneState" || t == "SetRealitySceneSaved" || t == "SetRealityScenePlanned" || t == "SetPrivateRealitySceneVisited" || t == "SetRealitySceneCheckIn" || t == "ProposeRealityScene" || t == "ConfirmRealitySceneProposal" || t == "ListRealitySceneProposals"
}
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "REALITY_SCENE_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_REAUTH", "reality_scene.actor_required", nil)
	}
	// OPENAPI-COMMAND-COVERAGE-001: 命令一律用 `case "X":` 分派，不要用
	// `if e.CommandType == "X"` 或 map 查表。openapi.commands.generated.yaml
	// 是**扫 `case "X"` 行**生成的（internal/openapicmds），这两种写法命令
	// 照样 dispatch、测试照样绿，却永远不会出现在契约里 —— 而漂移检查比对的是
	// 「重新生成 vs 已提交」，两边缺的是同一条，所以它也是绿的。
	//
	// SCENE-CONTRIB-001: 社区提交 / 确认 / 列表，以及本人状态清单。
	// 这几个命令不操作"某个已存在的场景"，所以必须排在下面那段
	// "先取 sceneId 再分派" 的通用逻辑之前。
	switch e.CommandType {
	case "ProposeRealityScene":
		return s.proposeScene(ctx, e)
	case "ConfirmRealitySceneProposal":
		return s.confirmProposal(ctx, e)
	case "ListRealitySceneProposals":
		return s.listProposals(ctx, e)
	case "ListMyBadges":
		return s.listMyBadges(ctx, e)
	case "ListMyRealitySceneState":
		return s.listMyState(ctx, e)
	}
	sceneID, _ := e.Payload["sceneId"].(string)
	enabled, ok := e.Payload["enabled"].(bool)
	if sceneID == "" || !ok {
		return command.Rejected(e, "REALITY_SCENE_INPUT_INVALID", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.input_invalid", nil)
	}
	switch e.CommandType {
	// SCENE-CHECKIN-001: 「我在这里」—— 有时间窗的现场声明。
	//
	// 必须排在下面那三个「命令→user_scene_states 某一列」的 case **之前**：
	// 这个命令不对应任何一列，掉下去只会返回 command_unsupported。
	//
	// distanceMeters 是**可选**的：没授权定位 / 没定位到时不带，声明照样成立，
	// 只是没有距离佐证。我们不会反过来因为没有位置就拒绝 —— 但也绝不因此
	// 声称"已核实本人在场"。
	case "SetRealitySceneCheckIn":
		return s.setCheckIn(ctx, e, sceneID, enabled)
	case "SetRealitySceneSaved":
		return s.setUserStateField(ctx, e, sceneID, "saved", enabled)
	case "SetRealityScenePlanned":
		return s.setUserStateField(ctx, e, sceneID, "planned", enabled)
	case "SetPrivateRealitySceneVisited":
		return s.setUserStateField(ctx, e, sceneID, "private_visited", enabled)
	}
	return command.Rejected(e, "REALITY_SCENE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.command_unsupported", nil)
}

// listMyBadges 回本人已获得的全部徽章（按获得时间序）。
func (s *Service) listMyBadges(ctx context.Context, e command.Envelope) command.Result {
	badges, err := s.repo.ListMyEarnedBadges(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "REALITY_SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.read_failed", nil)
	}
	// 目录一并带回去，客户端不用内置一份 —— 改名/换图标在服务端改。
	cat := make([]SceneBadge, len(SceneBadges))
	copy(cat, SceneBadges)
	r := command.Accepted(e, "RealitySceneBadgeCollection", e.Actor.ID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"badges": badges, "catalog": cat})
	r.OperationRef = string(raw)
	return r
}

// listMyState 回本人对每个场景的 saved / planned / private_visited 状态。
func (s *Service) listMyState(ctx context.Context, e command.Envelope) command.Result {
	states, err := s.repo.ListUserStates(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "REALITY_SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.read_failed", nil)
	}
	// SCENE-CHECKIN-001: 一并把本人还在有效期内的 check-in 带回去，客户端
	// 重开 app 时才知道按钮该显示"我在这里"还是"✓ 在这里"。
	checkIns, err := s.repo.ListMyCheckIns(ctx, e.Actor.ID, time.Now())
	if err != nil {
		return command.Rejected(e, "REALITY_SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.read_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneStateCollection", e.Actor.ID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"states": states, "checkIns": checkIns})
	r.OperationRef = string(raw)
	return r
}

// setCheckIn 处理「我在这里」的开启与取消。
func (s *Service) setCheckIn(ctx context.Context, e command.Envelope, sceneID string, enabled bool) command.Result {
	var distance *int
	if raw, ok := e.Payload["distanceMeters"].(float64); ok && raw >= 0 {
		metres := int(raw)
		distance = &metres
	}
	if !enabled {
		if err := s.repo.CancelCheckIn(ctx, e.Actor.ID, sceneID); err != nil {
			return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
		}
		return s.checkInResult(e, sceneID, false, nil, nil)
	}
	if err := s.repo.CheckInScene(ctx, e.Actor.ID, sceneID, distance, time.Now()); err != nil {
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	// SCENE-BADGE-001：打卡成功后按规则判定徽章，新获得的 append-only 记录，
	// 并随响应返回给客户端（打卡页弹「恭喜获得徽章」）。
	newly := s.evaluateAndEarnBadges(ctx, e.Actor.ID, sceneID)
	return s.checkInResult(e, sceneID, true, distance, newly)
}

// setUserStateField 处理 saved / planned / private_visited 三个布尔列。
func (s *Service) setUserStateField(ctx context.Context, e command.Envelope, sceneID string, field string, enabled bool) command.Result {
	if err := s.repo.SetUserState(ctx, e.Actor.ID, sceneID, field, enabled, time.Now()); err != nil {
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneUserState", sceneID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"sceneId": sceneID, "field": field, "enabled": enabled})
	r.OperationRef = string(raw)
	return r
}

// proposeScene 处理「提交一个新场景」。
//
// 坐标是**用户填的**，我们没有反查、也没有核实 —— 所以提交进来一律是
// PENDING + Source=COMMUNITY，要等别人确认才上架。
func (s *Service) proposeScene(ctx context.Context, e command.Envelope) command.Result {
	name, _ := e.Payload["name"].(string)
	area, _ := e.Payload["area"].(string)
	sceneType, _ := e.Payload["type"].(string)
	lat, latOK := e.Payload["latitude"].(float64)
	lng, lngOK := e.Payload["longitude"].(float64)
	if name == "" || area == "" || sceneType == "" || !latOK || !lngOK ||
		lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return command.Rejected(e, "REALITY_SCENE_INPUT_INVALID", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.input_invalid", nil)
	}
	address, _ := e.Payload["address"].(string)
	description, _ := e.Payload["description"].(string)
	best, _ := e.Payload["best"].(string)
	if best == "" {
		// 提交者不知道开放时间就写"以现场公告为准"，不替他编一个。
		best = "以现场公告为准"
	}
	proposal := Proposal{
		ID: "scn_" + proposalIDFor(e.Actor.ID, name, lat, lng), ProposedBy: e.Actor.ID,
		Name: name, Area: area, Type: sceneType, Address: address,
		Latitude: lat, Longitude: lng, Description: description, Best: best,
	}
	if err := s.repo.ProposeScene(ctx, proposal, time.Now()); err != nil {
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneProposal", proposal.ID, 1, "PENDING", nil)
	raw, _ := json.Marshal(map[string]any{
		"proposalId": proposal.ID, "status": "PENDING", "source": SourceCommunity,
		"confirmationsNeeded": ProposalConfirmationsNeeded,
		"note":                "社区提交，坐标未经核实；需要 " + strconv.Itoa(ProposalConfirmationsNeeded) + " 位其他用户确认后才会进入场景目录。",
	})
	r.OperationRef = string(raw)
	return r
}

// confirmProposal 处理「确认这个场景真的存在」。
func (s *Service) confirmProposal(ctx context.Context, e command.Envelope) command.Result {
	proposalID, _ := e.Payload["proposalId"].(string)
	if proposalID == "" {
		return command.Rejected(e, "REALITY_SCENE_INPUT_INVALID", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.input_invalid", nil)
	}
	count, err := s.repo.ConfirmSceneProposal(ctx, proposalID, e.Actor.ID, time.Now())
	if err != nil {
		var own *cannotConfirmOwnProposal
		if errors.As(err, &own) {
			return command.Rejected(e, "REALITY_SCENE_SELF_CONFIRM", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.self_confirm", nil)
		}
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	status := "PENDING"
	if count >= ProposalConfirmationsNeeded {
		status = "APPROVED"
	}
	r := command.Accepted(e, "RealitySceneProposal", proposalID, 1, status, nil)
	raw, _ := json.Marshal(map[string]any{"proposalId": proposalID, "confirmations": count, "status": status})
	r.OperationRef = string(raw)
	return r
}

func (s *Service) listProposals(ctx context.Context, e command.Envelope) command.Result {
	proposals, err := s.repo.ListProposals(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "REALITY_SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.read_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneProposalCollection", e.Actor.ID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"proposals": proposals, "confirmationsNeeded": ProposalConfirmationsNeeded})
	r.OperationRef = string(raw)
	return r
}

// proposalIDFor 生成稳定 id：同一个人重复提交同一个地方不会堆出重复提案
// （ON CONFLICT 也需要一个可复现的 id）。
func proposalIDFor(actorID, name string, lat, lng float64) string {
	sum := sha256.Sum256([]byte(actorID + "|" + name + "|" + strconv.FormatFloat(lat, 'f', 6, 64) + "|" + strconv.FormatFloat(lng, 'f', 6, 64)))
	return hex.EncodeToString(sum[:])[:16]
}

// checkInResult 把 check-in 的结果写回 OperationRef。
//
// verified 只在**带了距离**且距离很近时才为 true，含义是"设备自报就在附近"，
// **不是**"已核实本人在场" —— 没有任何现场核销（订单/核销码/商家确认）参与，
// 所以文案里一个字都不许暗示已核实。
func (s *Service) checkInResult(e command.Envelope, sceneID string, enabled bool, distance *int, newlyEarned []string) command.Result {
	r := command.Accepted(e, "RealitySceneCheckIn", sceneID, 1, "READY", nil)
	payload := map[string]any{"sceneId": sceneID, "field": "checkin", "enabled": enabled, "expiresInMinutes": int(CheckinTTL.Minutes())}
	if distance != nil {
		payload["distanceMeters"] = *distance
		payload["nearby"] = *distance <= 500
	}
	if len(newlyEarned) > 0 {
		payload["newlyEarnedBadges"] = newlyEarned
	}
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}

// evaluateAndEarnBadges 判定并落库新获得的徽章，返回新获得 id 列表。
func (s *Service) evaluateAndEarnBadges(ctx context.Context, actorID, sceneID string) []string {
	checkIns, err := s.repo.ListMyCheckIns(ctx, actorID, time.Now())
	if err != nil {
		return nil
	}
	states, err := s.repo.ListUserStates(ctx, actorID)
	if err != nil {
		return nil
	}
	visitedIds := make([]string, 0, len(states))
	for _, st := range states {
		if st.PrivateVisited {
			visitedIds = append(visitedIds, st.SceneID)
		}
	}
	shouldHave := EvaluateSceneBadges(checkIns, visitedIds)
	already, err := s.repo.ListMyEarnedBadges(ctx, actorID)
	if err != nil {
		return nil
	}
	haveIds := make([]string, 0, len(already))
	for _, b := range already {
		haveIds = append(haveIds, b.BadgeID)
	}
	newly := NewlyEarnedBadges(shouldHave, haveIds)
	for _, id := range newly {
		_ = s.repo.EarnBadge(ctx, actorID, EarnedBadge{BadgeID: id, EarnedAt: time.Now().UTC().Format(time.RFC3339), SceneID: sceneID})
	}
	return newly
}
