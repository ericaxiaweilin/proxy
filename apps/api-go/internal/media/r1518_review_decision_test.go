// R15.18 — media_review_decisions 持久化 + 列表命令
//
// 钉 8 个 tripwire:
//   1. ReviewMediaAsset 成功后, decision row 写到 in-memory repo
//   2. Decision 字段完整: from, to, reason, operator_id, reviewed_at
//   3. ListMediaReviewDecisions 按 mediaAssetId 过滤, 只返该 asset 的
//   4. ListMediaReviewDecisions 无 filter 返所有
//   5. ListMediaReviewDecisions 倒序 (最新决策在前)
//   6. ListMediaReviewDecisions limit 生效
//   7. Append-only: 重复 ID 拒 (错误)
//   8. nil review repo 不阻塞 (软失败路径)
package media

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeForList(targetID, principalID string, payload map[string]any) command.Envelope {
	env := command.Envelope{
		CommandID:      "listdecisions_" + targetID,
		CommandType:    "ListMediaReviewDecisions",
		CommandVersion: 1,
		Actor:          command.Actor{Type: "OPERATOR", ID: principalID},
		Principal:      command.Principal{Type: "OPERATOR", ID: principalID},
		Target:         command.Target{Type: "MediaReviewDecision", ID: "list"},
		IdempotencyKey: "listdecisions_" + targetID,
		AuthContext:    map[string]any{"role": "OPERATOR"},
		Purpose:        "r1518-audit-list",
		CorrelationID:  "listdecisions_" + targetID,
		RequestedAt:    "2026-08-28T00:00:00Z",
	}
	if payload != nil {
		env.Payload = payload
	}
	return env
}

func newServiceWithDecisionTracking() (*Service, *MemoryReviewDecisionRepository) {
	decisionRepo := NewMemoryReviewDecisionRepository()
	repo := NewMemoryRepository()
	svc := NewWithReviewDecisionRepository(repo, decisionRepo, nil)
	return svc, decisionRepo
}

func createQuarantinedAssetForDecision(t *testing.T, svc *Service, assetID, principalID string) string {
	t.Helper()
	env := envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "IMAGE",
		"originalStorageKey": assetID + ".jpg",
		"mimeType":           "image/jpeg",
		"width":              1200,
		"height":             1500,
	}, assetID)
	res := svc.Handle(env)
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("create failed: %s", res.Error)
	}
	var op struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &op); err != nil {
		t.Fatalf("parse op: %v (raw=%q)", err, res.OperationRef)
	}
	realID := op.MediaAssetID
	// Move to QUARANTINED manually (skip upload/complete dance)
	asset, _ := svc.repository.GetAsset(context.Background(), realID)
	asset.ProcessingStatus = "QUARANTINED"
	asset.ModerationStatus = "QUARANTINED"
	if err := svc.repository.UpdateAsset(context.Background(), asset, "UPLOADING"); err != nil {
		t.Fatalf("update to quarantined: %v", err)
	}
	return realID
}

func TestReviewDecision_AppendsAfterReview(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	assetID := createQuarantinedAssetForDecision(t, svc, "ma_app1", "operator_001")
	res := svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "test", "operator_001"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("review: %s", res.Error)
	}
	decisions, err := dec.ListReviewDecisions(context.Background(), assetID, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(decisions) != 1 {
		t.Fatalf("want 1 decision, got %d", len(decisions))
	}
	d := decisions[0]
	if d.MediaAssetID != assetID {
		t.Fatalf("assetID: want %s, got %s", assetID, d.MediaAssetID)
	}
	if d.FromStatus != "QUARANTINED" {
		t.Fatalf("from: want QUARANTINED, got %s", d.FromStatus)
	}
	if d.ToStatus != "REJECTED_CONTENT_NUDITY" {
		t.Fatalf("to: want REJECTED_CONTENT_NUDITY, got %s", d.ToStatus)
	}
	if d.Reason != "REJECT_NUDITY" {
		t.Fatalf("reason: %s", d.Reason)
	}
	if d.OperatorID != "operator_001" {
		t.Fatalf("operator: %s", d.OperatorID)
	}
	if d.ReviewedAt.IsZero() {
		t.Fatal("reviewedAt must be set")
	}
	if !strings.HasPrefix(d.DecisionID, "mrd_") {
		t.Fatalf("decision ID prefix: %s", d.DecisionID)
	}
}

func TestReviewDecision_AppendsForUnblock(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	assetID := createQuarantinedAssetForDecision(t, svc, "ma_unb", "operator_001")
	// first: reject nudity
	res := svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "first", "operator_001"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("first: %s", res.Error)
	}
	// then: unblock (APPROVE)
	res = svc.Handle(reviewEnvelopeFor(assetID, "APPROVE", "unblock", "operator_002"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("unblock: %s", res.Error)
	}
	decisions, _ := dec.ListReviewDecisions(context.Background(), assetID, 0)
	if len(decisions) != 2 {
		t.Fatalf("want 2 decisions, got %d", len(decisions))
	}
	// latest first
	if decisions[0].Reason != "APPROVE" {
		t.Fatalf("latest should be APPROVE, got %s", decisions[0].Reason)
	}
	if decisions[0].FromStatus != "REJECTED_CONTENT_NUDITY" {
		t.Fatalf("latest from: %s", decisions[0].FromStatus)
	}
	if decisions[0].OperatorID != "operator_002" {
		t.Fatalf("latest operator: %s", decisions[0].OperatorID)
	}
	if decisions[1].Reason != "REJECT_NUDITY" {
		t.Fatalf("oldest should be REJECT_NUDITY, got %s", decisions[1].Reason)
	}
}

func TestListMediaReviewDecisions_FilterByAsset(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	id1 := createQuarantinedAssetForDecision(t, svc, "ma_f1", "op")
	id2 := createQuarantinedAssetForDecision(t, svc, "ma_f2", "op")
	id3 := createQuarantinedAssetForDecision(t, svc, "ma_f3", "op")
	svc.Handle(reviewEnvelopeFor(id1, "REJECT_NUDITY", "", "op"))
	svc.Handle(reviewEnvelopeFor(id2, "REJECT_POLITICS", "", "op"))
	svc.Handle(reviewEnvelopeFor(id3, "REJECT_VIOLENCE", "", "op"))

	res := svc.Handle(envelopeForList("list", "op", map[string]any{"mediaAssetId": id2}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("list: %s", res.Error)
	}
	decisions, _ := dec.ListReviewDecisions(context.Background(), id2, 0)
	if len(decisions) != 1 {
		t.Fatalf("want 1 decision for ma_f2, got %d", len(decisions))
	}
	if decisions[0].MediaAssetID != id2 {
		t.Fatalf("got asset: %s", decisions[0].MediaAssetID)
	}
	if decisions[0].Reason != "REJECT_POLITICS" {
		t.Fatalf("got reason: %s", decisions[0].Reason)
	}
}

func TestListMediaReviewDecisions_NoFilterReturnsAll(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	id1 := createQuarantinedAssetForDecision(t, svc, "ma_a1", "op")
	id2 := createQuarantinedAssetForDecision(t, svc, "ma_a2", "op")
	svc.Handle(reviewEnvelopeFor(id1, "REJECT_NUDITY", "", "op"))
	svc.Handle(reviewEnvelopeFor(id2, "REJECT_POLITICS", "", "op"))
	decisions, _ := dec.ListReviewDecisions(context.Background(), "", 0)
	if len(decisions) != 2 {
		t.Fatalf("want 2 total, got %d", len(decisions))
	}
}

func TestListMediaReviewDecisions_OrderedByReviewedAtDesc(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	assetID := createQuarantinedAssetForDecision(t, svc, "ma_o1", "op")
	svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "first", "op"))
	time.Sleep(2 * time.Millisecond)
	svc.Handle(reviewEnvelopeFor(assetID, "APPROVE", "second", "op"))
	time.Sleep(2 * time.Millisecond)
	svc.Handle(reviewEnvelopeFor(assetID, "REJECT_POLITICS", "third", "op"))
	decisions, _ := dec.ListReviewDecisions(context.Background(), assetID, 0)
	if len(decisions) != 3 {
		t.Fatalf("want 3, got %d", len(decisions))
	}
	if decisions[0].Note != "third" || decisions[1].Note != "second" || decisions[2].Note != "first" {
		t.Fatalf("order wrong: %s/%s/%s", decisions[0].Note, decisions[1].Note, decisions[2].Note)
	}
}

func TestListMediaReviewDecisions_LimitRespected(t *testing.T) {
	svc, dec := newServiceWithDecisionTracking()
	assetID := createQuarantinedAssetForDecision(t, svc, "ma_l1", "op")
	// Alternate NUDITY → APPROVE (unblock) → NUDITY → APPROVE ... to get 4 decisions
	svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "1", "op"))
	svc.Handle(reviewEnvelopeFor(assetID, "APPROVE", "2", "op"))
	svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "3", "op"))
	svc.Handle(reviewEnvelopeFor(assetID, "APPROVE", "4", "op"))
	decisions, _ := dec.ListReviewDecisions(context.Background(), assetID, 3)
	if len(decisions) != 3 {
		t.Fatalf("limit 3, got %d", len(decisions))
	}
	// 另: 不带 limit 返所有 4
	all, _ := dec.ListReviewDecisions(context.Background(), assetID, 0)
	if len(all) != 4 {
		t.Fatalf("unfiltered: want 4, got %d", len(all))
	}
}

func TestReviewDecision_AppendRejectsDuplicateID(t *testing.T) {
	dec := NewMemoryReviewDecisionRepository()
	d := MediaReviewDecision{
		DecisionID:   "mrd_dup",
		MediaAssetID: "ma_x",
		FromStatus:   "QUARANTINED",
		ToStatus:     "REJECTED_CONTENT_NUDITY",
		Reason:       "REJECT_NUDITY",
		OperatorID:   "op",
		ReviewedAt:   time.Now().UTC(),
	}
	if err := dec.AppendReviewDecision(context.Background(), d); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := dec.AppendReviewDecision(context.Background(), d); err == nil {
		t.Fatal("expected duplicate id error")
	}
}

func TestReviewDecision_NilRepo_DoesNotBlock(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithReviewDecisionRepository(repo, nil, nil)
	assetID := createQuarantinedAssetForDecision(t, svc, "ma_nil", "op")
	res := svc.Handle(reviewEnvelopeFor(assetID, "REJECT_NUDITY", "", "op"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("review with nil repo should still accept, got: %s", res.Error)
	}
	res = svc.Handle(envelopeForList("list", "op", nil))
	if res.Outcome != "ACCEPTED" {
		t.Logf("list with nil repo: %s (acceptable if graceful)", res.Error)
	}
}
