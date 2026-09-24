package identity

import (
	"context"
	"encoding/json"
	"testing"
)

// AVATAR-AGENT-ALIAS-001：服务者身份（agent_linh）没有自己的资料 —— 按绑定的用户账号读本人资料（头像 / 名字），
// 返回的 userAccountId 仍是被问的 id；没有绑定就照旧 PROFILE_NOT_FOUND（客户端退回首字头像）。
func TestGetProfileFollowsAgentAliasToTheLinkedAccount(t *testing.T) {
	svc := New(nil)
	if r := svc.Handle(profileEnvelope("UpdateProfile", "user_linh", map[string]any{
		"name": "Linh", "handle": "linh", "bio": "", "city": "河内", "avatarPath": "assets/ma_linh_portrait",
	})); r.Outcome != "ACCEPTED" {
		t.Fatalf("seed profile: %+v", r.Error)
	}
	svc.SetProfileAlias(func(_ context.Context, id string) (string, bool) {
		if id == "agent_linh" {
			return "user_linh", true
		}
		return "", false
	})
	read := profileEnvelope("GetProfile", "viewer", nil)
	read.Target.ID = "agent_linh"
	r := svc.Handle(read)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("agent id must resolve through the alias: %+v", r.Error)
	}
	var body struct {
		Profile struct {
			UserAccountID string `json:"userAccountId"`
			AvatarPath    string `json:"avatarPath"`
		} `json:"profile"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &body)
	if body.Profile.UserAccountID != "agent_linh" || body.Profile.AvatarPath != "assets/ma_linh_portrait" {
		t.Fatalf("expected Linh's avatar under the asked id: %+v", body.Profile)
	}
	unknown := profileEnvelope("GetProfile", "viewer", nil)
	unknown.Target.ID = "agent_nobody"
	if r := svc.Handle(unknown); r.Outcome == "ACCEPTED" {
		t.Fatal("an agent with no linked account stays not-found")
	}
}
