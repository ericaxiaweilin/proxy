package identity

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/clock"
)

func aiEngineEnvelope(commandType, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "cmd_ai_engine", CommandType: commandType, Actor: command.Actor{Type: "USER", ID: actor}, CorrelationID: "corr_ai_engine", Payload: payload}
}

func TestAiEngineSettingsRoundTripUsesActorAsOwnerAndDefaultsWhenMissing(t *testing.T) {
	svc := New(nil)

	// 没存过行：exists=false，但设置字段是与迁移 DEFAULT 一致的默认值 ——
	// 客户端不必区分「不存在」和「全是默认」。
	readMissing := svc.Handle(aiEngineEnvelope("GetAiEngineSettings", "user_1", nil))
	if readMissing.Outcome != "ACCEPTED" {
		t.Fatalf("unexpected missing read: %#v", readMissing)
	}
	var missing struct {
		Exists   bool              `json:"exists"`
		Settings AiEngineSettings  `json:"settings"`
		Usage    AiTokenUsage      `json:"usage"`
		Period   string            `json:"period"`
	}
	if err := json.Unmarshal([]byte(readMissing.OperationRef), &missing); err != nil {
		t.Fatal(err)
	}
	if missing.Exists {
		t.Fatalf("missing record must report exists=false, got %#v", missing)
	}
	if missing.Settings.Paused || missing.Settings.ChatPermission != "confirm" || missing.Settings.ImageAspect != "3:4" {
		t.Fatalf("defaults must match migration DEFAULTs: %#v", missing.Settings)
	}
	if missing.Usage.PromptTokens != 0 || missing.Usage.OutputTokens != 0 {
		t.Fatalf("missing usage must be zeros, got %#v", missing.Usage)
	}

	// 客户端伪造 userAccountId 无效：owner 永远是 actor。
	write := svc.Handle(aiEngineEnvelope("UpdateAiEngineSettings", "user_1", map[string]any{
		"userAccountId":  "user_2",
		"paused":         true,
		"chatTone":       "cool",
		"chatPermission": "off",
		"postPermission": "auto",
		"imageAspect":    "16:9",
	}))
	if write.Outcome != "ACCEPTED" || write.Aggregate == nil || write.Aggregate.ID != "user_1" || write.Aggregate.Version != 1 {
		t.Fatalf("unexpected write: %#v", write)
	}

	read := svc.Handle(aiEngineEnvelope("GetAiEngineSettings", "user_1", nil))
	var body struct {
		Exists   bool             `json:"exists"`
		Settings AiEngineSettings `json:"settings"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Exists || !body.Settings.Paused || body.Settings.ChatPermission != "off" || body.Settings.ChatTone != "cool" || body.Settings.PostPermission != "auto" || body.Settings.ImageAspect != "16:9" {
		t.Fatalf("unexpected settings after write: %#v", body.Settings)
	}
	if body.Settings.UserAccountID != "user_1" {
		t.Fatalf("owner must be actor, got %q", body.Settings.UserAccountID)
	}
}

func TestAiEngineSettingsRejectsAnonymousActorAndInvalidEnums(t *testing.T) {
	svc := New(nil)
	anonymous := aiEngineEnvelope("GetAiEngineSettings", "", nil)
	anonymous.Actor.Type = "ANONYMOUS"
	if got := svc.Handle(anonymous); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "AI_ENGINE_FORBIDDEN" {
		t.Fatalf("unexpected anonymous result: %#v", got)
	}
	if got := svc.Handle(aiEngineEnvelope("UpdateAiEngineSettings", "user_1", map[string]any{"chatPermission": "sometimes"})); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "AI_ENGINE_INVALID" {
		t.Fatalf("invalid enum must reject: %#v", got)
	}
	if got := svc.Handle(aiEngineEnvelope("UpdateAiEngineSettings", "user_1", map[string]any{"imagePrompt": string(make([]byte, 4001))})); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "AI_ENGINE_INVALID" {
		t.Fatalf("oversized prompt must reject: %#v", got)
	}
}

func TestAiEnginePauseAndPermissionGateConversationState(t *testing.T) {
	svc := New(nil)
	state, err := svc.GetAiEngineChatState(t.Context(), "user_missing")
	if err != nil || state.Paused || state.ChatPermission != "confirm" || state.ChatTone != "warm" {
		t.Fatalf("missing row must read as defaults: %+v err=%v", state, err)
	}

	if got := svc.Handle(aiEngineEnvelope("UpdateAiEngineSettings", "user_1", map[string]any{"paused": true, "chatPermission": "off", "chatTone": "lively", "chatEmoji": "never"})); got.Outcome != "ACCEPTED" {
		t.Fatalf("pause write: %#v", got)
	}
	state, err = svc.GetAiEngineChatState(t.Context(), "user_1")
	if err != nil || !state.Paused || state.ChatPermission != "off" {
		t.Fatalf("paused off must gate conversation: %+v err=%v", state, err)
	}
	// AI-MANAGE-003：风格也要带给会话侧（代回复按 owner 的语气 / emoji 说话）。
	if state.ChatTone != "lively" || state.ChatEmoji != "never" {
		t.Fatalf("style must reach the conversation side: %+v", state)
	}
}

func TestAiTokenUsageAccumulatesPerMonth(t *testing.T) {
	svc := NewWithRepositoryAndClock(NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)))
	svc.RecordAiTokens(t.Context(), "user_1", 10, 5)
	svc.RecordAiTokens(t.Context(), "user_1", 3, 2)
	svc.RecordAiTokens(t.Context(), "user_other", 100, 50)
	svc.RecordAiTokens(t.Context(), "", 99, 99) // 归属不了 → 跳过

	usage, err := svc.aiUsageRepo().GetAiTokens(t.Context(), "user_1", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if usage.PromptTokens != 13 || usage.OutputTokens != 7 || usage.Period != "2026-09" {
		t.Fatalf("unexpected usage: %#v", usage)
	}
	other, err := svc.aiUsageRepo().GetAiTokens(t.Context(), "user_other", "2026-09")
	if err != nil || other.PromptTokens != 100 {
		t.Fatalf("users must not share meters: %#v err=%v", other, err)
	}
	// Get 侧：没有行返回零值 + period 键（不是错误）。
	empty, err := svc.aiUsageRepo().GetAiTokens(t.Context(), "user_none", "2026-09")
	if err != nil || empty.Period != "2026-09" || empty.TotalTokens() != 0 {
		t.Fatalf("missing usage must be empty period row: %#v err=%v", empty, err)
	}
}

func TestAiEngineEraseWipesSettingsAndUsage(t *testing.T) {
	repo := NewMemoryRepository(nil)
	svc := NewWithRepository(repo)
	if got := svc.Handle(aiEngineEnvelope("UpdateAiEngineSettings", "user_1", map[string]any{"paused": true})); got.Outcome != "ACCEPTED" {
		t.Fatalf("seed settings: %#v", got)
	}
	svc.RecordAiTokens(t.Context(), "user_1", 7, 3)
	receipt, err := repo.ErasePersonalData(t.Context(), "user_1")
	if err != nil {
		t.Fatal(err)
	}
	if receipt.AiEngineSettings != 1 || receipt.AiTokenUsage != 1 {
		t.Fatalf("erase receipt must count AI rows: %#v", receipt)
	}
	if _, err := repo.GetAiEngineSettings(t.Context(), "user_1"); err == nil {
		t.Fatal("settings must be gone after erase")
	}
	usage, err := repo.GetAiTokens(t.Context(), "user_1", "2026-09")
	if err != nil || usage.TotalTokens() != 0 {
		t.Fatalf("token usage must be gone after erase: %#v err=%v", usage, err)
	}
}
