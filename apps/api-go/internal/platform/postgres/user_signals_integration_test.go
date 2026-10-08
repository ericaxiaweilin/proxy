package postgres

// MARKET-RANK-001：按用户账号读撮合信号（市场报名人是用户账号，不是供给档案 id），对真库跑。
// 位置优先级与 App「附近」相同：本人实时位置 > 接单资料坐标。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

func TestUserSignalsPreferLiveLocationAndReadGravityByUser(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	live, fallback, bare := "user_rank_live_"+stamp, "user_rank_fb_"+stamp, "user_rank_bare_"+stamp
	cleanup := func() {
		bg := context.Background()
		for _, id := range []string{live, fallback, bare} {
			_, _ = pool.Exec(bg, `DELETE FROM decision.user_event_states WHERE user_id = $1`, id)
			_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE user_account_id = $1`, id)
			_, _ = pool.Exec(bg, `DELETE FROM identity.profiles WHERE user_account_id = $1`, id)
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	profile := `INSERT INTO identity.profiles (user_account_id, name, handle, city, lat, lng, updated_at) VALUES ($1, 'p', $2, 'hn', $3, $4, now())`
	exec(profile, live, "h_live_"+stamp, 21.03, 105.85)
	exec(profile, fallback, "h_fb_"+stamp, nil, nil)
	agent := `INSERT INTO supply.agent_profiles (agent_id, user_account_id, name, lat, lng, created_at, updated_at) VALUES ($1, $2, 'a', $3, $4, now(), now())`
	exec(agent, "agent_"+live, live, 10.0, 106.0) // 接单资料坐标在胡志明：本人实时位置应当赢
	exec(agent, "agent_"+fallback, fallback, 21.00, 105.80)
	exec(`INSERT INTO decision.user_event_states (user_id, event_type, context_key, p60, model_version, computed_at) VALUES ($1, 'CHAT_ACTIVE', '', 0.8, 'test', now())`, live)

	signals, err := matching.NewPostgres(pool).UserSignals(ctx, []string{live, fallback, bare})
	if err != nil {
		t.Fatalf("UserSignals: %v", err)
	}
	if s := signals[live]; s.Lat == nil || *s.Lat != 21.03 || s.ChatP60 == nil || *s.ChatP60 != 0.8 {
		t.Fatalf("live location wins over the agent profile, gravity is read by user id: %+v", s)
	}
	if s := signals[fallback]; s.Lat == nil || *s.Lat != 21.00 {
		t.Fatalf("without a live location the agent profile coordinates are used: %+v", s)
	}
	if s := signals[bare]; s.Lat != nil || s.ChatP60 != nil || s.ActiveLoad != 0 {
		t.Fatalf("someone with no profile at all still comes back, with nothing guessed: %+v", s)
	}
}
