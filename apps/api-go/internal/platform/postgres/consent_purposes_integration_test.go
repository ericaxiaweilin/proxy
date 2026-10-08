package postgres

// COMP-CONSENT-PIPELINE-001：同意按用途分开，每个读取只认自己那个用途 —— 对真库跑。
//
//	A 只同意了 RECOMMENDATION        → 引力（推荐）计入她；运营逐人明细看不到她；
//	B 只同意了 OPERATOR_AUDIENCE_DETAIL → 运营逐人明细看得到他；引力不计入他；
//	C 只有退役的旧大开关 BEHAVIOR_ANALYTICS → 哪边都不算。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/consent"
	"github.com/proxy-app/proxy-api/internal/gravity"
)

func TestEachPurposeOnlyUnlocksItsOwnReaders(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	a, b, c := "user_cp_reco_"+stamp, "user_cp_ops_"+stamp, "user_cp_legacy_"+stamp
	post := "post_cp_" + stamp
	users := []string{a, b, c}
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
	grant := func(user, purpose string) {
		exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source)
			VALUES ($1,$2,$3,$4,'GRANT',$5,'TEST')`, "pc_"+user, user, purpose, consent.PolicyVersion(purpose), now.Add(-48*time.Hour))
	}
	grant(a, consent.Recommendation)
	grant(b, consent.OperatorAudienceDetail)
	grant(c, consent.LegacyBehaviorAnalytics)
	for _, u := range users {
		exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at)
			VALUES ($1,'POST_IMPRESSION',$2,'POST',$3,$4)`, "evt_"+u, u, post, now.Add(-24*time.Hour))
	}

	occ, err := gravity.NewPostgres(pool).Occurrences(ctx, now.Add(-30*24*time.Hour))
	if err != nil {
		t.Fatalf("gravity: %v", err)
	}
	browse := map[string]int{}
	for _, o := range occ {
		if o.EventType == "BROWSE_ACTIVE" {
			browse[o.UserID]++
		}
	}
	if browse[a] != 1 || browse[b] != 0 || browse[c] != 0 {
		t.Fatalf("recommendation / gravity reads only RECOMMENDATION consents: %v", browse)
	}

	audience, err := NewLocalNetRepository(pool).ListPostAudience(ctx, post, 50)
	if err != nil {
		t.Fatalf("audience: %v", err)
	}
	seen := map[string]bool{}
	for _, row := range audience {
		seen[row.ActorID] = true
	}
	if !seen[b] || seen[a] || seen[c] {
		t.Fatalf("the operator's per-person detail shows only people who consented to OPERATOR_AUDIENCE_DETAIL: %v", seen)
	}
}
