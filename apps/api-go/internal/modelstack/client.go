package modelstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ControlPlaneClient 封装模型底座控制面（Model Stack Control Plane）的
// 业务侧只读契约与故障回报。业务侧禁止调用控制面的凭证管理 / 审批等
// 管理类接口。
type ControlPlaneClient struct {
	baseURL    string
	httpClient *http.Client
}

// RouteDecision 是底座对单个业务任务 ID 的权威路由决策快照。
// 业务侧只消费本结构，不做任何模型选择。
type RouteDecision struct {
	TaskID              string
	Providers           []string
	ModelOptionID       string
	Streaming           bool
	RequestTimeoutMS    int
	FirstTokenTimeoutMS int
	MaxCompletionTokens int
	LatencyBudgetMS     int
	FetchedAt           time.Time
}

// PrimaryProvider 返回底座指定的首选 Provider（同时作为网关模型名）。
func (r RouteDecision) PrimaryProvider() string {
	if len(r.Providers) == 0 {
		return ""
	}
	return r.Providers[0]
}

type routeRequestEnvelope struct {
	Status   string `json:"status"`
	RouteReq *struct {
		Providers       []string `json:"providers"`
		ModelOptionID   string   `json:"model_option_id"`
		LatencyBudgetMS int      `json:"latency_budget_ms"`
		Streaming       bool     `json:"streaming"`
		// 顶层运行时策略字段（底座同时提供嵌套 runtime_policy 与顶层冗余字段，
		// 业务侧以顶层字段为准，缺失时回退嵌套结构）。
		RequestTimeoutMS    int  `json:"request_timeout_ms"`
		FirstTokenTimeoutMS int  `json:"first_token_timeout_ms"`
		MaxCompletionTokens int  `json:"max_completion_tokens"`
		HasAvailable        bool `json:"has_available_model_options"`
		RuntimePolicy       *struct {
			RequestTimeoutMS    int  `json:"request_timeout_ms"`
			FirstTokenTimeoutMS int  `json:"first_token_timeout_ms"`
			MaxCompletionTokens int  `json:"max_completion_tokens"`
			Streaming           bool `json:"streaming"`
		} `json:"runtime_policy"`
	} `json:"route_request"`
	Error string `json:"error"`
}

func NewControlPlaneClient(baseURL string) *ControlPlaneClient {
	return &ControlPlaneClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 8 * time.Second},
	}
}

// GetRouteDecision 用业务任务 ID 向底座请求权威路由决策。
// 这是业务侧与底座的唯一路由契约：发任务 ID，拿路由，不碰模型。
func (c *ControlPlaneClient) GetRouteDecision(ctx context.Context, taskID string, promptTokens, maxCompletionTokens int) (RouteDecision, error) {
	if promptTokens <= 0 {
		promptTokens = 1000
	}
	if maxCompletionTokens <= 0 {
		maxCompletionTokens = 1000
	}
	endpoint := c.baseURL + "/api/model-management/business-tasks/" + url.PathEscape(taskID) + "/route-request"
	query := url.Values{}
	query.Set("prompt_tokens", fmt.Sprintf("%d", promptTokens))
	query.Set("max_completion_tokens", fmt.Sprintf("%d", maxCompletionTokens))
	query.Set("require_deployed", "true")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return RouteDecision{}, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return RouteDecision{}, fmt.Errorf("%w: %v", ErrControlPlaneUnavailable, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return RouteDecision{}, fmt.Errorf("%w: %v", ErrControlPlaneUnavailable, err)
	}
	if response.StatusCode == http.StatusNotFound {
		return RouteDecision{}, fmt.Errorf("%w: task %s not registered", ErrTaskNotRoutable, taskID)
	}
	if response.StatusCode != http.StatusOK {
		return RouteDecision{}, fmt.Errorf("%w: control plane returned %d", ErrControlPlaneUnavailable, response.StatusCode)
	}
	var envelope routeRequestEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return RouteDecision{}, fmt.Errorf("%w: invalid route request payload", ErrControlPlaneUnavailable)
	}
	if envelope.Status != "success" || envelope.RouteReq == nil {
		return RouteDecision{}, fmt.Errorf("%w: %s", ErrTaskNotRoutable, envelope.Error)
	}
	route := envelope.RouteReq
	decision := RouteDecision{
		TaskID:              taskID,
		Providers:           route.Providers,
		ModelOptionID:       route.ModelOptionID,
		Streaming:           route.Streaming,
		RequestTimeoutMS:    route.RequestTimeoutMS,
		FirstTokenTimeoutMS: route.FirstTokenTimeoutMS,
		MaxCompletionTokens: route.MaxCompletionTokens,
		LatencyBudgetMS:     route.LatencyBudgetMS,
		FetchedAt:           time.Now().UTC(),
	}
	if route.RuntimePolicy != nil {
		if decision.RequestTimeoutMS == 0 {
			decision.RequestTimeoutMS = route.RuntimePolicy.RequestTimeoutMS
		}
		if decision.FirstTokenTimeoutMS == 0 {
			decision.FirstTokenTimeoutMS = route.RuntimePolicy.FirstTokenTimeoutMS
		}
		if decision.MaxCompletionTokens == 0 {
			decision.MaxCompletionTokens = route.RuntimePolicy.MaxCompletionTokens
		}
		if !decision.Streaming {
			decision.Streaming = route.RuntimePolicy.Streaming
		}
	}
	if !route.HasAvailable || decision.PrimaryProvider() == "" {
		return RouteDecision{}, fmt.Errorf("%w: no deployed provider for task %s", ErrTaskNotRoutable, taskID)
	}
	return decision, nil
}

// RuntimeFailure 是业务侧向底座回报的运行时故障事实，
// 底座据此做 Provider failover / 生命周期决策。
type RuntimeFailure struct {
	StatusCode *int
	Error      string
	ErrorCode  string
	Message    string
	Detail     string
}

// ReportRuntimeFailure 以 best-effort 方式回报网关故障。回报失败不影响业务错误传播。
func (c *ControlPlaneClient) ReportRuntimeFailure(ctx context.Context, provider string, failure RuntimeFailure) error {
	payload, err := json.Marshal(map[string]any{
		"status_code": failure.StatusCode,
		"error":       failure.Error,
		"error_code":  failure.ErrorCode,
		"message":     failure.Message,
		"detail":      failure.Detail,
		"notes":       "proxy-api business runtime report",
	})
	if err != nil {
		return err
	}
	endpoint := c.baseURL + "/api/model-management/providers/" + url.PathEscape(provider) + "/runtime-failure"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("runtime failure report rejected with status %d", response.StatusCode)
	}
	return nil
}
