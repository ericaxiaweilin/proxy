package localnet

import (
	"context"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// POST-PROFILE-GATE-001：真人发帖前必须有用户名 + 头像；缺什么就拒绝并说出缺什么；平台 / 系统主体不受影响。
func TestCreatePostRequiresACompleteProfile(t *testing.T) {
	s := New()
	complete := map[string]bool{"user_ok": true}
	s.SetProfileCompleteness(func(_ context.Context, id string) []string {
		if complete[id] {
			return nil
		}
		return []string{"name", "avatar"}
	})
	post := func(actorType, actorID string) command.Result {
		e := envelopeFor("", "CreatePost", map[string]any{"body": "今天好忙", "visibility": "PUBLIC", "cityScope": "河内"})
		e.Actor = command.Actor{Type: actorType, ID: actorID}
		e.Principal = command.Principal{Type: "INDIVIDUAL", ID: actorID}
		return s.Handle(e)
	}
	r := post("USER", "user_anon")
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "PROFILE_INCOMPLETE" {
		t.Fatalf("an account without name / avatar must not post: %+v", r)
	}
	if missing, _ := r.Error.SafeDetails["missing"].([]string); len(missing) != 2 {
		t.Fatalf("the rejection must say what is missing: %+v", r.Error.SafeDetails)
	}
	if r := post("USER", "user_ok"); r.Outcome != "ACCEPTED" {
		t.Fatalf("a complete profile posts normally: %+v", r.Error)
	}
	// 平台 / 系统主体不是人：不走这道门（它们可能被别的规则拦，但绝不是 PROFILE_INCOMPLETE）。
	if r := post("SYSTEM", "platform"); r.Error != nil && r.Error.ErrorCode == "PROFILE_INCOMPLETE" {
		t.Fatalf("platform / system actors must not hit the profile gate: %+v", r.Error)
	}
}
