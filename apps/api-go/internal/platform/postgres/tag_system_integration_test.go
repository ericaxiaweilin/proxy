package postgres

// TAG-SYSTEM-001：标签层对真库跑——证据只来自「有同意的事实」，撤回之后标签被清掉，
// 粗粒度位置要两道同意都在。纯规则（强度 / 置信度 / 门槛）在 internal/tagging 里测。

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/tagging"
)

func TestTagLayerOnlyBuildsFromConsentedFactsAndClearsOnWithdrawal(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	granted, never, withdrawn, explicit, located, noLoc := "u_tag_g_"+stamp, "u_tag_n_"+stamp, "u_tag_w_"+stamp, "u_tag_e_"+stamp, "u_tag_l_"+stamp, "u_tag_nl_"+stamp
	users := []string{granted, never, withdrawn, explicit, located, noLoc}
	posts := []string{"p_tag_c_" + stamp}
	activity := "a_tag_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM tag.coarse_locations WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM location.location_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM activity.interests WHERE activity_id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = ANY($1)`, posts)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, scene_type) VALUES ($1,'USER','someone','x',$2,'COFFEE')`, posts[0], now)
	exec(`INSERT INTO activity.activities (id, payload) VALUES ($1, '{"category":"HIKING"}'::jsonb)`, activity)

	consent := func(user, action string, at time.Time) {
		exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source)
			VALUES ($1,$2,'RECOMMENDATION','2026-10-08',$3,$4,'TEST')`, fmt.Sprintf("pc_%s_%s_%d", user, action, at.UnixNano()), user, action, at)
	}
	impressions := func(user string, n int) {
		for i := 0; i < n; i++ {
			exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms)
				VALUES ($1,'POST_IMPRESSION',$2,'POST',$3,$4,20000)`, fmt.Sprintf("evt_%s_%d", user, i), user, posts[0], now.Add(-time.Duration(i+1)*time.Hour))
		}
	}
	consent(granted, "GRANT", now.Add(-72*time.Hour))
	impressions(granted, 6)
	impressions(never, 6) // 从没同意过
	consent(withdrawn, "GRANT", now.Add(-72*time.Hour))
	impressions(withdrawn, 6)

	// 主动表态：不需要浏览同意。
	exec(`INSERT INTO activity.interests (activity_id, actor_id, created_at) VALUES ($1,$2,$3)`, activity, explicit, now.Add(-time.Hour))

	// 位置：located 两道同意都在；noLoc 只有采集同意。
	consent(located, "GRANT", now.Add(-72*time.Hour))
	consent(noLoc, "GRANT", now.Add(-72*time.Hour))
	exec(`INSERT INTO location.location_consents (id, user_id, kind, status, granted_at, expires_at, duration_seconds)
		VALUES ($1,$2,'FUZZY_REGION','GRANTED',$3,$4,86400)`, "lc_"+stamp, located, now.Add(-2*time.Hour), now.Add(24*time.Hour))
	for _, u := range []string{located, noLoc} {
		for d := 0; d < 4; d++ {
			exec(`INSERT INTO tag.coarse_locations (user_id, cell, observed_at) VALUES ($1,'21.03,105.85',$2)`, u, now.Add(-time.Duration(d)*24*time.Hour-time.Hour))
		}
	}

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	has := func(user, axis, value string) bool {
		tags, err := store.TagsOf(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		for _, tg := range tags {
			if tg.Axis == axis && tg.Value == value {
				return true
			}
		}
		return false
	}
	if !has(granted, tagging.AxisInterestScene, "COFFEE") {
		t.Fatal("six consented, long-dwell impressions on COFFEE posts must give an interest tag")
	}
	if has(never, tagging.AxisInterestScene, "COFFEE") {
		t.Fatal("events without any consent must never become a tag")
	}
	if !has(withdrawn, tagging.AxisInterestScene, "COFFEE") {
		t.Fatal("before withdrawal she has the tag")
	}
	if !has(explicit, tagging.AxisInterestActivity, "HIKING") {
		t.Fatal("an explicit 'interested' needs no browsing consent and gives an activity tag")
	}
	if !has(located, tagging.AxisArea, "21.03,105.85") {
		t.Fatal("4 distinct days under both consents is an area tag")
	}
	if has(noLoc, tagging.AxisArea, "21.03,105.85") {
		t.Fatal("without a live location consent the coarse cells must not become a tag")
	}

	// 撤回：下一轮重算必须把她已有的标签清掉（她不在「最近有证据的人」里，但在「有标签的人」里）。
	consent(withdrawn, "WITHDRAW", now.Add(time.Second))
	if _, err := tagging.Recompute(ctx, store, now.Add(2*time.Second)); err != nil {
		t.Fatalf("Recompute after withdrawal: %v", err)
	}
	if has(withdrawn, tagging.AxisInterestScene, "COFFEE") {
		t.Fatal("withdrawn consent must clear the tag on the next recompute")
	}
	if !has(granted, tagging.AxisInterestScene, "COFFEE") {
		t.Fatal("the other user's tag must survive")
	}
	stats, err := store.Stats(ctx, now.Add(2*time.Second))
	if err != nil || stats.UsersWithTags < 3 {
		t.Fatalf("stats: %+v err=%v", stats, err)
	}
}
