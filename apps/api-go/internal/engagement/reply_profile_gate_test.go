package engagement

import (
	"context"
	"testing"
)

// POST-PROFILE-GATE-001（评论）：没有用户名 / 头像不能评论，说清缺什么；资料齐全照常评论。
func TestReplyRequiresACompleteProfile(t *testing.T) {
	s := New()
	s.SetProfileCompleteness(func(_ context.Context, id string) []string {
		if id == "user_ok" {
			return nil
		}
		return []string{"name", "avatar"}
	})
	r := s.Handle(envelopeWithActor("ReplyToPost", "user_anon", map[string]any{"postId": "post_1", "body": "hi"}))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "PROFILE_INCOMPLETE" {
		t.Fatalf("an account without name / avatar must not reply: %+v", r)
	}
	if missing, _ := r.Error.SafeDetails["missing"].([]string); len(missing) != 2 {
		t.Fatalf("the rejection must say what is missing: %+v", r.Error.SafeDetails)
	}
	if r := s.Handle(envelopeWithActor("ReplyToPost", "user_ok", map[string]any{"postId": "post_1", "body": "hi"})); r.Error != nil && r.Error.ErrorCode == "PROFILE_INCOMPLETE" {
		t.Fatalf("a complete profile must not hit the gate: %+v", r.Error)
	}
}
