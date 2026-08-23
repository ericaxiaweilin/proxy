package modelstack

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// newFakeModelStack 启动模拟底座：控制面 route-request / runtime-failure + 网关 chat/completions。
func newFakeModelStack(t *testing.T, gatewayStatus int, gatewayBody string) (*Service, *atomic.Int32, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	var routeHits, failureHits, chatHits atomic.Int32

	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatHits.Add(1)
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected gateway path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("gateway missing bearer credential")
		}
		var payload gatewayChatRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode gateway payload: %v", err)
		}
		if payload.BusinessTaskID != "" {
			t.Errorf("gateway payload must not leak task metadata to the upstream provider")
		}
		if r.Header.Get("X-Model-Task-ID") == "" {
			t.Errorf("gateway request must carry task metadata as an internal header")
		}
		if payload.Model != "fake-gateway-model" {
			t.Errorf("gateway must receive the base-provided delegation, got %q", payload.Model)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(gatewayStatus)
		_, _ = w.Write([]byte(gatewayBody))
	}))
	t.Cleanup(gateway.Close)

	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/route-request"):
			routeHits.Add(1)
			taskID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/model-management/business-tasks/"), "/route-request")
			if taskID == "proxy.unknown.task" {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"status":"error","error":"task not found"}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"status":"success",
				"route_request":{
					"providers":["fake-provider"],
					"gateway_model":"fake-gateway-model",
					"model_option_id":"fake_option",
					"latency_budget_ms":12000,
					"streaming":false,
					"request_timeout_ms":15000,
					"first_token_timeout_ms":8000,
					"max_completion_tokens":512,
					"has_available_model_options":true,
					"runtime_policy":{"request_timeout_ms":15000,"max_completion_tokens":512,"streaming":false}
				}
			}`))
		case strings.HasSuffix(r.URL.Path, "/runtime-failure"):
			failureHits.Add(1)
			_, _ = w.Write([]byte(`{"status":"success"}`))
		default:
			t.Errorf("unexpected control plane path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(controlPlane.Close)

	service := New(controlPlane.URL, gateway.URL, "test-key")
	return service, &routeHits, &failureHits, &chatHits
}

func TestUnconfiguredServiceFailsClosed(t *testing.T) {
	var port Port = Unconfigured{}
	if port.Available() {
		t.Fatal("unconfigured adapter must not report available")
	}
	_, err := port.Complete(context.Background(), "proxy.demand.draft_assist", []ChatMessage{{Role: "user", Content: "hi"}})
	if !errors.Is(err, ErrUnconfigured) {
		t.Fatalf("expected ErrUnconfigured, got %v", err)
	}
}

func TestCompleteHappyPathOnlySendsTaskID(t *testing.T) {
	service, routeHits, failureHits, _ := newFakeModelStack(t, http.StatusOK, `{
		"model":"fake-gateway-model",
		"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],
		"usage":{"prompt_tokens":12,"completion_tokens":3}
	}`)

	completion, err := service.Complete(context.Background(), "proxy.localnet.post_summary", []ChatMessage{
		{Role: "system", Content: "summarize"},
		{Role: "user", Content: "post body"},
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completion.Content != "ok" || completion.Provider != "fake-provider" || completion.ModelOption != "fake_option" {
		t.Fatalf("unexpected completion %+v", completion)
	}
	if completion.PromptTokens != 12 || completion.OutputTokens != 3 {
		t.Fatalf("usage not propagated: %+v", completion)
	}
	if routeHits.Load() != 1 {
		t.Fatalf("expected one route decision fetch, got %d", routeHits.Load())
	}
	if failureHits.Load() != 0 {
		t.Fatalf("unexpected runtime failure reports: %d", failureHits.Load())
	}
}

func TestCompleteUsesRouteCacheWithinTTL(t *testing.T) {
	service, routeHits, _, chatHits := newFakeModelStack(t, http.StatusOK, `{
		"model":"fake-gateway-model",
		"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]
	}`)

	for i := 0; i < 3; i++ {
		if _, err := service.Complete(context.Background(), "proxy.localnet.post_summary", []ChatMessage{{Role: "user", Content: "x"}}); err != nil {
			t.Fatalf("complete %d: %v", i, err)
		}
	}
	if chatHits.Load() != 3 {
		t.Fatalf("expected three gateway calls, got %d", chatHits.Load())
	}
	if routeHits.Load() != 1 {
		t.Fatalf("route decision must be cached within TTL, got %d fetches", routeHits.Load())
	}
}

func TestCompleteUnregisteredTaskFailsClosed(t *testing.T) {
	service, _, _, _ := newFakeModelStack(t, http.StatusOK, `{}`)
	_, err := service.Complete(context.Background(), "proxy.unknown.task", []ChatMessage{{Role: "user", Content: "x"}})
	if !errors.Is(err, ErrTaskNotRoutable) {
		t.Fatalf("expected ErrTaskNotRoutable, got %v", err)
	}
}

func TestGatewayFailureReportsRuntimeFailureAndInvalidatesRoute(t *testing.T) {
	service, routeHits, failureHits, _ := newFakeModelStack(t, http.StatusBadRequest, `{
		"error":{"message":"boom","type":"invalid_request_error","code":"400"}
	}`)

	_, err := service.Complete(context.Background(), "proxy.localnet.post_summary", []ChatMessage{{Role: "user", Content: "x"}})
	if !errors.Is(err, ErrGatewayFailure) {
		t.Fatalf("expected ErrGatewayFailure, got %v", err)
	}
	if failureHits.Load() != 1 {
		t.Fatalf("expected runtime failure report, got %d", failureHits.Load())
	}
	// 失败后路由缓存必须失效：再次调用会重新向控制面请求路由。
	_, _ = service.Complete(context.Background(), "proxy.localnet.post_summary", []ChatMessage{{Role: "user", Content: "x"}})
	if routeHits.Load() != 3 {
		t.Fatalf("failure must invalidate and re-fetch the base route before the next call, route fetches=%d", routeHits.Load())
	}
}

func TestControlPlaneUnavailableFailsClosed(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("gateway must not be called when control plane is unavailable")
	}))
	t.Cleanup(gateway.Close)
	service := New("http://127.0.0.1:1", gateway.URL, "test-key")
	_, err := service.Complete(context.Background(), "proxy.localnet.post_summary", []ChatMessage{{Role: "user", Content: "x"}})
	if !errors.Is(err, ErrControlPlaneUnavailable) {
		t.Fatalf("expected ErrControlPlaneUnavailable, got %v", err)
	}
}
