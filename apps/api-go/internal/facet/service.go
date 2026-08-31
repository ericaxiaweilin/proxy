package facet

import (
	"context"
	"sync"
)

type Gap struct {
	Summary    string `json:"summary"`
	NextShowAt string `json:"nextShowAt"`
}

type Object struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	Relation     string `json:"relation"`
	Goal         string `json:"goal"`
	CurrentState string `json:"currentState"`
	PillLabel    string `json:"pillLabel"`
	Gap          Gap    `json:"gap"`
	AvatarURL    string `json:"avatarUrl"`
}

type Payload struct {
	Objects      []Object `json:"objects"`
	TotalObjects int      `json:"totalObjects"`
	FreshAssets  int      `json:"freshAssets"`
	ShownAssets  int      `json:"shownAssets"`
}

type Repository interface {
	List(ctx context.Context) ([]Object, error)
	Seed(ctx context.Context, objects []Object) error
}

type MemoryRepository struct {
	mu      sync.Mutex
	objects []Object
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{} }

func (r *MemoryRepository) List(_ context.Context) ([]Object, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Object, len(r.objects))
	copy(out, r.objects)
	return out, nil
}

func (r *MemoryRepository) Seed(_ context.Context, objects []Object) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.objects = append([]Object(nil), objects...)
	return nil
}

type Service struct {
	repository Repository
}

func New() *Service {
	s := NewWithRepository(NewMemoryRepository())
	s.SeedDefaults()
	return s
}

func NewWithRepository(r Repository) *Service {
	if r == nil {
		r = NewMemoryRepository()
	}
	return &Service{repository: r}
}

func (s *Service) SeedDefaults() {
	_ = s.repository.Seed(context.Background(), []Object{
		{ID: "ken", DisplayName: "小帅 Ken", Relation: "BUILDING_TRUST", Goal: "加强熟悉感与信任，分享生活的真实侧面，创造更多自然互动。", CurrentState: "目标：建立更深信任 · 已展示 16 条 · 本周新增 3 个素材", PillLabel: "重点关系", Gap: Gap{Summary: "真人互动 / 新鲜旅行", NextShowAt: "今晚 20:00"}, AvatarURL: ""},
		{ID: "linh", DisplayName: "Linh", Relation: "SHARED_INTEREST", Goal: "围绕共同兴趣持续连接，优先展示城市、摄影、旅行和轻松日常。", CurrentState: "共同兴趣新增：城市 / 摄影 · 今天可自然更新", PillLabel: "朋友", Gap: Gap{Summary: "新的城市经历 / 摄影内容", NextShowAt: "明天 18:30"}, AvatarURL: ""},
		{ID: "spa", DisplayName: "ABC Spa", Relation: "CREATOR_COLLAB", Goal: "展示真实体验、内容能力和可靠性，为 Creator 合作持续建立信任。", CurrentState: "本周环境内容过多，下一次应突出真人体验与拍摄能力", PillLabel: "合作", Gap: Gap{Summary: "真人体验 / 服务过程近景", NextShowAt: "周四 12:00"}, AvatarURL: ""},
	})
}

func (s *Service) List(ctx context.Context) (Payload, error) {
	objects, err := s.repository.List(ctx)
	if err != nil {
		return Payload{}, err
	}
	if objects == nil {
		objects = []Object{}
	}
	return Payload{Objects: objects, TotalObjects: len(objects), FreshAssets: 17, ShownAssets: 386}, nil
}
