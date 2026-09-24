package media

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
)

// LC-06 / LC-07 必须挡在「实际跑的那条路」上。
//
// 2026-09-21：这两道判定原先只写在 markReady 里，而 markReady 是 operator
// 专属命令（API 边界限定；PROXY_OPERATOR_PRINCIPALS 未配置时整条被拒）。
// 真正把资产推到 READY 的是 ProcessAssetNow —— 它从不调用那段判定。
//
// 实测（真库 + 真 repository，改动前）：
//
//	before worker: status=PROCESSING source=AI_PERSONA consent=""
//	after  worker: status=READY      moderation=APPROVED consent=""
//
// 也就是「挂了 USER_TWIN 分身、没有任何 likeness 同意的 AI 资产」被正常发布。
// 本组用例把这条路径钉死，并保留一条反向用例，防止闸门被搬到 worker 上之后
// 连普通上传一起拦掉。
//
// 用 MemoryRepository 是有意的：这里测的是 service 层的闸门，与 repository
// 如何存储无关 —— 也因此这组用例不需要数据库，不会以 SKIP 的形式蒙过门禁。

// driveToReady 已经在 lc06_lc07_test.go 里定义（把资产推到 PROCESSING）。

func TestLC07WorkerPathRefusesAIPersonaWithoutConsent(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)

	persona, err := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "user_worker_gate_1",
		DisplayName: "Alice Twin",
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatal(err)
	}
	// 故意不 GrantConsent。
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/worker_gate.mp4",
		"mimeType":           "video/mp4",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          "user_worker_gate_1",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/worker_gate.mp4")

	// 走真实发布路径：worker 处理这条资产。
	if err := s.ProcessAssetNow(context.Background(), view.MediaAssetID); err != nil {
		t.Fatalf("确定性拒绝不该返回错误（那会触发 worker 重试），got %v", err)
	}

	asset, _ := repo.GetAsset(t.Context(), view.MediaAssetID)
	if asset.ProcessingStatus != "FAILED" {
		t.Fatalf("worker 不得把无同意的 AI_PERSONA 资产推成 READY，got status=%q moderation=%q",
			asset.ProcessingStatus, asset.ModerationStatus)
	}
	if asset.ModerationStatus == "APPROVED" {
		t.Fatalf("被闸门拒绝的资产不得是 APPROVED，got %q", asset.ModerationStatus)
	}
	if asset.LastError != "AI_LIKENESS_CONSENT_MISSING" {
		t.Fatalf("LastError 必须带上精确原因，got %q", asset.LastError)
	}
}

func TestLC06WorkerPathRefusesUnknownLabel(t *testing.T) {
	s, repo := newServiceWithMemory()
	now := time.Now().UTC()
	// UNKNOWN 只能从非 createAsset 的写入路径出现（边界会把非法值在
	// CreateMediaAsset 上就拒掉），所以直接落一条。
	asset := MediaAsset{
		MediaAssetID:       "ma_worker_unknown",
		OwnerPrincipalType: "INDIVIDUAL",
		OwnerPrincipalID:   "user_worker_gate_2",
		MediaType:          "VIDEO",
		OriginalStorageKey: "uploads/worker_unknown.mp4",
		ProcessingStatus:   "PROCESSING",
		ModerationStatus:   "QUARANTINED",
		VisibilityClass:    "OWNER_ONLY",
		AIGenerationSource: "UNKNOWN",
		AIGenerated:        true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := repo.CreateAsset(t.Context(), asset); err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessAssetNow(context.Background(), asset.MediaAssetID); err != nil {
		t.Fatalf("确定性拒绝不该返回错误，got %v", err)
	}
	got, _ := repo.GetAsset(t.Context(), asset.MediaAssetID)
	if got.ProcessingStatus != "FAILED" || got.LastError != "AI_LABEL_MISSING" {
		t.Fatalf("未标注的资产不得被 worker 发布：status=%q lastError=%q", got.ProcessingStatus, got.LastError)
	}
}

// 反向用例：闸门搬到 worker 上之后，普通上传必须照常发布。
// 没有这一条，修复可以退化成「凡 AI 一律拒绝」甚至「凡上传一律拒绝」。
func TestWorkerPathStillPublishesPlainUploadAndCreativePersona(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)

	// (a) 普通上传
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/plain.mp4",
		"mimeType":           "video/mp4",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create plain: %s (%+v)", r.Outcome, r.Error)
	}
	var plain struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &plain)
	driveToReady(t, s, repo, plain.MediaAssetID, "uploads/plain.mp4")
	if err := s.ProcessAssetNow(context.Background(), plain.MediaAssetID); err != nil {
		t.Fatalf("plain upload must process: %v", err)
	}
	plainAsset, _ := repo.GetAsset(t.Context(), plain.MediaAssetID)
	if plainAsset.ProcessingStatus != "READY" {
		t.Fatalf("普通上传必须能发布，got %q (lastError=%q)", plainAsset.ProcessingStatus, plainAsset.LastError)
	}

	// (b) CREATIVE 分身：没有真人 likeness，不需要同意
	persona, err := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "business_worker_gate",
		DisplayName: "Concierge",
		PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatal(err)
	}
	r = s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/creative.mp4",
		"mimeType":           "video/mp4",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          "business_worker_gate",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create creative: %s (%+v)", r.Outcome, r.Error)
	}
	var creative struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &creative)
	driveToReady(t, s, repo, creative.MediaAssetID, "uploads/creative.mp4")
	if err := s.ProcessAssetNow(context.Background(), creative.MediaAssetID); err != nil {
		t.Fatalf("creative persona asset must process: %v", err)
	}
	creativeAsset, _ := repo.GetAsset(t.Context(), creative.MediaAssetID)
	if creativeAsset.ProcessingStatus != "READY" {
		t.Fatalf("CREATIVE 分身资产必须能发布，got %q (lastError=%q)", creativeAsset.ProcessingStatus, creativeAsset.LastError)
	}
	if creativeAsset.LikenessConsentID != "" {
		t.Fatalf("CREATIVE 不得盖 consent id，got %q", creativeAsset.LikenessConsentID)
	}
}
