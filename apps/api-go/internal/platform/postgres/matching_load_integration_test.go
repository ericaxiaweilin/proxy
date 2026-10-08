package postgres

// DISPATCH-RANK-002：撮合信号里新加的「位置」与「负载」对**真库**跑。
// 负载 = 没过期的 OFFERED 邀约 + 没结束的订单；过期的邀约、已完成 / 已取消的订单都不算。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

func TestMatchingSignalsCarryLocationAndOpenLoad(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	agent := "agent_dispatch_probe_" + time.Now().Format("150405.000000")
	cleanup := func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM fulfillment.offers WHERE agent_id = $1`, agent)
		_, _ = pool.Exec(bg, `DELETE FROM fulfillment.orders WHERE agent_id = $1`, agent)
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id = $1`, agent)
	}
	cleanup()
	t.Cleanup(cleanup)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO supply.agent_profiles (agent_id, name, lat, lng, created_at, updated_at) VALUES ($1, 'probe', 21.0285, 105.8542, now(), now())`, agent)
	offer := `INSERT INTO fulfillment.offers (id, task_id, slot_id, requester_id, agent_id, status, expires_at, created_at, updated_at)
		VALUES ($1, 't', 's', 'r', $2, $3, $4, now(), now())`
	exec(offer, agent+"_live", agent, "OFFERED", time.Now().Add(5*time.Minute))
	exec(offer, agent+"_stale", agent, "OFFERED", time.Now().Add(-5*time.Minute))
	exec(offer, agent+"_taken", agent, "ACCEPTED", time.Now().Add(5*time.Minute))
	order := `INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, snapshot, created_at, updated_at)
		VALUES ($1, 'r', $2, 'n', $3, '{}'::jsonb, now(), now())`
	// 库里的守卫只许新订单以 OFFERED / CONFIRMED 落地；结束态得走一次真实的状态流转。
	exec(order, agent+"_o1", agent, "CONFIRMED")
	exec(order, agent+"_o3", agent, "CONFIRMED")
	exec(`UPDATE fulfillment.orders SET lifecycle = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, agent+"_o3")

	signals, err := matching.NewPostgres(pool).Signals(ctx, []string{agent})
	if err != nil {
		t.Fatalf("Signals: %v", err)
	}
	s := signals[agent]
	if s.ActiveLoad != 2 {
		t.Fatalf("open load = live offer + confirmed order = 2 (stale offer, accepted offer, cancelled order do not count), got %d", s.ActiveLoad)
	}
	if s.Lat == nil || s.Lng == nil || *s.Lat != 21.0285 {
		t.Fatalf("location must come back for distance scoring: %+v", s)
	}
}
