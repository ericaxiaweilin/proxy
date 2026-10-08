package postgres

// MARKET-FAST-001：市场发单看板的读模型对**真库**跑（dispatch.runs / steps + marketplace.applications）。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
)

func TestMarketStatsAreComputedFromTheTablesAndNullWhenThereIsNothingToDivide(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := dispatch.NewPostgres(pool)
	stamp := time.Now().Format("150405.000000")
	since := time.Now().UTC().Add(-2 * time.Hour)

	// 先量一次空窗口（只看我们这批；别的测试 / 数据可能也有 MARKET 单，所以用一个只含本测试的未来窗口）。
	future := time.Now().UTC().Add(24 * time.Hour)
	empty, err := store.MarketStats(ctx, future)
	if err != nil {
		t.Fatalf("MarketStats(empty window): %v", err)
	}
	if empty.ConfirmRate != nil || empty.ExpiryRate != nil || empty.MedianMinutesToAssign != nil ||
		empty.InvitedThenApplied != nil || empty.InvitedThenAppliedRate != nil || len(empty.InviteSkipped) != 0 {
		t.Fatalf("with no runs every ratio is null, never 0: %+v", empty)
	}

	opps := []string{"opp_ms_a_" + stamp, "opp_ms_b_" + stamp, "opp_ms_c_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.applications WHERE opportunity_id = ANY($1)`, opps)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch.runs WHERE task_id = ANY($1)`, opps)
	})
	now := time.Now().UTC()
	insertRun := func(id, opp, status string, waiting bool, invited string, created time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO dispatch.runs
			(id, task_id, slot_id, requester_id, batch_id, budget_vnd, status, candidates, cursor, created_at, updated_at, version, kind, waiting, invited)
			VALUES ($1,$2,'market','owner_ms','market',0,$3,'[]'::jsonb,0,$4,$4,1,'MARKET',$5,$6::jsonb)`, id, opp, status, created, waiting, invited); err != nil {
			t.Fatalf("insert run %s: %v", id, err)
		}
	}
	step := func(run, kind, detail string, at time.Time) {
		t.Helper()
		var d any
		if detail != "" {
			d = detail
		}
		if _, err := pool.Exec(ctx, `INSERT INTO dispatch.steps (run_id, kind, actor, detail, at) VALUES ($1,$2,'dispatch',$3::jsonb,$4)`, run, kind, d, at); err != nil {
			t.Fatalf("insert step %s/%s: %v", run, kind, err)
		}
	}
	// A：代选两次，第一次超时，第二次被接（10 分钟成单）；B：试完没人接（EXHAUSTED），邀请了两个人其中一个报了名；
	// C：还在等人报名，邀请不了（没坐标）。
	insertRun("run_ms_a_"+stamp, opps[0], "ASSIGNED", false, `[]`, now.Add(-30*time.Minute))
	step("run_ms_a_"+stamp, "OFFER_SENT", `{"price":0}`, now.Add(-29*time.Minute))
	step("run_ms_a_"+stamp, "EXPIRED", "", now.Add(-24*time.Minute))
	step("run_ms_a_"+stamp, "OFFER_SENT", `{"price":0}`, now.Add(-24*time.Minute))
	step("run_ms_a_"+stamp, "ACCEPTED", "", now.Add(-20*time.Minute))
	insertRun("run_ms_b_"+stamp, opps[1], "EXHAUSTED", false, `["inv_x","inv_y"]`, now.Add(-50*time.Minute))
	step("run_ms_b_"+stamp, "INVITED", `{"invitees":["inv_x","inv_y"],"round":1}`, now.Add(-40*time.Minute))
	step("run_ms_b_"+stamp, "OWNER_TOOK_OVER", `{"reason":"x"}`, now.Add(-35*time.Minute))
	insertRun("run_ms_c_"+stamp, opps[2], "RUNNING", true, `[]`, now.Add(-5*time.Minute))
	step("run_ms_c_"+stamp, "INVITE_SKIPPED", `{"reason":"opportunity_has_no_location"}`, now.Add(-4*time.Minute))
	if _, err := pool.Exec(ctx, `INSERT INTO marketplace.opportunities (id, owner_id, payload) VALUES ($1,'owner_ms','{}'::jsonb) ON CONFLICT DO NOTHING`, opps[1]); err != nil {
		t.Fatalf("opportunity: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at) VALUES ($1,$2,'inv_x','{}'::jsonb, now())`, "app_ms_"+stamp, opps[1]); err != nil {
		t.Fatalf("application: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM marketplace.opportunities WHERE id = ANY($1)`, opps)
	})

	got, err := store.MarketStats(ctx, since)
	if err != nil {
		t.Fatalf("MarketStats: %v", err)
	}
	// 其它测试可能留下别的 MARKET 单，所以只断言「至少」本测试插入的量，并精确断言只与本批有关的派生值的方向。
	if got.Assigned < 1 || got.Exhausted < 1 || got.Running < 1 || got.WaitingForApplicants < 1 {
		t.Fatalf("status counts: %+v", got)
	}
	if got.Selections < 2 || got.Expired < 1 || got.ExpiryRate == nil || got.OwnerTookOver < 1 {
		t.Fatalf("selection / expiry / take-over counts: %+v", got)
	}
	if got.Invitations < 1 || got.InvitedPeople < 2 || got.InviteSkipped["opportunity_has_no_location"] < 1 {
		t.Fatalf("invitations: %+v", got)
	}
	if got.InvitedThenApplied == nil || *got.InvitedThenApplied < 1 || got.InvitedThenAppliedRate == nil {
		t.Fatalf("one of the two invited people applied: %+v", got)
	}
	if got.MedianMinutesToAssign == nil || *got.MedianMinutesToAssign < 9 || *got.MedianMinutesToAssign > 11 {
		t.Fatalf("A was accepted 10 minutes after creation: %v", got.MedianMinutesToAssign)
	}
	if got.ConfirmRate == nil {
		t.Fatalf("assigned + exhausted give a denominator: %+v", got)
	}
}
