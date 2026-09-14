// Package storeonboarding 是「推荐商铺进体系」的受理域（STORE-REC-001）。
//
// 原始设计（Master PRD v1.1 §15 Business/Merchant Suite + CBOS）：企业/店铺
// 是独立模块，不是账户里的附属功能。体系的增长方式是发展 builder，并让
// 小美（AI）与用户把好的场地 / 商家**推荐进体系**，由运营评估后接入。
//
// 本包只做受理留痕：任何人（已登录用户或 AI）都可以提交一条店铺推荐，
// 记录是 append-only 的举证材料 —— 平台能证明「谁、什么时候、因为什么
// 推荐了哪家店」，后续接入与否由运营在 bdash 里评估，不在此包伪造结果。
package storeonboarding

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// StoreRecommendation 是一条店铺推荐受理记录（append-only）。
type StoreRecommendation struct {
	ID            string `json:"recommendationId"`
	StoreName     string `json:"storeName"`
	City          string `json:"city"`
	Category      string `json:"category"`
	Reason        string `json:"reason"`
	RecommendedBy string `json:"recommendedByAccountId"`
	// Origin 区分「真人用户推荐」与「AI（小美）推荐」。
	Origin    string    `json:"origin"` // USER | AI
	CreatedAt time.Time `json:"createdAt"`
}

// Repository 落库边界。append-only：只有 Add，没有 Update/Delete。
type Repository interface {
	AddRecommendation(ctx context.Context, r StoreRecommendation) error
}

// Service 是入口。命令边界保证已登录（AI 走系统账号）。
type Service struct {
	repository Repository
	clock      func() time.Time
}

func New() *Service {
	return NewWithRepository(nil)
}

func NewWithRepository(repo Repository) *Service {
	return &Service{repository: repo, clock: time.Now}
}

func (s *Service) SetClock(f func() time.Time) { s.clock = f }

func (s *Service) Supports(commandType string) bool {
	return commandType == "RecommendStore"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "RecommendStore":
		return s.recommendStore(ctx, e)
	default:
		return command.Rejected(e, "UNKNOWN_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.unknown_command", nil)
	}
}

type recommendStorePayload struct {
	StoreName string `json:"storeName"`
	City      string `json:"city"`
	Category  string `json:"category"`
	Reason    string `json:"reason"`
	Origin    string `json:"origin"`
}

func decodeRecommendStorePayload(payload map[string]any, out *recommendStorePayload) bool {
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func (s *Service) recommendStore(ctx context.Context, e command.Envelope) command.Result {
	var p recommendStorePayload
	if !decodeRecommendStorePayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_RECOMMENDATION", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation", nil)
	}
	if strings.TrimSpace(p.StoreName) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_STORE", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_store", nil)
	}
	if strings.TrimSpace(p.City) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_CITY", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_city", nil)
	}
	if strings.TrimSpace(p.Reason) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_REASON", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_reason", nil)
	}
	origin := strings.ToUpper(strings.TrimSpace(p.Origin))
	if origin != "USER" && origin != "AI" {
		origin = "USER"
	}
	// 推荐人身份是举证链的一部分：匿名推荐无法回访、无法核实。拿不到就拒绝。
	if e.Actor.ID == "" {
		return command.Rejected(e, "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "storeonboarding.recommendation_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	rec := StoreRecommendation{
		ID:            newRecommendationID(),
		StoreName:     strings.TrimSpace(p.StoreName),
		City:          strings.TrimSpace(p.City),
		Category:      strings.TrimSpace(p.Category),
		Reason:        strings.TrimSpace(p.Reason),
		RecommendedBy: e.Actor.ID,
		Origin:        origin,
		CreatedAt:     s.clock().UTC(),
	}
	if err := s.repository.AddRecommendation(ctx, rec); err != nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	return command.Accepted(e, "StoreRecommendation", rec.ID, 1, "PENDING", nil)
}

func newRecommendationID() string {
	b := make([]byte, 9)
	if _, err := rand.Read(b); err != nil {
		return "sr_" + hex.EncodeToString([]byte(time.Now().String()))[:20]
	}
	return "sr_" + hex.EncodeToString(b)
}

var (
	ErrRecommendationStoreRequired  = errors.New("store recommendation requires a store name")
	ErrRecommendationCityRequired   = errors.New("store recommendation requires a city")
	ErrRecommendationReasonRequired = errors.New("store recommendation requires a reason")
	ErrRecommendationRepositoryDown = errors.New("store recommendation repository is unavailable")
)
