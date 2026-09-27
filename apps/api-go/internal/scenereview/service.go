// Package scenereview implements a real, checkin-gated 1-5 star review of a
// reality scene (venue). This is a separate concept from:
//   - internal/rating (CLIENT-RATING-001): a provider rating a client after
//     an order completes — person-to-person, order-scoped.
//   - internal/scene: a two-person meetup/booking instance's own Rating
//     field (aesthetic score × budget adherence) — unrelated to venues.
//
// The gate here mirrors that same "must have real standing to speak" idea,
// but the standing is "you have actually checked in at this scene at least
// once" (realityscene.Service.ListMyCheckinHistory), not "you completed an
// order". One review per (scene, rater); re-reviewing overwrites, same
// "覆盖不叠加" convention as rating/fulfillment.SatisfactionRecord, enforced
// by a real UNIQUE(scene_id, rater_id) constraint
// (migrations/132_scene_reviews.sql), not an app-layer promise.
package scenereview

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// Review is one real checkin-gated scene review.
type Review struct {
	ID        string
	SceneID   string
	RaterID   string
	Stars     int
	Comment   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository persists reviews and answers the aggregate read realityscene
// needs. Implementations: MemoryRepository (tests) and the Postgres twin in
// internal/platform/postgres/scene_review.go.
type Repository interface {
	Upsert(ctx context.Context, r Review) error
	Aggregate(ctx context.Context, sceneID string) (average float64, count int, err error)
}

// checkinHistory is the narrow read this package needs from realityscene —
// same "smallest interface that satisfies the caller" convention as
// rating.orderReader and benefit.MerchantVerifier. Reused as-is rather than
// duplicated: a scene id is "visited" only if it shows up in the same
// BADGE-WALL-001 history the badge wall already reads.
type checkinHistory interface {
	ListMyCheckinHistory(ctx context.Context, actorID string) ([]string, error)
}

type Service struct {
	repo     Repository
	checkins checkinHistory
	clock    clock.Clock
}

func New(repo Repository, checkins checkinHistory) *Service {
	return &Service{repo: repo, checkins: checkins, clock: clock.System{}}
}

func NewWithClock(repo Repository, checkins checkinHistory, c clock.Clock) *Service {
	return &Service{repo: repo, checkins: checkins, clock: c}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == "SubmitSceneReview"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	// OPENAPI-COMMAND-COVERAGE-001: dispatch by `case "X":`, not `if
	// e.CommandType == "X"` — the openapi.commands.generated.yaml drift
	// check (internal/openapicmds) statically scans for `case "X":` arms.
	switch e.CommandType {
	case "SubmitSceneReview":
		return s.submitReview(ctx, e)
	}
	return command.Rejected(e, "SCENE_REVIEW_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "scenereview.unsupported", nil)
}

type submitReviewPayload struct {
	SceneID string `json:"sceneId"`
	Stars   int    `json:"stars"`
	Comment string `json:"comment"`
}

func (s *Service) submitReview(ctx context.Context, e command.Envelope) command.Result {
	var p submitReviewPayload
	if !decode(e.Payload, &p) || p.SceneID == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "scenereview.invalid_payload", nil)
	}
	if p.Stars < 1 || p.Stars > 5 {
		return command.Rejected(e, "INVALID_STARS", "VALIDATION", "AFTER_USER_ACTION", "scenereview.invalid_stars", map[string]any{"stars": p.Stars})
	}
	history, err := s.checkins.ListMyCheckinHistory(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "CHECKIN_HISTORY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "scenereview.checkin_history_read_failed", nil)
	}
	if !containsString(history, p.SceneID) {
		return command.Rejected(e, "SCENE_NOT_VISITED", "BUSINESS_STATE", "AFTER_USER_ACTION", "scenereview.scene_not_visited", nil)
	}
	now := s.clock.Now().UTC()
	record := Review{
		ID:        newID("screv_"),
		SceneID:   p.SceneID,
		RaterID:   e.Actor.ID,
		Stars:     p.Stars,
		Comment:   p.Comment,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.repo.Upsert(ctx, record); err != nil {
		return command.Rejected(e, "SCENE_REVIEW_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "scenereview.save_failed", nil)
	}
	result := command.Accepted(e, "SceneReview", record.ID, 1, "SUBMITTED", nil)
	result.Body = map[string]any{"reviewId": record.ID, "stars": record.Stars}
	return result
}

// GetSceneRatingAggregate is the public read seam realityscene.Service calls
// through the small ratingLookup interface it defines for itself — same
// "count == 0 means no data, never a fabricated default" convention as
// rating.Service.GetUserRatingAggregate (MARKET-FAKE-JUDGMENT-001 /
// SCENE-NO-FABRICATED-001).
func (s *Service) GetSceneRatingAggregate(ctx context.Context, sceneID string) (average float64, count int, err error) {
	return s.repo.Aggregate(ctx, sceneID)
}

func containsString(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
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
