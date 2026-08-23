package modelstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GatewayClient 调用模型底座运行时网关（OpenAI 兼容 chat/completions 契约）。
// 网关地址与凭证由部署配置注入，业务侧不持有 Provider 原始密钥语义，
// 只使用底座下发的统一网关凭证。
type GatewayClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewGatewayClient(baseURL, apiKey string) *GatewayClient {
	return &GatewayClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		httpClient: &http.Client{},
	}
}

type gatewayChatRequest struct {
	Model          string        `json:"model"`
	Messages       []ChatMessage `json:"messages"`
	Stream         bool          `json:"stream"`
	MaxTokens      int           `json:"max_tokens,omitempty"`
	BusinessTaskID string        `json:"business_task_id,omitempty"`
}

type gatewayChatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error"`
}

// GatewayResult 是网关调用的事实结果。
type GatewayResult struct {
	Content      string
	Model        string
	FinishReason string
	PromptTokens int
	OutputTokens int
	StatusCode   int
}

// Chat 发起一次非流式推理。timeout 由底座路由决策给出，业务侧不自设上限。
func (g *GatewayClient) Chat(ctx context.Context, model string, taskID string, messages []ChatMessage, maxTokens int, timeout time.Duration) (GatewayResult, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	payload, err := json.Marshal(gatewayChatRequest{
		Model:     model,
		Messages:  messages,
		Stream:    false,
		MaxTokens: maxTokens,
		// taskID 已由控制面用于路由。不要把非 OpenAI 字段透传到上游，
		// Gemini 等严格实现会拒绝 business_task_id。
	})
	if err != nil {
		return GatewayResult{}, err
	}
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, g.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return GatewayResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Model-Task-ID", taskID)
	if g.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+g.apiKey)
	}
	response, err := g.httpClient.Do(request)
	if err != nil {
		return GatewayResult{}, fmt.Errorf("%w: %v", ErrGatewayFailure, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return GatewayResult{}, fmt.Errorf("%w: %v", ErrGatewayFailure, err)
	}
	result := GatewayResult{StatusCode: response.StatusCode}
	var parsed gatewayChatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return result, fmt.Errorf("%w: gateway returned non-json response (status %d)", ErrGatewayFailure, response.StatusCode)
	}
	if parsed.Error != nil {
		result.Model = parsed.Model
		return result, fmt.Errorf("%w: gateway error %s: %s", ErrGatewayFailure, parsed.Error.Type, parsed.Error.Message)
	}
	if response.StatusCode != http.StatusOK || len(parsed.Choices) == 0 {
		return result, fmt.Errorf("%w: gateway status %d without choices", ErrGatewayFailure, response.StatusCode)
	}
	result.Content = parsed.Choices[0].Message.Content
	result.Model = parsed.Model
	result.FinishReason = parsed.Choices[0].FinishReason
	result.PromptTokens = parsed.Usage.PromptTokens
	result.OutputTokens = parsed.Usage.CompletionTokens
	return result, nil
}
