package modelstack

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiProviderLoadsRegistryAndCompletesTask(t *testing.T) {
	const fakeKey = "test-only-key"
	var received struct {
		Model          string `json:"model"`
		BusinessTaskID string `json:"business_task_id"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+fakeKey {
			t.Errorf("authorization = %q", got)
		}
		if got := r.Header.Get("X-Model-Task-ID"); got != "proxy.conversation.assistant" {
			t.Errorf("task header = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"MiniMaxAI/MiniMax-M3","choices":[{"message":{"role":"assistant","content":"真实回复"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	modelsPath := filepath.Join(dir, "models.json")
	settingsPath := filepath.Join(dir, "settings.json")
	models := `{"providers":{"fixture-provider":{"baseUrl":"` + server.URL + `/v1","apiKey":"` + fakeKey + `","models":[{"id":"MiniMaxAI/MiniMax-M3"}]}}}`
	settings := `{"defaultProvider":"fixture-provider","defaultModel":"MiniMaxAI/MiniMax-M3"}`
	if err := os.WriteFile(modelsPath, []byte(models), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(settingsPath, []byte(settings), 0o600); err != nil {
		t.Fatal(err)
	}

	provider, err := NewFromPiConfig(modelsPath, settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	completion, err := provider.Complete(context.Background(), "proxy.conversation.assistant", []ChatMessage{{Role: "user", Content: "你好"}})
	if err != nil {
		t.Fatal(err)
	}
	if received.Model != "MiniMaxAI/MiniMax-M3" {
		t.Fatalf("model = %q", received.Model)
	}
	if received.BusinessTaskID != "" {
		t.Fatalf("business task leaked into provider JSON: %q", received.BusinessTaskID)
	}
	if completion.Content != "真实回复" || completion.TaskID != "proxy.conversation.assistant" {
		t.Fatalf("completion = %#v", completion)
	}
	if completion.Provider != "fixture-provider" || completion.ModelOption != "MiniMaxAI/MiniMax-M3" {
		t.Fatalf("audit fields = %#v", completion)
	}
}

func TestPiProviderLive(t *testing.T) {
	if os.Getenv("PROXY_LIVE_PI_TEST") != "1" {
		t.Skip("set PROXY_LIVE_PI_TEST=1 to exercise the configured Pi provider")
	}
	provider, err := NewFromPiConfig(os.Getenv("MODELSTACK_PI_MODELS_PATH"), os.Getenv("MODELSTACK_PI_SETTINGS_PATH"))
	if err != nil {
		t.Fatal(err)
	}
	completion, err := provider.Complete(context.Background(), "proxy.conversation.assistant", []ChatMessage{{Role: "user", Content: "Reply with exactly: PROXY_MODEL_OK"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(completion.Content, "PROXY_MODEL_OK") {
		t.Fatalf("unexpected model response (model=%q, content length=%d)", completion.Model, len(completion.Content))
	}
}

func TestPiProviderRejectsIncompleteRegistry(t *testing.T) {
	dir := t.TempDir()
	modelsPath := filepath.Join(dir, "models.json")
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(modelsPath, []byte(`{"providers":{"missing-fixture-provider":{"baseUrl":"https://example.invalid/v1"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(settingsPath, []byte(`{"defaultProvider":"missing-fixture-provider","defaultModel":"MiniMaxAI/MiniMax-M3"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFromPiConfig(modelsPath, settingsPath); err == nil {
		t.Fatal("expected incomplete registry to fail closed")
	}
}
