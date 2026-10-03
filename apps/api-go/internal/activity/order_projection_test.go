package activity

import (
	"context"
	"encoding/json"
	"testing"
)

// MERCHANT-OUTCOME-PROJECTION-001：商家经营结果为 0 的真身 —— 订单从来没被
// 投影到 spend_daily。这三条钉住投影桥的调用契约：有场景的下单/取消必须投，
// 无场景的不投，重复下单不重复投。

type projectionCall struct {
	SceneID    string
	ActivityID string
	ActorID    string
	Counted    bool
}

type recordingProjector struct{ calls []projectionCall }

func (f *recordingProjector) ProjectActivityOrder(_ context.Context, sceneID, activityID, actorID string, counted bool) error {
	f.calls = append(f.calls, projectionCall{sceneID, activityID, actorID, counted})
	return nil
}

func publishedSceneActivity(t *testing.T, s *Service, owner, key string) string {
	t.Helper()
	e := activityEnvelope("PublishActivity", owner, key)
	e.Payload = map[string]any{"title": "周六咖啡局", "time": "周六 15:00–17:00", "capacity": 6,
		"venueName": "Three Beans · Cầu Giấy", "venueIcon": "☕", "venueType": "CAFE",
		"realitySceneId": "threebeans", "desc": "拍照聊天", "consumptionTerm": "SPLIT"}
	out := s.HandleContext(context.Background(), e)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", out)
	}
	var body struct {
		Activity Activity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	return body.Activity.ID
}

func TestJoinAndCancelProjectMerchantOutcome(t *testing.T) {
	s := New()
	projector := &recordingProjector{}
	s.SetOrderProjector(projector)
	id := publishedSceneActivity(t, s, "owner_proj", "pub")

	if out := s.HandleContext(context.Background(), activityEnvelope("JoinActivity", "user_proj_a", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	if len(projector.calls) != 1 || projector.calls[0] != (projectionCall{"threebeans", id, "user_proj_a", true}) {
		t.Fatalf("join must project exactly one counted order, got %+v", projector.calls)
	}

	// 重复下单被拒 ⇒ 不能再投一笔。
	if out := s.HandleContext(context.Background(), activityEnvelope("JoinActivity", "user_proj_a", id)); out.Outcome == "ACCEPTED" {
		t.Fatalf("duplicate join unexpectedly accepted")
	}
	if len(projector.calls) != 1 {
		t.Fatalf("rejected join must not project, got %+v", projector.calls)
	}

	cancel := activityEnvelope("CancelActivity", "user_proj_a", id)
	if out := s.HandleContext(context.Background(), cancel); out.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", out)
	}
	if len(projector.calls) != 2 || projector.calls[1] != (projectionCall{"threebeans", id, "user_proj_a", false}) {
		t.Fatalf("cancel must project the reversal, got %+v", projector.calls)
	}
}

func TestScenelessActivityDoesNotProject(t *testing.T) {
	repo := &MemoryRepository{activities: make(map[string]*Activity)}
	if err := repo.Create(context.Background(), Activity{ID: "act_noscene", Title: "无场景活动", Capacity: 4}); err != nil {
		t.Fatal(err)
	}
	s := NewWithRepository(repo)
	projector := &recordingProjector{}
	s.SetOrderProjector(projector)
	if out := s.HandleContext(context.Background(), activityEnvelope("JoinActivity", "user_proj_b", "act_noscene")); out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	if len(projector.calls) != 0 {
		t.Fatalf("sceneless order belongs to no merchant, got %+v", projector.calls)
	}
}
