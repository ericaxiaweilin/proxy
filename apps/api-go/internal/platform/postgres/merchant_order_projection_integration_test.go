package postgres

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/command"
)

// MERCHANT-OUTCOME-PROJECTION-001（端到端钉）：商家经营结果为 0 的真身是
// 订单从来没投进 spend_daily。这条测试走真实命令链路：
// 建商家 → 建店 → 店主认领场景 → 顾客报名挂在场景上的活动 ⇒
// 经营结果必须长出来；取消 ⇒ 扣回；没被认领的场景 ⇒ 与任何商家无关。

const merchantSpendBackfillSQLFile = "../../../migrations/156_backfill_merchant_spend_daily.sql"

func projEnvelope(kind, actor, targetID string, payload map[string]any) command.Envelope {
	key := kind + "_" + actor + "_" + targetID + "_" + itoa(time.Now().UnixNano())
	return command.Envelope{
		CommandID: key, CommandType: kind, CommandVersion: 1,
		Actor:     command.Actor{Type: "USER", ID: actor},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target:    command.Target{Type: "Activity", ID: targetID}, IdempotencyKey: key,
		CorrelationID: "corr_proj", RequestedAt: "2026-10-02T00:00:00Z", Payload: payload,
	}
}

func TestMerchantOrderProjectionEndToEnd(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()
	owner := "user_proj_owner_" + itoa(run)
	custA := "user_proj_a_" + itoa(run)
	custB := "user_proj_b_" + itoa(run)
	seedBusinessUsersPG(t, pool, []string{owner, custA, custB})
	t.Cleanup(func() { cleanupBusinessUsersPG(t, pool, []string{owner, custA, custB}) })

	bizSvc := business.NewWithRepository(NewBusinessRepository(pool))
	r := bizSvc.HandleContext(ctx, bizEnvelope("CreateBusinessAccount", map[string]any{"name": "Projection Cafe"}, owner))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessAccount: %+v", r.Error)
	}
	bizID := readStringBiz(r.OperationRef, "businessId")
	r = bizSvc.HandleContext(ctx, bizEnvelope("CreateBusinessStore", map[string]any{"businessId": bizID, "name": "Proj Store", "address": "Cau Giay"}, owner))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessStore: %+v", r.Error)
	}
	storeID := readStringBiz(r.OperationRef, "storeId")
	scene := "scene_proj_" + itoa(run)
	r = bizSvc.HandleContext(ctx, bizEnvelope("LinkStoreToRealityScene", map[string]any{"storeId": storeID, "sceneId": scene}, owner))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("LinkStoreToRealityScene: %+v", r.Error)
	}

	actRepo := NewActivityRepository(pool)
	svc := activity.NewWithRepository(actRepo)
	svc.SetOrderProjector(NewBusinessRepository(pool))

	suffix := itoa(run)
	act1, act2, act3 := "act_proj1_"+suffix, "act_proj2_"+suffix, "act_proj3_"+suffix
	t.Cleanup(func() {
		for _, id := range []string{act1, act2, act3} {
			if _, err := pool.Exec(ctx, `DELETE FROM activity.participants WHERE activity_id=$1`, id); err != nil {
				t.Errorf("cleanup participants %s: %v", id, err)
			}
			if _, err := pool.Exec(ctx, `DELETE FROM activity.activities WHERE id=$1`, id); err != nil {
				t.Errorf("cleanup activity %s: %v", id, err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM business.spend_daily WHERE business_id=$1`, bizID); err != nil {
			t.Errorf("cleanup spend_daily: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM business.stores WHERE id=$1`, storeID); err != nil {
			t.Errorf("cleanup store: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM business.memberships WHERE business_id=$1`, bizID); err != nil {
			t.Errorf("cleanup memberships: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM business.accounts WHERE id=$1`, bizID); err != nil {
			t.Errorf("cleanup account: %v", err)
		}
	})
	mustCreate := func(id, sceneID, when string) {
		if err := actRepo.Create(ctx, activity.Activity{ID: id, Origin: "TEST", Status: "PUBLISHED", Title: "投影局 " + id, Time: when, Capacity: 10, RealitySceneID: sceneID}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	mustCreate(act1, scene, "周六 15:00")
	mustCreate(act2, scene, "周日 15:00")
	mustCreate(act3, "scene_unclaimed_"+suffix, "周一 15:00")

	mustJoin := func(actor, id string) {
		if out := svc.HandleContext(ctx, projEnvelope("JoinActivity", actor, id, map[string]any{"activityId": id})); out.Outcome != "ACCEPTED" {
			t.Fatalf("join %s %s: %+v", actor, id, out.Error)
		}
	}
	type totals struct {
		orders, newC, retC int
		gross              int64
	}
	current := func() totals {
		rows, err := NewBusinessRepository(pool).ListSpendDaily(ctx, bizID, 7)
		if err != nil {
			t.Fatalf("ListSpendDaily: %v", err)
		}
		var acc totals
		for _, row := range rows {
			acc.orders += row.OrderCount
			acc.gross += row.GrossMinor
			acc.newC += row.NewCustomerCount
			acc.retC += row.ReturningCustomerCount
		}
		return acc
	}
	expect := func(label string, want totals) {
		t.Helper()
		if got := current(); got != want {
			t.Fatalf("%s: spend_daily totals = %+v, want %+v", label, got, want)
		}
	}

	mustJoin(custA, act1)
	expect("A joins act1", totals{orders: 1, newC: 1})

	mustJoin(custB, act1)
	expect("B joins act1", totals{orders: 2, newC: 2})

	// A 第二次在同一场景的店下单 ⇒ 复访。
	mustJoin(custA, act2)
	expect("A joins act2 (same scene)", totals{orders: 3, newC: 2, retC: 1})

	// 取消扣回复访那一笔（A 在场景里还有 act1 的未取消报名）。
	if out := svc.HandleContext(ctx, projEnvelope("CancelActivity", custA, act2, map[string]any{"activityId": act2})); out.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", out.Error)
	}
	expect("A cancels act2", totals{orders: 2, newC: 2})

	// 没被任何门店认领的场景 ⇒ 与商家无关，一笔都不投。
	mustJoin(custB, act3)
	expect("B joins unclaimed-scene act3", totals{orders: 2, newC: 2})

	// 支付未接：成交金额没有事实来源，必须恒为 0，不编数。
	if got := current(); got.gross != 0 {
		t.Fatalf("gross must stay 0 without payment, got %d", got.gross)
	}

	// 经营首页读的是同一张投影表：订单数必须出现在 outcome 里。
	r = bizSvc.HandleContext(ctx, projEnvelope("GetMerchantOperatingHome", owner, bizID, map[string]any{"businessId": bizID}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("GetMerchantOperatingHome: %+v", r.Error)
	}
	var home struct {
		Home struct {
			Outcome struct {
				OrderCount int   `json:"orderCount"`
				GrossMinor int64 `json:"grossMinor"`
			} `json:"outcome"`
			Pulse struct {
				State string `json:"state"`
			} `json:"operatingPulse"`
		} `json:"home"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &home); err != nil {
		t.Fatal(err)
	}
	if home.Home.Outcome.OrderCount != 2 || home.Home.Pulse.State != "ACTIVE" {
		t.Fatalf("operating home must show projected orders: %+v", home)
	}
}

// MERCHANT-OUTCOME-PROJECTION-001（backfill 钉）：投影桥只对**接线之后**的
// 下单生效，接线前已存在的报名必须靠 migration 156 从事实表补投。
// 钉三件事：口径与桥一致（取消不算、未认领场景不算、复访按 nth 算）、
// 重跑幂等、已有桶不被覆盖（人工录的数据不能被推导踩掉）。
func TestMerchantSpendBackfillFromParticipants(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()
	suffix := itoa(run)
	bizID := "biz_bf_" + suffix
	storeID := "store_bf_" + suffix
	scene := "scene_bf_" + suffix
	custA := "user_bf_a_" + suffix
	custC := "user_bf_c_" + suffix
	seedBusinessUsersPG(t, pool, []string{custA, custC})

	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("exec: %v\n%s", err, sql)
		}
	}
	t.Cleanup(func() {
		for _, id := range []string{"act_bf1_" + suffix, "act_bf2_" + suffix, "act_bf3_" + suffix} {
			mustExec(`DELETE FROM activity.participants WHERE activity_id=$1`, id)
			mustExec(`DELETE FROM activity.activities WHERE id=$1`, id)
		}
		mustExec(`DELETE FROM business.spend_daily WHERE business_id=$1`, bizID)
		mustExec(`DELETE FROM business.stores WHERE id=$1`, storeID)
		mustExec(`DELETE FROM business.accounts WHERE id=$1`, bizID)
		cleanupBusinessUsersPG(t, pool, []string{custA, custC})
	})
	mustExec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$2,'Backfill Cafe','ACTIVE',NOW())`, bizID, custA)
	mustExec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at, reality_scene_id) VALUES ($1,$2,'BF Store','Addr','ACTIVE',NOW(),$3)`, storeID, bizID, scene)
	mkAct := func(id, sceneID string) {
		payload, err := json.Marshal(map[string]any{"id": id, "origin": "TEST", "status": "PUBLISHED", "title": "补投局", "capacity": 10, "realitySceneId": sceneID})
		if err != nil {
			t.Fatal(err)
		}
		mustExec(`INSERT INTO activity.activities (id,payload,interested_count,joined_count,capacity) VALUES ($1,$2,0,0,10)`, id, payload)
	}
	act1, act2, act3 := "act_bf1_"+suffix, "act_bf2_"+suffix, "act_bf3_"+suffix
	mkAct(act1, scene)
	mkAct(act2, scene)
	mkAct(act3, "scene_bf_unclaimed_"+suffix)

	day3 := time.Now().AddDate(0, 0, -3)
	day2 := time.Now().AddDate(0, 0, -2)
	mkPart := func(act, actor string, at time.Time, state string) {
		mustExec(`INSERT INTO activity.participants (activity_id, actor_id, joined_at, state) VALUES ($1,$2,$3,$4)`, act, actor, at, state)
	}
	// 事实：A 三天前下 act1（新客）；A 两天前再下 act2（复访）；C 两天前下 act1（新客）；
	// A 两天前的 act2 之外还有一条已取消的 act3 记录（不算）；C 下未认领场景的 act3（不算）。
	mkPart(act1, custA, day3, "CONFIRMED")
	mkPart(act2, custA, day2, "CONFIRMED")
	mkPart(act1, custC, day2, "CONFIRMED")
	mkPart(act3, custC, day2, "CANCELLED")

	sql, err := os.ReadFile(filepath.Clean(merchantSpendBackfillSQLFile))
	if err != nil {
		t.Fatalf("read backfill migration: %v", err)
	}
	assertBuckets := func(label string, wantDay3, wantDay2 [3]int) {
		t.Helper()
		for day, at := range map[int]time.Time{3: day3, 2: day2} {
			want := wantDay3
			if day == 2 {
				want = wantDay2
			}
			var orders, newC, retC int
			if err := pool.QueryRow(ctx, `SELECT order_count, new_customer_count, returning_customer_count FROM business.spend_daily WHERE business_id=$1 AND bucket_date=$2::timestamptz::date`, bizID, at).Scan(&orders, &newC, &retC); err != nil {
				t.Fatalf("%s bucket(%d天前): %v", label, day, err)
			}
			if [3]int{orders, newC, retC} != want {
				t.Fatalf("%s %d天前桶 = %v, want %v", label, day, [3]int{orders, newC, retC}, want)
			}
		}
		var buckets int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM business.spend_daily WHERE business_id=$1`, bizID).Scan(&buckets); err != nil {
			t.Fatal(err)
		}
		if buckets != 2 {
			t.Fatalf("%s: 桶数 = %d, want 2（CANCELLED 与未认领场景不许冒出第三个桶）", label, buckets)
		}
	}
	mustExec(string(sql))
	assertBuckets("首跑", [3]int{1, 1, 0}, [3]int{2, 1, 1})

	// 幂等：重跑不重复计数。
	mustExec(string(sql))
	assertBuckets("重跑", [3]int{1, 1, 0}, [3]int{2, 1, 1})

	// 已有桶不覆盖：人工/桥记过的数字不能被推导踩掉。
	mustExec(`UPDATE business.spend_daily SET order_count=99 WHERE business_id=$1 AND bucket_date=$2::timestamptz::date`, bizID, day3)
	mustExec(string(sql))
	var orders int
	if err := pool.QueryRow(ctx, `SELECT order_count FROM business.spend_daily WHERE business_id=$1 AND bucket_date=$2::timestamptz::date`, bizID, day3).Scan(&orders); err != nil {
		t.Fatal(err)
	}
	if orders != 99 {
		t.Fatalf("已有桶被推导覆盖了：order_count = %d, want 99", orders)
	}
}
