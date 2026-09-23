package identity

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

var ErrAiEngineSettingsNotFound = errors.New("ai engine settings not found")

// AiEngineSettings — 我的 → 账户 → AI 管理的服务端事实源（AI-MANAGE-002）。
//
// 暂停与对话权限必须落在服务端：客户端开关挡不住 curl，原型里那颗
// pauseBtn 本地翻转等于没做。出图/动态偏好是平台路由与调度的输入，
// 不是客户端直绑 provider（架构约束：业务客户端只提交意图）。
type AiEngineSettings struct {
	UserAccountID string `json:"userAccountId"`
	Paused        bool   `json:"paused"`

	ChatTone        string `json:"chatTone"`
	ChatReplyLength string `json:"chatReplyLength"`
	ChatEmoji       string `json:"chatEmoji"`
	ChatRhythm      string `json:"chatRhythm"`
	ChatPermission  string `json:"chatPermission"`

	ImageScene         string   `json:"imageScene"`
	ImagePose          string   `json:"imagePose"`
	ImageCamera        string   `json:"imageCamera"`
	ImagePrompt        string   `json:"imagePrompt"`
	ImagePromptHistory []string `json:"imagePromptHistory"`
	ImageAspect        string   `json:"imageAspect"`
	ImageQuality       string   `json:"imageQuality"`
	ImageVendorPref    string   `json:"imageVendorPref"`
	ImageModelPref     string   `json:"imageModelPref"`

	PostPace       string   `json:"postPace"`
	PostTopics     []string `json:"postTopics"`
	PostPermission string   `json:"postPermission"`

	Version int `json:"version"`
}

// DefaultAiEngineSettings 与迁移 119 的 DEFAULT 一致 —— 没存过行的用户
// 读出来是同一套默认，客户端不必区分「不存在」和「全是默认」。
func DefaultAiEngineSettings(userID string) AiEngineSettings {
	return AiEngineSettings{
		UserAccountID:     userID,
		Paused:            false,
		ChatTone:          "warm",
		ChatReplyLength:   "short",
		ChatEmoji:         "sometimes",
		ChatRhythm:        "human_3_5",
		ChatPermission:    "confirm",
		ImageScene:        "cafe",
		ImagePose:         "",
		ImageCamera:       "static",
		ImagePrompt:       "",
		ImagePromptHistory: []string{},
		ImageAspect:       "3:4",
		ImageQuality:      "1536",
		ImageVendorPref:   "platform_default",
		ImageModelPref:    "",
		PostPace:          "every_3_days",
		PostTopics:        []string{},
		PostPermission:    "off",
		Version:           0,
	}
}

type AiEngineSettingsRepository interface {
	GetAiEngineSettings(ctx context.Context, userID string) (AiEngineSettings, error)
	UpsertAiEngineSettings(ctx context.Context, s AiEngineSettings) (AiEngineSettings, error)
}

// AiTokenUsage 是某用户某自然月的累计推理用量。
type AiTokenUsage struct {
	UserAccountID string `json:"userAccountId"`
	Period        string `json:"period"` // YYYY-MM
	PromptTokens  int    `json:"promptTokens"`
	OutputTokens  int    `json:"outputTokens"`
}

func (u AiTokenUsage) TotalTokens() int { return u.PromptTokens + u.OutputTokens }

type AiTokenUsageRepository interface {
	// AddAiTokens 原子累加当月用量；userID/period 由服务端盖章。
	AddAiTokens(ctx context.Context, userID, period string, prompt, output int) error
	// GetAiTokens 读某月用量；没有行返回零值 + nil（不是错误）。
	GetAiTokens(ctx context.Context, userID, period string) (AiTokenUsage, error)
}

// CurrentTokenPeriod 返回计量周期键（UTC 月，与服务端时钟一致）。
func CurrentTokenPeriod(now time.Time) string {
	return now.UTC().Format("2006-01")
}

func (s *Service) aiSettingsRepo() AiEngineSettingsRepository {
	return s.repository.(AiEngineSettingsRepository)
}

func (s *Service) aiUsageRepo() AiTokenUsageRepository {
	return s.repository.(AiTokenUsageRepository)
}

func (s *Service) getAiEngineSettings(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "AI_ENGINE_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.ai_engine_forbidden", nil)
	}
	settings, err := s.aiSettingsRepo().GetAiEngineSettings(ctx, e.Actor.ID)
	exists := true
	if errors.Is(err, ErrAiEngineSettingsNotFound) {
		exists = false
		settings = DefaultAiEngineSettings(e.Actor.ID)
	} else if err != nil {
		return command.Rejected(e, "AI_ENGINE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.ai_engine_read_failed", nil)
	}
	usage, err := s.aiUsageRepo().GetAiTokens(ctx, e.Actor.ID, CurrentTokenPeriod(s.now()))
	if err != nil {
		return command.Rejected(e, "AI_ENGINE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "identity.ai_engine_read_failed", nil)
	}
	payload, _ := json.Marshal(map[string]any{
		"exists":    exists,
		"settings":  settings,
		"usage":     usage,
		"period":    usage.Period,
	})
	result := command.Accepted(e, "AiEngineSettings", e.Actor.ID, settings.Version, "READ", nil)
	result.OperationRef = string(payload)
	return result
}

func (s *Service) updateAiEngineSettings(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "AI_ENGINE_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "identity.ai_engine_forbidden", nil)
	}
	var incoming AiEngineSettings
	if !decode(e.Payload, &incoming) {
		return command.Rejected(e, "AI_ENGINE_INVALID", "VALIDATION", "AFTER_USER_ACTION", "identity.ai_engine_invalid", nil)
	}
	// 服务端盖章 owner：客户端传不了别人的 id。
	incoming.UserAccountID = e.Actor.ID
	// 先补默认再校验：部分字段没传 = 用迁移 DEFAULT，不是 INVALID。
	normalizeAiEngineSettings(&incoming)
	if err := validateAiEngineSettings(incoming); err != nil {
		return command.Rejected(e, "AI_ENGINE_INVALID", "VALIDATION", "AFTER_USER_ACTION", "identity.ai_engine_invalid", nil)
	}
	saved, err := s.aiSettingsRepo().UpsertAiEngineSettings(ctx, incoming)
	if err != nil {
		return command.Rejected(e, "AI_ENGINE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "identity.ai_engine_write_failed", nil)
	}
	payload, _ := json.Marshal(map[string]any{"settings": saved})
	result := command.Accepted(e, "AiEngineSettings", e.Actor.ID, saved.Version, "UPDATED", nil)
	result.OperationRef = string(payload)
	return result
}

func validateAiEngineSettings(s AiEngineSettings) error {
	oneOf := func(v string, allowed ...string) bool {
		for _, a := range allowed {
			if v == a {
				return true
			}
		}
		return false
	}
	if !oneOf(s.ChatTone, "cool", "warm", "softer", "lively", "pro") {
		return errors.New("chatTone")
	}
	if !oneOf(s.ChatReplyLength, "xshort", "short", "medium", "long") {
		return errors.New("chatReplyLength")
	}
	if !oneOf(s.ChatEmoji, "never", "sometimes", "often", "every") {
		return errors.New("chatEmoji")
	}
	if !oneOf(s.ChatRhythm, "instant", "human_3_5", "human_10_30", "random") {
		return errors.New("chatRhythm")
	}
	if !oneOf(s.ChatPermission, "off", "confirm", "auto") {
		return errors.New("chatPermission")
	}
	if !oneOf(s.PostPace, "daily", "every_3_days", "weekly") {
		return errors.New("postPace")
	}
	if !oneOf(s.PostPermission, "off", "confirm", "auto") {
		return errors.New("postPermission")
	}
	if !oneOf(s.ImageAspect, "3:4", "1:1", "16:9") {
		return errors.New("imageAspect")
	}
	if !oneOf(s.ImageQuality, "1024", "1536", "2048") {
		return errors.New("imageQuality")
	}
	if len(s.ImagePrompt) > 4000 || len(s.ImagePromptHistory) > 20 || len(s.PostTopics) > 20 {
		return errors.New("oversized")
	}
	for _, topic := range s.PostTopics {
		if len(topic) > 40 {
			return errors.New("topic")
		}
	}
	for _, h := range s.ImagePromptHistory {
		if len(h) > 4000 {
			return errors.New("promptHistory")
		}
	}
	if len(s.ImageScene) > 40 || len(s.ImagePose) > 40 || len(s.ImageCamera) > 40 ||
		len(s.ImageVendorPref) > 64 || len(s.ImageModelPref) > 64 {
		return errors.New("imageRef")
	}
	return nil
}

func normalizeAiEngineSettings(s *AiEngineSettings) {
	if s.ImagePromptHistory == nil {
		s.ImagePromptHistory = []string{}
	}
	if s.PostTopics == nil {
		s.PostTopics = []string{}
	}
	if s.ImageScene == "" {
		s.ImageScene = "cafe"
	}
	if s.ImageAspect == "" {
		s.ImageAspect = "3:4"
	}
	if s.ImageQuality == "" {
		s.ImageQuality = "1536"
	}
	if s.ImageVendorPref == "" {
		s.ImageVendorPref = "platform_default"
	}
	if s.ChatTone == "" {
		s.ChatTone = "warm"
	}
	if s.ChatReplyLength == "" {
		s.ChatReplyLength = "short"
	}
	if s.ChatEmoji == "" {
		s.ChatEmoji = "sometimes"
	}
	if s.ChatRhythm == "" {
		s.ChatRhythm = "human_3_5"
	}
	if s.ChatPermission == "" {
		s.ChatPermission = "confirm"
	}
	if s.PostPace == "" {
		s.PostPace = "every_3_days"
	}
	if s.PostPermission == "" {
		s.PostPermission = "off"
	}
}

// GetAiEngineChatState 是会话域注入用的公开读取面（AI-MANAGE-002）。
// 没存过行 = 默认值（非暂停、confirm），与迁移 DEFAULT 一致；仓错误原样
// 返回，由调用方决定 fail-open/fail-closed。
// GetAiEngineChatState 读会话侧要用的那一片设置（暂停 / 对话权限 / 风格）。
// AI-MANAGE-003：会话侧用它判定**被代表的人**（私聊里收消息的真人）的 AI 要不要、怎么替 TA 回。
// 没存过设置 = 默认（与迁移 119 的 DEFAULT 一致）。
func (s *Service) GetAiEngineChatState(ctx context.Context, userID string) (AiEngineSettings, error) {
	if strings.TrimSpace(userID) == "" {
		return DefaultAiEngineSettings(userID), nil
	}
	settings, err := s.aiSettingsRepo().GetAiEngineSettings(ctx, userID)
	if errors.Is(err, ErrAiEngineSettingsNotFound) {
		return DefaultAiEngineSettings(userID), nil
	}
	if err != nil {
		return AiEngineSettings{}, err
	}
	return settings, nil
}

// RecordAiTokens 供 modelstack 计量装饰器调用：userID 空 = 归属不了用户，跳过
// （宁可少记，不可记到别人头上）。period 由服务端时钟决定。
func (s *Service) RecordAiTokens(ctx context.Context, userID string, prompt, output int) {
	if userID == "" || prompt < 0 || output < 0 {
		return
	}
	if prompt == 0 && output == 0 {
		return
	}
	if err := s.aiUsageRepo().AddAiTokens(ctx, userID, CurrentTokenPeriod(s.now()), prompt, output); err != nil {
		// 计量失败不打断推理主路径 —— 用量页会短暂偏少，下次补上。
		return
	}
}

// now 用 identity 服务的时钟（测试可控）。
func (s *Service) now() time.Time {
	if s.clock != nil {
		return s.clock.Now()
	}
	return time.Now()
}
