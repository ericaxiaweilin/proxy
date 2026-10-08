package postgres

// COMP-GRAVITY-CONSENT-001：引力计算只吃「有有效同意」的浏览事件，对真库跑。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/gravity"
)

func TestGravityBrowseSignalOnlyCountsEventsWithValidConsent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	granted, never, withdrawn, afterGrantOnly := "user_gc_granted_"+stamp, "user_gc_never_"+stamp, "user_gc_withdrawn_"+stamp, "user_gc_late_"+stamp
	users := []string{granted, never, withdrawn, afterGrantOnly}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	consent := func(user, action string, at time.Time) {
		exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source)
			VALUES ($1,$2,'BEHAVIOR_ANALYTICS','test',$3,$4,'TEST')`, "pc_"+user+"_"+action+"_"+at.Format("150405.000000"), user, action, at)
	}
	event := func(user string, at time.Time) {
		exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at)
			VALUES ($1,'POST_IMPRESSION',$2,'POST','post_x',$3)`, "evt_"+user+"_"+at.Format("150405.000000"), user, at)
	}
	consent(granted, "GRANT", now.Add(-48*time.Hour))
	event(granted, now.Add(-24*time.Hour)) // 同意有效 ✔
	event(never, now.Add(-24*time.Hour))   // 从没同意过（默认开时期留下的）✘
	consent(withdrawn, "GRANT", now.Add(-72*time.Hour))
	event(withdrawn, now.Add(-60*time.Hour))
	consent(withdrawn, "WITHDRAW", now.Add(-12*time.Hour)) // 事后撤回 ✘（现在不该再被处理）
	event(afterGrantOnly, now.Add(-30*time.Hour))          // 事件早于同意 ✘
	consent(afterGrantOnly, "GRANT", now.Add(-6*time.Hour))

	occ, err := gravity.NewPostgres(pool).Occurrences(ctx, now.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatalf("Occurrences: %v", err)
	}
	got := map[string]int{}
	for _, o := range occ {
		if o.EventType == "BROWSE_ACTIVE" {
			got[o.UserID]++
		}
	}
	if got[granted] != 1 {
		t.Fatalf("an event under a valid, still-active consent counts: %v", got)
	}
	for _, u := range []string{never, withdrawn, afterGrantOnly} {
		if got[u] != 0 {
			t.Fatalf("%s must not feed the profile (no consent at the time / withdrawn since): %v", u, got)
		}
	}
}
