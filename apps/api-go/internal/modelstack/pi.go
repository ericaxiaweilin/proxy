package modelstack

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// PiProvider is a development model-stack adapter backed by Pi's local
// provider registry. Domain services still submit only task IDs; provider,
// model and credentials remain inside this adapter boundary.
type PiProvider struct {
	provider string
	model    string
	// visionModel 处理 *vision* 任务（看图）。默认模型常常是纯文本模型 —— 把图发给它，
	// 它要么报错、要么看不见图却照样编一段描述。AI-MANAGE-015：同一 provider 里挑一个声明
	// input 含 image 的模型（MODELSTACK_PI_VISION_MODEL 可指定）；没有就为空，vision 任务
	// 直接报 ErrTaskNotRoutable，不假装看过图。
	visionModel string
	gateway     *GatewayClient
}

type piSettings struct {
	DefaultProvider string `json:"defaultProvider"`
	DefaultModel    string `json:"defaultModel"`
}

type piModels struct {
	Providers map[string]struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
		Models  []struct {
			ID    string   `json:"id"`
			Input []string `json:"input"`
		} `json:"models"`
	} `json:"providers"`
}

func NewFromPiConfig(modelsPath, settingsPath string) (*PiProvider, error) {
	modelsRaw, err := os.ReadFile(modelsPath)
	if err != nil {
		return nil, fmt.Errorf("read pi models config: %w", err)
	}
	settingsRaw, err := os.ReadFile(settingsPath)
	if err != nil {
		return nil, fmt.Errorf("read pi settings config: %w", err)
	}
	var registry piModels
	var settings piSettings
	if err := json.Unmarshal(modelsRaw, &registry); err != nil {
		return nil, fmt.Errorf("decode pi models config: %w", err)
	}
	if err := json.Unmarshal(settingsRaw, &settings); err != nil {
		return nil, fmt.Errorf("decode pi settings config: %w", err)
	}
	provider, ok := registry.Providers[settings.DefaultProvider]
	if !ok || strings.TrimSpace(provider.BaseURL) == "" {
		return nil, fmt.Errorf("%w: pi default provider is incomplete", ErrUnconfigured)
	}
	apiKey := resolvePiAPIKey(settings.DefaultProvider)
	if apiKey == "" {
		apiKey = strings.TrimSpace(provider.APIKey)
	}
	if apiKey == "" {
		return nil, fmt.Errorf("%w: pi default provider credential is unavailable", ErrUnconfigured)
	}
	model := strings.TrimSpace(settings.DefaultModel)
	if model == "" && len(provider.Models) > 0 {
		model = strings.TrimSpace(provider.Models[0].ID)
	}
	if model == "" {
		return nil, fmt.Errorf("%w: pi default model is empty", ErrUnconfigured)
	}
	visionModel := strings.TrimSpace(os.Getenv("MODELSTACK_PI_VISION_MODEL"))
	if visionModel == "" {
		for _, candidate := range provider.Models {
			for _, input := range candidate.Input {
				if input == "image" && strings.TrimSpace(candidate.ID) != "" {
					visionModel = strings.TrimSpace(candidate.ID)
					break
				}
			}
			if visionModel != "" {
				break
			}
		}
	}
	return &PiProvider{
		provider:    settings.DefaultProvider,
		model:       model,
		visionModel: visionModel,
		gateway:     NewGatewayClient(provider.BaseURL, apiKey),
	}, nil
}

// resolvePiAPIKey asks Pi's credential manager for the active provider key.
// This matters when models.json contains a stale catalog key while Pi has a
// refreshed credential in its own secure auth store. The key is kept only in
// memory and must never be logged.
func resolvePiAPIKey(provider string) string {
	piBinary, err := exec.LookPath("pi")
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, piBinary, "auth", "print-api-key", "--provider", provider).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func (p *PiProvider) Available() bool {
	return p != nil && p.gateway != nil && p.provider != "" && p.model != ""
}

func (p *PiProvider) Complete(ctx context.Context, taskID string, messages []ChatMessage) (Completion, error) {
	if !p.Available() {
		return Completion{}, ErrUnconfigured
	}
	if strings.TrimSpace(taskID) == "" || len(messages) == 0 {
		return Completion{}, fmt.Errorf("%w: empty task or messages", ErrTaskNotRoutable)
	}
	timeout := 90 * time.Second
	model := p.model
	if strings.Contains(taskID, "vision") {
		if p.visionModel == "" {
			return Completion{}, fmt.Errorf("%w: no image-capable model configured for %s", ErrTaskNotRoutable, taskID)
		}
		model = p.visionModel
		timeout = 60 * time.Second
	}
	result, err := p.gateway.Chat(ctx, model, taskID, messages, 2048, timeout)
	if err != nil {
		return Completion{}, err
	}
	return Completion{
		Content:      result.Content,
		TaskID:       taskID,
		Model:        result.Model,
		Provider:     p.provider,
		ModelOption:  model,
		PromptTokens: result.PromptTokens,
		OutputTokens: result.OutputTokens,
	}, nil
}

var _ Port = (*PiProvider)(nil)
