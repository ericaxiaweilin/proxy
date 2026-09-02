package experience

import (
	"context"
	"sync"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

// MemoryRepository — R15.49 引入的 InMemory 实现，server 启动时塞 24 条体验 mock 数据。
//
// 设计：ListExperiences 现在有真 data source（不再 hardcode 24），但 server 没接 PG
// 体验表 — Phase 1 内存 mock，Phase 2 接入 experience schema 表（如果需要）。
//
// 24 是 R15.49 之前 home "体验" 计数用的 baseline (跟 ListMarketOpportunities 的
// MarketOpportunity / ListActivities 的 Activity 数量级一致 — "三四十个" 体量)。
type MemoryRepository struct {
	mu           sync.Mutex
	intents      map[string]runtime.ExperienceIntent
	surfacePlans map[string]runtime.SurfacePlan
	experiences  []ExperienceSummary
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		intents:      make(map[string]runtime.ExperienceIntent),
		surfacePlans: make(map[string]runtime.SurfacePlan),
		experiences:  defaultExperiences(),
	}
}

func NewMemoryRepositoryWithSeed(seed []ExperienceSummary) *MemoryRepository {
	if seed == nil {
		seed = defaultExperiences()
	}
	return &MemoryRepository{
		intents:      make(map[string]runtime.ExperienceIntent),
		surfacePlans: make(map[string]runtime.SurfacePlan),
		experiences:  seed,
	}
}

func (r *MemoryRepository) CreateIntent(_ context.Context, intent runtime.ExperienceIntent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.intents[intent.IntentID] = intent
	return nil
}

func (r *MemoryRepository) CreateSurfacePlan(_ context.Context, plan runtime.SurfacePlan) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.surfacePlans[plan.SurfacePlanID] = plan
	return nil
}

func (r *MemoryRepository) ListExperiences(_ context.Context) ([]ExperienceSummary, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]ExperienceSummary, len(r.experiences))
	copy(out, r.experiences)
	return out, nil
}

// defaultExperiences — 24 条 R15.49 baseline mock, 跟 home "体验 24" 旧 hardcode 对齐。
// 多类别多 city 多 origin — 覆盖 client 后续可能加的 filter。
func defaultExperiences() []ExperienceSummary {
	return []ExperienceSummary{
		{ExperienceID: "exp_city_walk_hcmc", Title: "西贡老巷漫步", Category: "CITY_WALK", Origin: "PLATFORM", City: "HCMC", Status: "OPEN", Capacity: 12, Interested: 8},
		{ExperienceID: "exp_cafe_quiet_hcmc", Title: "安静咖啡馆下午", Category: "CAFE", Origin: "PLATFORM", City: "HCMC", Status: "OPEN", Capacity: 6, Interested: 4},
		{ExperienceID: "exp_street_food_hcmc", Title: "西贡街头小吃路线", Category: "FOOD", Origin: "MERCHANT", City: "HCMC", Status: "OPEN", Capacity: 10, Interested: 7},
		{ExperienceID: "exp_river_cruise_hcmc", Title: "湄公河夜游", Category: "SIGHTSEEING", Origin: "MERCHANT", City: "HCMC", Status: "OPEN", Capacity: 20, Interested: 12},
		{ExperienceID: "exp_cooking_class_hcmc", Title: "越南家常菜手作课", Category: "WORKSHOP", Origin: "MERCHANT", City: "HCMC", Status: "OPEN", Capacity: 8, Interested: 6},
		{ExperienceID: "exp_art_studio_hcmc", Title: "独立艺术家工作室开放日", Category: "CULTURE", Origin: "USER", City: "HCMC", Status: "OPEN", Capacity: 15, Interested: 3},
		{ExperienceID: "exp_live_music_hcmc", Title: "地下乐队现场", Category: "NIGHTLIFE", Origin: "PLATFORM", City: "HCMC", Status: "OPEN", Capacity: 30, Interested: 22},
		{ExperienceID: "exp_yoga_park_hcmc", Title: "公园晨练瑜伽", Category: "WELLNESS", Origin: "USER", City: "HCMC", Status: "OPEN", Capacity: 20, Interested: 9},
		{ExperienceID: "exp_book_club_hcmc", Title: "独立书店读书会", Category: "CULTURE", Origin: "USER", City: "HCMC", Status: "OPEN", Capacity: 10, Interested: 5},

		{ExperienceID: "exp_temple_tour_hanoi", Title: "河内古寺半日", Category: "SIGHTSEEING", Origin: "PLATFORM", City: "HANOI", Status: "OPEN", Capacity: 15, Interested: 11},
		{ExperienceID: "exp_pho_tour_hanoi", Title: "老城河粉地图", Category: "FOOD", Origin: "MERCHANT", City: "HANOI", Status: "OPEN", Capacity: 8, Interested: 7},
		{ExperienceID: "exp_lake_walk_hanoi", Title: "还剑湖晨跑团", Category: "WELLNESS", Origin: "USER", City: "HANOI", Status: "OPEN", Capacity: 20, Interested: 14},
		{ExperienceID: "exp_oldsquarter_hanoi", Title: "三十六街老巷导览", Category: "CITY_WALK", Origin: "PLATFORM", City: "HANOI", Status: "OPEN", Capacity: 12, Interested: 9},
		{ExperienceID: "exp_brewery_hanoi", Title: "精酿啤酒工坊参观", Category: "WORKSHOP", Origin: "MERCHANT", City: "HANOI", Status: "OPEN", Capacity: 16, Interested: 4},
		{ExperienceID: "exp_theatre_hanoi", Title: "木偶戏传统剧场", Category: "CULTURE", Origin: "PLATFORM", City: "HANOI", Status: "OPEN", Capacity: 40, Interested: 18},

		{ExperienceID: "exp_oldtown_danang", Title: "岘港古城徒步", Category: "CITY_WALK", Origin: "PLATFORM", City: "DANANG", Status: "OPEN", Capacity: 12, Interested: 5},
		{ExperienceID: "exp_dragonbridge_danang", Title: "龙桥周末夜市", Category: "FOOD", Origin: "PLATFORM", City: "DANANG", Status: "OPEN", Capacity: 50, Interested: 31},
		{ExperienceID: "exp_seafood_danang", Title: "海鲜大排档", Category: "FOOD", Origin: "MERCHANT", City: "DANANG", Status: "OPEN", Capacity: 20, Interested: 13},
		{ExperienceID: "exp_surf_danang", Title: "美溪海滩冲浪课", Category: "WORKSHOP", Origin: "MERCHANT", City: "DANANG", Status: "OPEN", Capacity: 6, Interested: 4},

		{ExperienceID: "exp_holyoke_hue", Title: "顺化皇城一日", Category: "CULTURE", Origin: "PLATFORM", City: "HUE", Status: "OPEN", Capacity: 15, Interested: 6},
		{ExperienceID: "exp_boat_hue", Title: "香江游船黄昏", Category: "SIGHTSEEING", Origin: "MERCHANT", City: "HUE", Status: "OPEN", Capacity: 30, Interested: 8},
		{ExperienceID: "exp_cuisine_hue", Title: "顺化宫廷菜", Category: "FOOD", Origin: "MERCHANT", City: "HUE", Status: "OPEN", Capacity: 10, Interested: 5},

		{ExperienceID: "exp_quiet_hoian", Title: "会安灯笼夜放", Category: "CULTURE", Origin: "PLATFORM", City: "HOIAN", Status: "OPEN", Capacity: 20, Interested: 17},
		{ExperienceID: "exp_tailor_hoian", Title: "会安裁缝定制半日", Category: "WORKSHOP", Origin: "MERCHANT", City: "HOIAN", Status: "OPEN", Capacity: 6, Interested: 3},
	}
}
