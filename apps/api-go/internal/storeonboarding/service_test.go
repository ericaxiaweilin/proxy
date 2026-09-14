package storeonboarding

import (
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(cmd string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandType:   cmd,
		Payload:       payload,
		Actor:         command.Actor{ID: actorID},
		CorrelationID: "corr_test",
		CommandID:     "cmd_test",
	}
}

func fixedClock() func() time.Time {
	t := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	return func() time.Time { return t }
}

func TestRecommendStoreAcceptedAndAttributed(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Three Beans Cau Giay",
		"city":      "河内",
		"category":  "咖啡",
		"reason":    "朋友常去，适合聊天与 Afterwork 场景",
		"origin":    "USER",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("recommend: %+v", r)
	}
	rows := repo.Recommendations()
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	rec := rows[0]
	if rec.StoreName != "Three Beans Cau Giay" || rec.RecommendedBy != "user_001" || rec.Origin != "USER" {
		t.Fatalf("wrong recommendation: %+v", rec)
	}
	if !rec.CreatedAt.Equal(fixedClock()()) {
		t.Fatalf("createdAt must come from service clock, got %v", rec.CreatedAt)
	}
}

func TestRecommendStoreRequiresStoreCityReason(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	svc.SetClock(fixedClock())
	for _, tc := range []struct {
		name    string
		payload map[string]any
	}{
		{"missing store", map[string]any{"city": "河内", "reason": "x"}},
		{"missing city", map[string]any{"storeName": "店", "reason": "x"}},
		{"missing reason", map[string]any{"storeName": "店", "city": "河内"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := svc.Handle(envelopeFor("RecommendStore", tc.payload, "user_001"))
			if r.Outcome != "REJECTED" {
				t.Fatalf("want rejected, got %+v", r)
			}
		})
	}
}

func TestRecommendStoreRejectedWhenActorMissing(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "店", "city": "河内", "reason": "x",
	}, ""))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR" {
		t.Fatalf("want actor rejection, got %+v", r)
	}
}

func TestRecommendStoreFailedWhenRepositoryDown(t *testing.T) {
	repo := NewMemoryRepository()
	repo.SetFail(true)
	svc := NewWithRepository(repo)
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "店", "city": "河内", "reason": "x",
	}, "user_001"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "RECOMMENDATION_FAILED" {
		t.Fatalf("want repository-down rejection, got %+v", r)
	}
}

func TestRecommendStoreSupportsOnlyItsCommand(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if !svc.Supports("RecommendStore") {
		t.Fatal("must support RecommendStore")
	}
	for _, other := range []string{"ReportTarget", "FileAppeal", "CreatePost"} {
		if svc.Supports(other) {
			t.Fatalf("must not support %s", other)
		}
	}
}

func TestRecommendStoreAIOriginAccepted(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Truc Bach Lake Cafe",
		"city":      "河内",
		"category":  "咖啡",
		"reason":    "湖景好，适合湖边慢聊场景（AI 小美推荐）",
		"origin":    "AI",
	}, "ai_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("AI recommend: %+v", r)
	}
	if repo.Recommendations()[0].Origin != "AI" {
		t.Fatalf("origin must be AI, got %+v", repo.Recommendations()[0])
	}
}
