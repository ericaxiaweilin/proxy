package scenereview

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

type fakeCheckinHistory struct {
	byActor map[string][]string
	err     error
}

func (f *fakeCheckinHistory) ListMyCheckinHistory(_ context.Context, actorID string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byActor[actorID], nil
}

func TestSubmitSceneReviewRequiresAVisit(t *testing.T) {
	checkins := &fakeCheckinHistory{byActor: map[string][]string{"visitor_1": {"threebeans"}}}
	svc := New(NewMemoryRepository(), checkins)

	// Never checked in here — rejected.
	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitSceneReview",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "never_visited"},
		Payload:     map[string]any{"sceneId": "threebeans", "stars": 5},
	})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "SCENE_NOT_VISITED" {
		t.Fatalf("expected SCENE_NOT_VISITED, got %s: %+v", result.Outcome, result.Error)
	}

	// Checked in here — accepted.
	ok := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitSceneReview",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
		Payload:     map[string]any{"sceneId": "threebeans", "stars": 5},
	})
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED for a real visitor, got %s: %+v", ok.Outcome, ok.Error)
	}
}

func TestSubmitSceneReviewValidatesStarRange(t *testing.T) {
	checkins := &fakeCheckinHistory{byActor: map[string][]string{"visitor_1": {"threebeans"}}}
	svc := New(NewMemoryRepository(), checkins)

	for _, stars := range []int{0, 6, -1} {
		result := svc.HandleContext(context.Background(), command.Envelope{
			CommandType: "SubmitSceneReview",
			Actor:       command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
			Payload:     map[string]any{"sceneId": "threebeans", "stars": stars},
		})
		if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "INVALID_STARS" {
			t.Fatalf("stars=%d: expected INVALID_STARS, got %s: %+v", stars, result.Outcome, result.Error)
		}
	}
}

func TestSubmitSceneReviewOnTheSameSceneOverwritesNotStacks(t *testing.T) {
	checkins := &fakeCheckinHistory{byActor: map[string][]string{"visitor_1": {"threebeans"}}}
	repo := NewMemoryRepository()
	svc := New(repo, checkins)
	ctx := context.Background()

	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitSceneReview", Actor: command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
		Payload: map[string]any{"sceneId": "threebeans", "stars": 2},
	})
	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitSceneReview", Actor: command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
		Payload: map[string]any{"sceneId": "threebeans", "stars": 5},
	})

	avg, count, err := svc.GetSceneRatingAggregate(ctx, "threebeans")
	if err != nil {
		t.Fatalf("GetSceneRatingAggregate: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected the re-review to overwrite (count=1), got count=%d", count)
	}
	if avg != 5 {
		t.Fatalf("expected the overwritten value (5), got avg=%v", avg)
	}
}

func TestSubmitSceneReviewDistinctRatersAccumulate(t *testing.T) {
	checkins := &fakeCheckinHistory{byActor: map[string][]string{
		"visitor_1": {"threebeans"},
		"visitor_2": {"threebeans"},
	}}
	svc := New(NewMemoryRepository(), checkins)
	ctx := context.Background()

	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitSceneReview", Actor: command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
		Payload: map[string]any{"sceneId": "threebeans", "stars": 4},
	})
	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitSceneReview", Actor: command.Actor{Type: "INDIVIDUAL", ID: "visitor_2"},
		Payload: map[string]any{"sceneId": "threebeans", "stars": 2},
	})

	avg, count, err := svc.GetSceneRatingAggregate(ctx, "threebeans")
	if err != nil {
		t.Fatalf("GetSceneRatingAggregate: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected two distinct raters to both count, got count=%d", count)
	}
	if avg != 3 {
		t.Fatalf("expected avg=3, got %v", avg)
	}
}

func TestGetSceneRatingAggregateReturnsZeroCountNotAFakeDefault(t *testing.T) {
	svc := New(NewMemoryRepository(), &fakeCheckinHistory{byActor: map[string][]string{}})

	// SCENE-NO-FABRICATED-001 / MARKET-FAKE-JUDGMENT-001: nobody has ever
	// reviewed this scene. The aggregate must say "0 reviews", never a
	// fabricated average.
	avg, count, err := svc.GetSceneRatingAggregate(context.Background(), "never_reviewed")
	if err != nil {
		t.Fatalf("GetSceneRatingAggregate: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected count=0 for an unreviewed scene, got %d", count)
	}
	if avg != 0 {
		t.Fatalf("expected avg=0 (caller must treat count==0 as no-data, not read avg), got %v", avg)
	}
}

func TestSubmitSceneReviewSurfacesCheckinHistoryReadFailure(t *testing.T) {
	checkins := &fakeCheckinHistory{err: errors.New("db unavailable")}
	svc := New(NewMemoryRepository(), checkins)

	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitSceneReview",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "visitor_1"},
		Payload:     map[string]any{"sceneId": "threebeans", "stars": 5},
	})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "CHECKIN_HISTORY_READ_FAILED" {
		t.Fatalf("expected CHECKIN_HISTORY_READ_FAILED, got %s: %+v", result.Outcome, result.Error)
	}
}

func TestSupportsAndUnknownCommandRejection(t *testing.T) {
	svc := NewWithClock(NewMemoryRepository(), &fakeCheckinHistory{byActor: map[string][]string{}}, clock.NewFixed(time.Now()))
	if !svc.Supports("SubmitSceneReview") {
		t.Fatal("expected SubmitSceneReview to be supported")
	}
	if svc.Supports("SomethingElse") {
		t.Fatal("expected an unknown command type to be unsupported")
	}
	result := svc.HandleContext(context.Background(), command.Envelope{CommandType: "SomethingElse"})
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for an unsupported command, got %s", result.Outcome)
	}
}
