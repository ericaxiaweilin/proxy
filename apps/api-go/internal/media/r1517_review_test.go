// R15.17 — admin 手动 content review 路径 (nudity / politics / violence)
//
// 钉 8 个 tripwire:
//   1. ReviewMediaAsset 把 QUARANTINED 转到 REJECTED_CONTENT_NUDITY
//   2. ReviewMediaAsset 把 APPROVED 转到 REJECTED_CONTENT_POLITICS
//      (post-publish takedown)
//   3. ReviewMediaAsset unblock: REJECTED_CONTENT_VIOLENCE → APPROVED
//   4. ReviewMediaAsset REJECTED_TECHNICAL → _NUDITY 被拒
//      (技术拒不可转内容拒, 保护 audit trail)
//   5. ReviewMediaAsset UPLOADING 状态被拒 (资产未完成处理)
//   6. invalid reason string 拒
//   7. asset not found 拒
//   8. no-op 拒绝 (同状态)
//
// API 边界 (operator allowlist) 单独在 server_test.go / security_test.go
// 测; 这里只测 service 内部状态机。
package media

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func reviewEnvelopeFor(targetID, reason, note, principalID string) command.Envelope {
	return command.Envelope{
		CommandID:      "review_" + reason + "_" + targetID,
		CommandType:    "ReviewMediaAsset",
		CommandVersion: 1,
		Actor:          command.Actor{Type: "OPERATOR", ID: principalID},
		Principal:      command.Principal{Type: "OPERATOR", ID: principalID},
		Target:         command.Target{Type: "MediaAsset", ID: targetID},
		IdempotencyKey: "review_idem_" + reason + "_" + targetID,
		AuthContext:    map[string]any{"role": "OPERATOR"},
		Purpose:        "r1517-content-review",
		CorrelationID:  "review_corr_" + reason,
		RequestedAt:    "2026-08-28T00:00:00Z",
		Payload: map[string]any{
			"reason": reason,
			"note":   note,
		},
	}
}

func setupReviewAsset(t *testing.T, modStatus, procStatus string) (*Service, string) {
	t.Helper()
	repo := NewMemoryRepository()
	svc := NewWithDependencies(repo, nil)
	env := envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "IMAGE",
		"originalStorageKey": "r1517.jpg",
		"mimeType":           "image/jpeg",
		"width":              100,
		"height":             100,
	}, "")
	r := svc.Handle(env)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("createAsset: %s (%+v)", r.Outcome, r.Error)
	}
	var op struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &op); err != nil {
		t.Fatalf("parse op: %v (raw=%q)", err, r.OperationRef)
	}
	if op.MediaAssetID == "" {
		t.Fatalf("createAsset: no mediaAssetId in op %q", r.OperationRef)
	}
	// 改状态
	if modStatus != "UPLOADING" || procStatus != "UPLOADING" {
		asset, err := repo.GetAsset(t.Context(), op.MediaAssetID)
		if err != nil {
			t.Fatalf("GetAsset: %v", err)
		}
		asset.ModerationStatus = modStatus
		asset.ProcessingStatus = procStatus
		if err := repo.UpdateAsset(t.Context(), asset, "UPLOADING"); err != nil {
			t.Fatalf("UpdateAsset: %v", err)
		}
	}
	return svc, op.MediaAssetID
}

func TestReviewMediaAsset_Quarantined_To_Nudity(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "QUARANTINED", "READY")

	env := reviewEnvelopeFor(assetID, "REJECT_NUDITY", "test note", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", res.Outcome, res.Error)
	}
	asset, err := svc.repository.GetAsset(t.Context(), assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.ModerationStatus != "REJECTED_CONTENT_NUDITY" {
		t.Errorf("asset.ModerationStatus = %s, want REJECTED_CONTENT_NUDITY", asset.ModerationStatus)
	}
	if !strings.HasPrefix(asset.LastError, "content-review:REJECT_NUDITY:operator_001") {
		t.Errorf("LastError = %q, want content-review:REJECT_NUDITY:operator_001 prefix", asset.LastError)
	}
}

func TestReviewMediaAsset_Approved_To_Politics_Takedown(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "APPROVED", "READY")

	env := reviewEnvelopeFor(assetID, "REJECT_POLITICS", "post takedown", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", res.Outcome, res.Error)
	}
	asset, _ := svc.repository.GetAsset(t.Context(), assetID)
	if asset.ModerationStatus != "REJECTED_CONTENT_POLITICS" {
		t.Errorf("ModerationStatus = %s, want REJECTED_CONTENT_POLITICS", asset.ModerationStatus)
	}
}

func TestReviewMediaAsset_Unblock_Violence_To_Approved(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "REJECTED_CONTENT_VIOLENCE", "READY")

	env := reviewEnvelopeFor(assetID, "APPROVE", "manual unblock", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", res.Outcome, res.Error)
	}
	asset, _ := svc.repository.GetAsset(t.Context(), assetID)
	if asset.ModerationStatus != "APPROVED" {
		t.Errorf("ModerationStatus = %s, want APPROVED", asset.ModerationStatus)
	}
}

func TestReviewMediaAsset_Disallows_From_Rejected_Technical(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "REJECTED_TECHNICAL", "FAILED")

	env := reviewEnvelopeFor(assetID, "REJECT_NUDITY", "x", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", res.Outcome)
	}
	if errCode := errorCodeOf(res); errCode != "MEDIA_REVIEW_DISALLOWED" {
		t.Errorf("errorCode = %s, want MEDIA_REVIEW_DISALLOWED", errCode)
	}
}

func TestReviewMediaAsset_Disallows_Incomplete_Processing(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "QUARANTINED", "UPLOADING")

	env := reviewEnvelopeFor(assetID, "REJECT_NUDITY", "x", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", res.Outcome)
	}
}

func TestReviewMediaAsset_Rejects_Invalid_Reason(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "QUARANTINED", "READY")

	env := reviewEnvelopeFor(assetID, "BOGUS_REASON", "x", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", res.Outcome)
	}
	if errCode := errorCodeOf(res); errCode != "INVALID_REVIEW_REASON" {
		t.Errorf("errorCode = %s, want INVALID_REVIEW_REASON", errCode)
	}
}

func TestReviewMediaAsset_Rejects_NotFound(t *testing.T) {
	svc := NewWithDependencies(NewMemoryRepository(), nil)

	env := reviewEnvelopeFor("ma_does_not_exist", "REJECT_NUDITY", "x", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", res.Outcome)
	}
	if errCode := errorCodeOf(res); errCode != "MEDIA_ASSET_NOT_FOUND" {
		t.Errorf("errorCode = %s, want MEDIA_ASSET_NOT_FOUND", errCode)
	}
}

func TestReviewMediaAsset_Rejects_Noop(t *testing.T) {
	svc, assetID := setupReviewAsset(t, "REJECTED_CONTENT_NUDITY", "READY")

	env := reviewEnvelopeFor(assetID, "REJECT_NUDITY", "x", "operator_001")
	res := svc.Handle(env)
	if res.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", res.Outcome)
	}
	if errCode := errorCodeOf(res); errCode != "MEDIA_REVIEW_NOOP" {
		t.Errorf("errorCode = %s, want MEDIA_REVIEW_NOOP", errCode)
	}
}

func errorCodeOf(r command.Result) string {
	if r.Error == nil {
		return ""
	}
	return r.Error.ErrorCode
}
