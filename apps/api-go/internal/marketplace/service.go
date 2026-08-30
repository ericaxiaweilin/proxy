package marketplace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Service owns the P0 opportunity read model and its user actions. Mobile may
// render this payload, but publishing, applying and dismissing are server facts.
type Service struct {
	repository Repository
}

var ErrOpportunityNotFound = errors.New("market opportunity not found")

type Repository interface {
	Seed(ctx context.Context, opportunities []Opportunity) error
	List(ctx context.Context, viewerID string) ([]Opportunity, error)
	Get(ctx context.Context, id string) (Opportunity, error)
	Create(ctx context.Context, opportunity Opportunity) error
	Apply(ctx context.Context, application Application) (Application, bool, error)
	Dismiss(ctx context.Context, viewerID, opportunityID string) error
}

type MemoryRepository struct {
	mu            sync.Mutex
	opportunities []Opportunity
	applications  map[string]map[string]Application
	dismissed     map[string]bool
}

type Opportunity struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	ShortTitle  string   `json:"shortTitle"`
	Theme       string   `json:"theme"`
	Date        string   `json:"date"`
	Time        string   `json:"time"`
	Location    string   `json:"location"`
	Price       string   `json:"price"`
	Owner       string   `json:"owner"`
	OwnerID     string   `json:"-"`
	OwnerType   string   `json:"ownerType"`
	Match       string   `json:"match"`
	Responses   int      `json:"responses"`
	Posted      string   `json:"posted"`
	Skills      string   `json:"skills"`
	Verified    bool     `json:"verified"`
	Lens        []string `json:"lens"`
	Travel      *int     `json:"travel"`
	Signal      string   `json:"signal"`
	SignalClass string   `json:"signalClass"`
	Countdown   string   `json:"countdown"`
	Owned       bool     `json:"ownedByViewer"`
	Applied     bool     `json:"appliedByViewer"`
}

type Application struct {
	ID            string    `json:"applicationId"`
	OpportunityID string    `json:"opportunityId"`
	ApplicantID   string    `json:"applicantId"`
	Quote         string    `json:"quote"`
	Scope         string    `json:"scope"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

func New() *Service {
	return NewWithRepository(&MemoryRepository{applications: make(map[string]map[string]Application), dismissed: make(map[string]bool)})
}

func NewWithRepository(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) SeedDefaults() {
	travel18, travel24, travel52, travel20 := 18, 24, 52, 20
	_ = s.repository.Seed(context.Background(), []Opportunity{
		{ID: "biz_negotiation", Title: "商务谈判陪同 · 中英越沟通", ShortTitle: "谈判", Theme: "商务谈判", Date: "今天", Time: "14:00–18:00", Location: "河内 · Hoàn Kiếm", Price: "1,200,000₫", Owner: "Nova Trading", OwnerID: "seed_nova", OwnerType: "BUSINESS", Match: "94%", Responses: 6, Posted: "12 分钟前", Skills: "中文 · 英语 · 商务沟通", Verified: true, Lens: []string{"NOW", "NEARBY"}, Travel: &travel18, Signal: "急需", SignalClass: "hot", Countdown: "42m"},
		{ID: "event_photo", Title: "品牌活动摄影 / 短视频", ShortTitle: "摄影", Theme: "摄影", Date: "周六", Time: "15:00–20:00", Location: "河内 · 西湖", Price: "1,500,000₫", Owner: "Bonsaidon", OwnerID: "seed_bonsaidon", OwnerType: "BUSINESS", Match: "91%", Responses: 9, Posted: "25 分钟前", Skills: "摄影 · 基础剪辑 · 活动经验", Verified: true, Lens: []string{"BOOKED", "NEARBY"}, Travel: &travel24, Signal: "热门", Countdown: "3天"},
		{ID: "supplier_visit", Title: "供应商拜访 · 中文陪同", ShortTitle: "陪同", Theme: "商务陪同", Date: "明天", Time: "09:00–15:00", Location: "北宁 · Yên Phong", Price: "1,100,000₫", Owner: "Acme VN", OwnerID: "seed_acme", OwnerType: "BUSINESS", Match: "89%", Responses: 3, Posted: "42 分钟前", Skills: "中文 · 制造业 · 会议记录", Verified: true, Lens: []string{"BOOKED"}, Travel: &travel52, Signal: "新发布", Countdown: "明天"},
		{ID: "city_companion", Title: "河内半日城市同行 / 拍照", ShortTitle: "同行", Theme: "城市同行", Date: "周日", Time: "13:30–18:00", Location: "河内 · 西湖 → 老城区", Price: "950,000₫", Owner: "Chen", OwnerID: "seed_chen", OwnerType: "PERSON", Match: "87%", Responses: 11, Posted: "1 小时前", Skills: "中文 · 路线 · 轻摄影", Verified: true, Lens: []string{"BOOKED", "NEARBY"}, Travel: &travel20, Signal: "高响应", Countdown: "周日"},
	})
}

func (s *Service) Supports(t string) bool {
	switch t {
	case "ListMarketOpportunities", "PublishMarketOpportunity", "ApplyToMarketOpportunity", "DismissMarketOpportunity":
		return true
	}
	return false
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "ListMarketOpportunities":
		items, err := s.repository.List(ctx, e.Actor.ID)
		if err != nil {
			return command.Rejected(e, "MARKET_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "market.list_failed", nil)
		}
		return payload(e, "Market", "local", "READY", map[string]any{"opportunities": items})
	case "PublishMarketOpportunity":
		var p Opportunity
		if !decode(e.Payload, &p) || p.Title == "" || p.Price == "" || p.Location == "" {
			return rejected(e, "INVALID_OPPORTUNITY", "market.invalid_opportunity")
		}
		p.ID = newID("opp_")
		p.OwnerID = e.Actor.ID
		p.Owner = "你"
		p.OwnerType = "PERSON"
		p.Verified = true
		p.Posted = "刚刚"
		p.Responses = 0
		p.Match = "100%"
		p.Signal = "新发布"
		p.Countdown = p.Date
		p.Owned = true
		if p.ShortTitle == "" {
			p.ShortTitle = p.Theme
		}
		if len(p.Lens) == 0 {
			p.Lens = []string{"BOOKED", "NEARBY"}
		}
		if err := s.repository.Create(ctx, p); err != nil {
			return command.Rejected(e, "MARKET_PUBLISH_FAILED", "INTERNAL", "SAFE_RETRY", "market.publish_failed", nil)
		}
		return payload(e, "MarketOpportunity", p.ID, "PUBLISHED", map[string]any{"opportunity": p})
	case "ApplyToMarketOpportunity":
		id, _ := e.Payload["opportunityId"].(string)
		quote, _ := e.Payload["quote"].(string)
		scope, _ := e.Payload["scope"].(string)
		stored, err := s.repository.Get(ctx, id)
		if errors.Is(err, ErrOpportunityNotFound) || quote == "" {
			return rejected(e, "INVALID_APPLICATION", "market.invalid_application")
		}
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_failed", nil)
		}
		if stored.OwnerID == e.Actor.ID {
			return rejected(e, "OWNER_CANNOT_APPLY", "market.owner_cannot_apply")
		}
		a := Application{ID: newID("app_"), OpportunityID: id, ApplicantID: e.Actor.ID, Quote: quote, Scope: scope, Status: "SUBMITTED", CreatedAt: time.Now().UTC()}
		a, _, err = s.repository.Apply(ctx, a)
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_failed", nil)
		}
		return payload(e, "MarketApplication", a.ID, a.Status, map[string]any{"application": a})
	case "DismissMarketOpportunity":
		id, _ := e.Payload["opportunityId"].(string)
		if err := s.repository.Dismiss(ctx, e.Actor.ID, id); errors.Is(err, ErrOpportunityNotFound) {
			return rejected(e, "OPPORTUNITY_NOT_FOUND", "market.opportunity_not_found")
		} else if err != nil {
			return command.Rejected(e, "MARKET_DISMISS_FAILED", "INTERNAL", "SAFE_RETRY", "market.dismiss_failed", nil)
		}
		return payload(e, "MarketOpportunity", id, "DISMISSED", map[string]any{"opportunityId": id})
	}
	return rejected(e, "MARKET_COMMAND_UNSUPPORTED", "market.unsupported_command")
}

func (r *MemoryRepository) Seed(_ context.Context, opportunities []Opportunity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.opportunities) == 0 {
		r.opportunities = append([]Opportunity(nil), opportunities...)
	}
	return nil
}
func (r *MemoryRepository) List(_ context.Context, viewerID string) ([]Opportunity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]Opportunity, 0, len(r.opportunities))
	for _, stored := range r.opportunities {
		if r.dismissed[viewerID+"|"+stored.ID] {
			continue
		}
		item := stored
		item.Owned = stored.OwnerID == viewerID
		_, item.Applied = r.applications[stored.ID][viewerID]
		items = append(items, item)
	}
	return items, nil
}
func (r *MemoryRepository) Get(_ context.Context, id string) (Opportunity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.opportunities {
		if item.ID == id {
			return item, nil
		}
	}
	return Opportunity{}, ErrOpportunityNotFound
}
func (r *MemoryRepository) Create(_ context.Context, opportunity Opportunity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opportunities = append([]Opportunity{opportunity}, r.opportunities...)
	return nil
}
func (r *MemoryRepository) Apply(_ context.Context, application Application) (Application, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	index := -1
	for i := range r.opportunities {
		if r.opportunities[i].ID == application.OpportunityID {
			index = i
			break
		}
	}
	if index < 0 {
		return Application{}, false, ErrOpportunityNotFound
	}
	if r.applications[application.OpportunityID] == nil {
		r.applications[application.OpportunityID] = make(map[string]Application)
	}
	if existing, ok := r.applications[application.OpportunityID][application.ApplicantID]; ok {
		return existing, false, nil
	}
	r.applications[application.OpportunityID][application.ApplicantID] = application
	r.opportunities[index].Responses++
	return application, true, nil
}
func (r *MemoryRepository) Dismiss(_ context.Context, viewerID, opportunityID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	found := false
	for _, item := range r.opportunities {
		if item.ID == opportunityID {
			found = true
			break
		}
	}
	if !found {
		return ErrOpportunityNotFound
	}
	r.dismissed[viewerID+"|"+opportunityID] = true
	return nil
}
func decode(value any, target any) bool {
	raw, err := json.Marshal(value)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func rejected(e command.Envelope, code, key string) command.Result {
	return command.Rejected(e, code, "VALIDATION", "AFTER_USER_ACTION", key, nil)
}
func payload(e command.Envelope, typ, id, state string, body map[string]any) command.Result {
	r := command.Accepted(e, typ, id, 1, state, nil)
	raw, _ := json.Marshal(body)
	r.OperationRef = string(raw)
	return r
}
func newID(prefix string) string {
	var b [10]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + strconv.FormatInt(time.Now().UnixNano(), 36)
}
