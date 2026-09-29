package activity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

type joinView struct {
	Activity      Activity `json:"activity"`
	Participation struct {
		OrderNo string `json:"orderNo"`
		State   string `json:"state"`
	} `json:"participation"`
}

func joinOf(t *testing.T, r command.Result) joinView {
	t.Helper()
	var view joinView
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return view
}

func allDigits(s string) bool {
	if len(s) < 16 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ACT-ORDER-NO-001：For You「确认下单」= 报名活动。以前「已下单」页显示的是活动的
// 展示码（同一场活动所有人同一个号），报名本身没有订单编号。每个报名人拿到自己的
// 全数字编号；重复下单返回同一个编号。
func TestJoinReturnsOwnAllDigitOrderNumber(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy"
	a := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	b := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id))
	if a.Outcome != "ACCEPTED" || b.Outcome != "ACCEPTED" {
		t.Fatalf("joins: %+v %+v", a.Error, b.Error)
	}
	noA, noB := joinOf(t, a).Participation.OrderNo, joinOf(t, b).Participation.OrderNo
	if !allDigits(noA) || !allDigits(noB) || noA == noB {
		t.Fatalf("each participant needs their own all-digit order number, got %q and %q", noA, noB)
	}
	again := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if again.Error == nil || again.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" || again.Error.SafeDetails["orderNo"] != noA {
		t.Fatalf("ALREADY_JOINED must return the existing order number %s, got %+v", noA, again.Error)
	}
}

// ACT-SEAT-RELEASE-001：以前取消只改内存状态，joined 不减、参与记录还在 ——
// 名额永久被占，本人也无法再报。取消必须释放名额；再报名沿用同一个订单编号。
func TestCancelReleasesSeatAndRejoinKeepsNumber(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy" // capacity 2
	first := joinOf(t, s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id)))
	s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id))
	if r := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_c", id)); r.Error == nil || r.Error.ErrorCode != "ACTIVITY_FULL" {
		t.Fatalf("third join must be ACTIVITY_FULL, got %+v", r)
	}
	if r := s.HandleContext(t.Context(), activityEnvelope("CancelActivity", "user_a", id)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", r.Error)
	}
	c := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_c", id))
	if c.Outcome != "ACCEPTED" || joinOf(t, c).Activity.Joined != 2 {
		t.Fatalf("a cancelled seat must be released, got %s %+v", c.Outcome, c.Error)
	}
	if r := s.HandleContext(t.Context(), activityEnvelope("CancelActivity", "user_b", id)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel b: %+v", r.Error)
	}
	rejoin := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if rejoin.Outcome != "ACCEPTED" || joinOf(t, rejoin).Participation.OrderNo != first.Participation.OrderNo {
		t.Fatalf("re-joining after cancel must succeed with the same order number %s, got %s %+v", first.Participation.OrderNo, rejoin.Outcome, rejoin.Error)
	}
	if r := s.HandleContext(t.Context(), activityEnvelope("CancelActivity", "user_c", id)); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel c: %+v", r.Error)
	}
	if r := s.HandleContext(t.Context(), activityEnvelope("CancelActivity", "user_c", id)); r.Error == nil || r.Error.ErrorCode != "ACTIVITY_CANCEL_NOT_ALLOWED" {
		t.Fatalf("cancelling twice must not release a second seat, got %+v", r)
	}
}
