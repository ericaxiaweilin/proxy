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
	gateway  *GatewayClient
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
			ID string `json:"id"`
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
	return &PiProvider{
		provider: settings.DefaultProvider,
		model:    model,
		gateway:  NewGatewayClient(provider.BaseURL, apiKey),
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
	result, err := p.gateway.Chat(ctx, p.model, taskID, messages, 2048, 90*time.Second)
	if err != nil {
		return Completion{}, err
	}
	return Completion{
		Content:      result.Content,
		TaskID:       taskID,
		Model:        result.Model,
		Provider:     p.provider,
		ModelOption:  p.model,
		PromptTokens: result.PromptTokens,
		OutputTokens: result.OutputTokens,
	}, nil
}

var _ Port = (*PiProvider)(nil)
