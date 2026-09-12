package identity

import (
	"context"
	"errors"
	"testing"
)

// AVATAR-DELIVER-001 tripwire
//
// 历史 bug：换完头像被「重置」。真因不在客户端保存，而在服务端投递规则——
// 上传媒体一律 OWNER_ONLY，而公开路由 /v1/media/thumb|play/{id} 要求
// APPROVED && PUBLIC（fail-closed 拒绝），发帖/上架店铺会在命令事务内提权到
// PUBLIC，更新个人资料这条链路没做 → 头像 URL 恒 404，界面回字母头。
//
// 该 tripwire 锁死：UpdateProfile 带上 assets/<mediaAssetId> 时必须在落库前
// 提权一次（owner=actor，visibility=PUBLIC），且提权失败要拒绝整条命令。
type fakeProfileMediaAuthorizer struct {
	calls      int
	ids        []string
	owner      string
	visibility string
	err        error
}

func (f *fakeProfileMediaAuthorizer) AuthorizeForPost(_ context.Context, ids []string, ownerPrincipalID, visibility string) error {
	f.calls++
	f.ids = ids
	f.owner = ownerPrincipalID
	f.visibility = visibility
	return f.err
}

func TestUpdateProfileAuthorizesAvatarForPublicDelivery(t *testing.T) {
	svc := New(nil)
	auth := &fakeProfileMediaAuthorizer{}
	svc.SetProfileMediaAuthorizer(auth)

	res := svc.Handle(profileEnvelope("UpdateProfile", "user_alice", map[string]any{
		"name":       "Alice",
		"handle":     "@alice",
		"bio":        "河内",
		"city":       "Hanoi",
		"avatarPath": "assets/ma_abc123",
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("update should be accepted when media can be authorized: %#v", res)
	}
	if auth.calls != 1 {
		t.Fatalf("avatar media must be authorized exactly once, got %d", auth.calls)
	}
	if len(auth.ids) != 1 || auth.ids[0] != "ma_abc123" {
		t.Fatalf("wrong media id authorized: %#v", auth.ids)
	}
	if auth.visibility != "PUBLIC" {
		t.Fatalf("avatar must be promoted to PUBLIC (public thumb/play routes require it), got %q", auth.visibility)
	}
	if auth.owner != "user_alice" {
		t.Fatalf("avatar must be authorized against the acting owner, got %q", auth.owner)
	}
}

func TestUpdateProfileRejectsUndeliverableAvatar(t *testing.T) {
	svc := New(nil)
	svc.SetProfileMediaAuthorizer(&fakeProfileMediaAuthorizer{err: errors.New("media not ready")})

	res := svc.Handle(profileEnvelope("UpdateProfile", "user_alice", map[string]any{
		"name":       "Alice",
		"handle":     "@alice",
		"bio":        "",
		"city":       "Hanoi",
		"avatarPath": "assets/ma_boom",
	}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("undeliverable avatar must reject the command, got %#v", res)
	}
}

func TestUpdateProfileWithoutAvatarSkipsAuthorization(t *testing.T) {
	svc := New(nil)
	auth := &fakeProfileMediaAuthorizer{}
	svc.SetProfileMediaAuthorizer(auth)

	res := svc.Handle(profileEnvelope("UpdateProfile", "user_alice", map[string]any{
		"name":   "Alice",
		"handle": "@alice",
		"bio":    "",
		"city":   "Hanoi",
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("update without avatar should be accepted: %#v", res)
	}
	if auth.calls != 0 {
		t.Fatalf("no avatar means no authorization call, got %d", auth.calls)
	}
}
