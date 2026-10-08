package postgres

// STORE-CROWD-001：场地时段现状对真库跑 —— 人数是 CONFIRMED 报名（一对 2 人、没有同行人 1 人），
// 只比较同一个时间标签，取消的不算。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
)

func TestVenueSlotLoadsCountPeopleOfConfirmedBookingsAtTheSameTimeLabel(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	label := "周六 15:00 crowd " + stamp
	a, b, other := "act_crowd_a_"+stamp, "act_crowd_b_"+stamp, "act_crowd_other_"+stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id IN ($1,$2,$3)`, a, b, other)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id IN ($1,$2,$3)`, a, b, other)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	act := `INSERT INTO activity.activities (id, payload, interested_count, joined_count, capacity, created_at)
		VALUES ($1, jsonb_build_object('title', $1::text, 'venueName', $2::text, 'realitySceneId', $3::text, 'time', $4::text), 0, $5, 10, now())`
	exec(act, a, "Cafe A", "scene_crowd_a", label, 3)
	exec(act, b, "Cafe B", "scene_crowd_b", label, 1)
	exec(act, other, "Cafe A", "scene_crowd_a", "周日 10:00 crowd "+stamp, 1) // 别的时间标签：不在结果里
	book := func(actID, actor, companion, state string) {
		exec(`INSERT INTO activity.participants (activity_id, actor_id, companion_id, slot_key, state) VALUES ($1,$2,$3,$4,$5)`,
			actID, actor, companion, "slot_"+actor, state)
	}
	book(a, "u1", "c1", "CONFIRMED") // 一对 = 2 人
	book(a, "u2", "c2", "CONFIRMED") // 2 人
	book(a, "u3", "", "CONFIRMED")   // 没有同行人 = 1 人
	book(a, "u4", "c4", "CANCELLED") // 取消的不算
	book(b, "u5", "c5", "CONFIRMED")
	book(other, "u6", "c6", "CONFIRMED")

	loads, err := NewActivityRepository(pool).VenueSlotLoads(ctx, a)
	if err != nil {
		t.Fatalf("VenueSlotLoads: %v", err)
	}
	byID := map[string]activity.VenueSlotLoad{}
	for _, l := range loads {
		byID[l.ActivityID] = l
	}
	if len(byID) != 2 || byID[other].ActivityID != "" {
		t.Fatalf("only the same time label is returned: %+v", loads)
	}
	if byID[a].People != 5 || byID[a].VenueName != "Cafe A" || byID[a].SceneID != "scene_crowd_a" || byID[a].Joined != 3 || byID[a].Capacity != 10 {
		t.Fatalf("A: 2 pairs + 1 single = 5 people, cancelled excluded: %+v", byID[a])
	}
	if byID[b].People != 2 {
		t.Fatalf("B: one pair = 2 people: %+v", byID[b])
	}
	if _, err := NewActivityRepository(pool).VenueSlotLoads(ctx, "act_missing_"+stamp); err != activity.ErrActivityNotFound {
		t.Fatalf("an unknown activity is ErrActivityNotFound, not an empty list: %v", err)
	}
}
