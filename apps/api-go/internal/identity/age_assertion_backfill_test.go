package identity

import (
	"context"
	"testing"
)

// AGE-BACKFILL-001 — 老账号补年龄断言：来源必须是 SELF_DECLARED_BACKFILL
//（跟注册断言区分开），写错可重交纠正（append-only 不覆盖）；非法日期和
// 未来日期拒绝，未成年如实记录（门禁去判，这里不判）。
func TestBackfillRecordsWithBackfillSource(t *testing.T) {
	svc, repo := newAgeService(t)
	if err := svc.RecordAgeAssertionBackfill(context.Background(), "user_old", "1990-05-06", "127.0.0.1", "test"); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if len(repo.calls) != 1 {
		t.Fatalf("writes = %d, want 1", len(repo.calls))
	}
	call := repo.calls[0]
	if call.UserID != "user_old" || call.DateOfBirth != "1990-05-06" || call.Source != "SELF_DECLARED_BACKFILL" {
		t.Fatalf("call = %+v, want backfill source with the submitted date", call)
	}
}

func TestBackfillRejectsBadAndFutureDates(t *testing.T) {
	svc, repo := newAgeService(t)
	// newAgeService 的时钟固定在 2026-08-21。
	for _, dob := range []string{"", "1990/05/06", "not-a-date", "2026-08-22", "2030-01-01"} {
		if err := svc.RecordAgeAssertionBackfill(context.Background(), "user_old", dob, "", ""); err == nil {
			t.Fatalf("dob %q accepted, want rejection", dob)
		}
	}
	if len(repo.calls) != 0 {
		t.Fatalf("rejected dates wrote %d rows, want 0", len(repo.calls))
	}
}

func TestBackfillRecordsMinorTruthfully(t *testing.T) {
	svc, repo := newAgeService(t)
	// 未成年也如实记 —— 门禁（COMP-AI-MINOR-001）去拦，这里不替用户决定他是谁。
	if err := svc.RecordAgeAssertionBackfill(context.Background(), "user_young", "2015-01-01", "", ""); err != nil {
		t.Fatalf("minor backfill: %v", err)
	}
	if len(repo.calls) != 1 || repo.calls[0].DateOfBirth != "2015-01-01" {
		t.Fatalf("calls = %+v, want the minor date recorded truthfully", repo.calls)
	}
}
