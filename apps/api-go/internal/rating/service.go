// Package rating implements CLIENT-RATING-001: a public 1–5 star rating a
// provider (order.AgentID) leaves for the client (order.RequesterID) after
// an order completes.
//
// This is deliberately a different concept from fulfillment.SatisfactionRecord
// (RecordSatisfaction) — that one is the client's private satisfaction with
// the provider, feeding matching/ranking, never shown publicly. This one is
// the mirror direction: a provider's public assessment of a client, shown on
// that client's future market listings so other providers can decide
// whether to apply. Same "one rating per order, re-rating overwrites"
// convention as SatisfactionRecord, enforced here by a real UNIQUE(order_id)
// constraint (migrations/131_client_ratings.sql), not an app-layer promise.
package rating

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// Rating is one provider-rates-client record.
type Rating struct {
	ID          string
	OrderID     string
	RaterID     string
	RatedUserID string
	Stars       int
	Comment     string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Repository persists ratings and answers the aggregate read marketplace
// needs. Implementations: MemoryRepository (tests) and the Postgres twin
// in internal/platform/postgres/rating.go.
type Repository interface {
	Upsert(ctx context.Context, r Rating) error
	Aggregate(ctx context.Context, ratedUserID string) (average float64, count int, err error)
}

// orderReader is the narrow read this package needs from fulfillment —
// same "smallest interface that satisfies the caller" convention as
// growth.orderReader and benefit.MerchantVerifier.
type orderReader interface {
	GetOrder(ctx context.Context, id string) (fulfillment.Order, error)
}

type Service struct {
	repo   Repository
	orders orderReader
	clock  clock.Clock
}

func New(repo Repository, orders orderReader) *Service {
	return &Service{repo: repo, orders: orders, clock: clock.System{}}
}

func NewWithClock(repo Repository, orders orderReader, c clock.Clock) *Service {
	return &Service{repo: repo, orders: orders, clock: c}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == "SubmitRating"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	// OPENAPI-COMMAND-COVERAGE-001: dispatch via `case "X":`, not
	// `if e.CommandType == "X"` — see internal/realityscene/service.go.
	switch e.CommandType {
	case "SubmitRating":
		return s.submitRating(ctx, e)
	default:
		return command.Rejected(e, "RATING_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "rating.unsupported", nil)
	}
}

type submitRatingPayload struct {
	OrderID string `json:"orderId"`
	Stars   int    `json:"stars"`
	Comment string `json:"comment"`
}

func (s *Service) submitRating(ctx context.Context, e command.Envelope) command.Result {
	var p submitRatingPayload
	if !decode(e.Payload, &p) || p.OrderID == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "rating.invalid_payload", nil)
	}
	if p.Stars < 1 || p.Stars > 5 {
		return command.Rejected(e, "INVALID_STARS", "VALIDATION", "AFTER_USER_ACTION", "rating.invalid_stars", map[string]any{"stars": p.Stars})
	}
	order, err := s.orders.GetOrder(ctx, p.OrderID)
	if errors.Is(err, fulfillment.ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "rating.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "rating.order_read_failed", nil)
	}
	// CLIENT-RATING-001: 方向跟 fulfillment.recordSatisfaction 镜像——那边是
	// order.RequesterID != e.Actor.ID 才拒绝（只认需求方），这里反过来只认
	// 接单方，服务者不能被客户反过来冒充打分、客户也不能给自己打分。
	if order.AgentID != e.Actor.ID {
		return command.Rejected(e, "ONLY_PROVIDER_RATES", "AUTHORIZATION", "AFTER_USER_ACTION", "rating.only_provider_rates", nil)
	}
	if order.Lifecycle != "COMPLETED" {
		return command.Rejected(e, "ORDER_NOT_COMPLETED", "BUSINESS_STATE", "AFTER_USER_ACTION", "rating.not_completed", map[string]any{"lifecycle": order.Lifecycle})
	}
	now := s.clock.Now().UTC()
	record := Rating{
		ID:          newID("rating_"),
		OrderID:     order.ID,
		RaterID:     e.Actor.ID,
		RatedUserID: order.RequesterID,
		Stars:       p.Stars,
		Comment:     p.Comment,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.Upsert(ctx, record); err != nil {
		return command.Rejected(e, "RATING_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "rating.save_failed", nil)
	}
	result := command.Accepted(e, "ClientRating", record.ID, 1, "SUBMITTED", nil)
	result.Body = map[string]any{"ratingId": record.ID, "stars": record.Stars}
	return result
}

// GetUserRatingAggregate is the public read seam marketplace.Service calls
// through the small ratingLookup interface it defines for itself — same
// "Repo() is the only public seam" convention as benefit.Service.Repo().
// count == 0 means "no ratings yet"; callers must not substitute a default
// average (MARKET-FAKE-JUDGMENT-001: no data means no badge, not a 0).
func (s *Service) GetUserRatingAggregate(ctx context.Context, userID string) (average float64, count int, err error) {
	return s.repo.Aggregate(ctx, userID)
}

func decode(payload any, target any) bool {
	if payload == nil {
		return false
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(b, target) == nil
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}
