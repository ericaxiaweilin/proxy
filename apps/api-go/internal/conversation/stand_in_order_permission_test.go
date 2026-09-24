package conversation

import (
	"context"
	"errors"
	"testing"
)

// ORDER-PERMISSION-TWIN-001（用户：「有接单权限才开动 ai 分身」）：对面那个人没有接单权限 → 不代回复（按 OFF），
// 模型一次都不调；有权限才照常代回。权限查询出错按没权限。
func TestStandInRequiresTheOwnersOrderPermission(t *testing.T) {
	for _, tc := range []struct {
		name      string
		check     func(context.Context, string) (bool, error)
		status    string
		wantModel bool
	}{
		{"no permission", func(context.Context, string) (bool, error) { return false, nil }, "OFF", false},
		{"lookup failed", func(context.Context, string) (bool, error) { return false, errors.New("db down") }, "OFF", false},
		{"approved", func(_ context.Context, id string) (bool, error) { return id == "user_002", nil }, "RESPONDED", true},
	} {
		model := &recordingModelStack{}
		s := NewWithModelStack(NewMemoryRepository(), model)
		var asked []string
		s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{"user_002": {ChatPermission: "auto"}}, &asked))
		s.SetOrderPermission(tc.check)
		opened := dmHuman(t, s)
		if opened.AssistantStatus != tc.status {
			t.Fatalf("%s: status %q, want %q", tc.name, opened.AssistantStatus, tc.status)
		}
		if (model.calls > 0) != tc.wantModel {
			t.Fatalf("%s: model calls = %d", tc.name, model.calls)
		}
	}
}
