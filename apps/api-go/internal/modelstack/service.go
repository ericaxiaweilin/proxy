package modelstack

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Service 是 modelstack.Port 的默认实现：
// 任务 ID → 控制面路由决策（带 TTL 缓存）→ 网关推理 → 故障回报。
// Domain 模块只依赖 Port，不依赖本结构体。
type Service struct {
	controlPlane *ControlPlaneClient
	gateway      *GatewayClient

	mu         sync.Mutex
	routeCache map[string]RouteDecision
	routeTTL   time.Duration
}

var _ Port = (*Service)(nil)

const defaultRouteTTL = 60 * time.Second

func New(controlPlaneURL, gatewayURL, gatewayAPIKey string) *Service {
	return &Service{
		controlPlane: NewControlPlaneClient(controlPlaneURL),
		gateway:      NewGatewayClient(gatewayURL, gatewayAPIKey),
		routeCache:   map[string]RouteDecision{},
		routeTTL:     defaultRouteTTL,
	}
}

func (s *Service) Available() bool { return true }

// Complete 实现业务侧契约：只发任务 ID，模型选择完全由底座决定。
func (s *Service) Complete(ctx context.Context, taskID string, messages []ChatMessage) (Completion, error) {
	if taskID == "" {
		return Completion{}, fmt.Errorf("%w: empty task id", ErrTaskNotRoutable)
	}
	if len(messages) == 0 {
		return Completion{}, fmt.Errorf("%w: empty messages", ErrTaskNotRoutable)
	}
	decision, err := s.resolveRoute(ctx, taskID)
	if err != nil {
		return Completion{}, err
	}
	model := decision.PrimaryProvider()
	timeout := time.Duration(decision.RequestTimeoutMS) * time.Millisecond
	gatewayResult, err := s.gateway.Chat(ctx, model, taskID, messages, decision.MaxCompletionTokens, timeout)
	if err != nil {
		s.reportFailure(ctx, model, gatewayResult.StatusCode, err)
		// 路由决策可能已过期（底座刚切换 Provider），失效缓存后让下次调用重新路由。
		s.invalidateRoute(taskID)
		return Completion{}, err
	}
	return Completion{
		Content:      gatewayResult.Content,
		TaskID:       taskID,
		Model:        gatewayResult.Model,
		Provider:     model,
		ModelOption:  decision.ModelOptionID,
		PromptTokens: gatewayResult.PromptTokens,
		OutputTokens: gatewayResult.OutputTokens,
	}, nil
}

// resolveRoute 优先使用未过期的路由快照，避免每次推理都请求控制面；
// 控制面不可达且缓存已过期时 fail-closed，不使用陈旧路由硬打网关。
func (s *Service) resolveRoute(ctx context.Context, taskID string) (RouteDecision, error) {
	s.mu.Lock()
	cached, ok := s.routeCache[taskID]
	fresh := ok && time.Since(cached.FetchedAt) < s.routeTTL
	s.mu.Unlock()
	if fresh {
		return cached, nil
	}
	decision, err := s.controlPlane.GetRouteDecision(ctx, taskID, 1000, 0)
	if err != nil {
		return RouteDecision{}, err
	}
	s.mu.Lock()
	s.routeCache[taskID] = decision
	s.mu.Unlock()
	return decision, nil
}

func (s *Service) invalidateRoute(taskID string) {
	s.mu.Lock()
	delete(s.routeCache, taskID)
	s.mu.Unlock()
}

// reportFailure 以独立短超时 best-effort 回报故障，不阻塞业务错误返回。
func (s *Service) reportFailure(ctx context.Context, provider string, statusCode int, cause error) {
	if provider == "" {
		return
	}
	reportCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	failure := RuntimeFailure{
		Error:     "gateway_invocation_failed",
		ErrorCode: "proxy.business.runtime",
		Message:   cause.Error(),
	}
	if statusCode > 0 {
		failure.StatusCode = &statusCode
	}
	_ = s.controlPlane.ReportRuntimeFailure(reportCtx, provider, failure)
}
