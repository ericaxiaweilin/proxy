package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// FOR-YOU-CANDIDATES-001（2026-10-04，用户：「改成一个单条件 30km 就可以，默认是能接单的，
// 30km 全部的」）：附近的人不再要求先开通接单资料。位置优先取本人上报的位置，没有再
// 退到接单资料的坐标；两边都没有的人不进（距离未知 ≠ 很近）；30km 外的不进。
//
// 原点放在南太平洋（-40, -120），共享开发库里不会有别人落在 30km 内。
func TestNearbyCandidatesAreEveryoneLocatedWithin30kmPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)
	run := itoa(time.Now().UnixNano())
	const lat0, lng0 = -40.0, -120.0

	ids := map[string]string{
		"profileOnly": "near_p_" + run, // 新注册、没开接单，只上报过位置（~5km）
		"agentOnly":   "near_a_" + run, // 只有接单资料的坐标（~10km）
		"both":        "near_b_" + run, // 两边都有：用本人上报的（~1km），不用接单资料的（~100km）
		"silent":      "near_s_" + run, // 没有任何位置
		"far":         "near_f_" + run, // 上报的位置在 ~40km 外
	}
	t.Cleanup(func() {
		for _, id := range ids {
			_, _ = pool.Exec(context.Background(), `DELETE FROM supply.agent_profiles WHERE user_account_id = $1`, id)
			_, _ = pool.Exec(context.Background(), `DELETE FROM identity.profiles WHERE user_account_id = $1`, id)
		}
	})
	for key, id := range ids {
		if _, err := repo.UpsertProfile(ctx, identity.Profile{UserAccountID: id, Name: key, Handle: "@" + id, City: "x", UpdatedAt: time.Now().UTC()}); err != nil {
			t.Fatalf("seed %s: %v", key, err)
		}
	}
	// 1° 纬度 ≈ 111km。
	if err := repo.UpdateProfileLocation(ctx, ids["profileOnly"], lat0+0.045, lng0); err != nil {
		t.Fatalf("locate profileOnly: %v", err)
	}
	if err := repo.UpdateProfileLocation(ctx, ids["both"], lat0+0.009, lng0); err != nil {
		t.Fatalf("locate both: %v", err)
	}
	if err := repo.UpdateProfileLocation(ctx, ids["far"], lat0+0.36, lng0); err != nil {
		t.Fatalf("locate far: %v", err)
	}
	agent := func(id string, lat float64) {
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at, lat, lng, user_account_id)
			VALUES ($1, 'x', '', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'ACTIVE', now(), now(), $2, $3, $4)`,
			"agent_"+id, lat, lng0, id); err != nil {
			t.Fatalf("seed agent %s: %v", id, err)
		}
	}
	agent(ids["agentOnly"], lat0+0.09)
	agent(ids["both"], lat0+0.9)

	if err := repo.UpdateProfileLocation(ctx, "nobody_"+run, lat0, lng0); err == nil {
		t.Fatal("locating a missing profile must fail")
	}

	got, err := repo.ListProfilesNearby(ctx, lat0, lng0, identity.NearbyCandidateRadiusM, nil, nil, identity.MaxNearbyProfileLimit)
	if err != nil {
		t.Fatalf("nearby: %v", err)
	}
	order := []string{}
	for _, p := range got {
		order = append(order, p.UserAccountID)
	}
	want := []string{ids["both"], ids["profileOnly"], ids["agentOnly"]}
	if len(order) != len(want) {
		t.Fatalf("want %v (nearest first), got %v", want, order)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("want %v (nearest first), got %v", want, order)
		}
	}
	if d := *got[0].DistanceM; d > 2000 {
		t.Fatalf("a self-reported location must win over the agent profile: distance %f m", d)
	}
}
