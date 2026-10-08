package postgres

// STORE-ATTRIBUTION-P1（钉）「门店预约与承载」读模型必须真的跑在真库上。
//
// 为什么 api 层那组测试不够：它用假 source，只证明 handler 会转发字段，**一个字都不
// 证明 SQL 能跑**。这一页的 SQL 全部踩在几个只有真 schema 才会现原形的点上：
//   - activity.activities 没有场景专列（037），场景只在 payload->>'realitySceneId'；
//   - participants 有一串后加的列（137 order_no、144 state、162 companion_id 进了主键、
//     191 store_id），少写一列或者把 '' 写进 store_id 都会被读成「有归因」；
//   - business.stores 的 reality_scene_id 默认值是空串（135），不去 guard 就是拿空场景
//     去匹配一堆没挂场景的店；
//   - 门店侧的快照必须用 LATERAL 取最新一条 —— 并排 join 会把预约数按快照行数乘一遍，
//     而那个数字看起来完全正常（不是 0、不是 null），只有把已知种子量摆在那里对撞
//     才看得出来。
//
// 口径同时被钉住：2 单 CONFIRMED + 1 单取消归给 A 店、1 单完全没有门店 ⇒ 覆盖率 3/4；
// B 店**一条快照都没有**，它的承载五列必须全是 null（不是 0%）。

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/storeboard"
)

func TestStoreBoardReadModelRunsAgainstRealSchema(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	since := now.Add(-30 * 24 * time.Hour)

	owner, biz := "user_sb_"+run, "biz_sb_"+run
	// A 店：被认领的场景 + 有承载快照；B 店：没有任何快照。
	storeA, storeB := "st_sb_a_"+run, "st_sb_b_"+run
	sceneA, sceneUnclaimed := "scene_sb_a_"+run, "scene_sb_open_"+run
	actA, actUnclaimed := "act_sb_a_"+run, "act_sb_open_"+run

	seedBusinessUsersPG(t, pool, []string{owner})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	// 清理顺序：报名 → 活动 → 快照 → 门店 → 主体 → 账号（049 给
	// business.accounts.owner_user_id 加了 ON DELETE RESTRICT，账号必须最后删）。
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range []string{actA, actUnclaimed} {
			if _, err := pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id=$1`, id); err != nil {
				t.Errorf("cleanup participants %s: %v", id, err)
			}
			if _, err := pool.Exec(bg, `DELETE FROM activity.activities WHERE id=$1`, id); err != nil {
				t.Errorf("cleanup activity %s: %v", id, err)
			}
		}
		if _, err := pool.Exec(bg, `DELETE FROM business.scene_supply_snapshots WHERE store_id = ANY($1)`, []string{storeA, storeB}); err != nil {
			t.Errorf("cleanup snapshots: %v", err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM business.stores WHERE id = ANY($1)`, []string{storeA, storeB}); err != nil {
			t.Errorf("cleanup stores: %v", err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM business.accounts WHERE id=$1`, biz); err != nil {
			t.Errorf("cleanup account: %v", err)
		}
		cleanupBusinessUsersPG(t, pool, []string{owner})
	})

	exec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$2,'Store Board Co','ACTIVE',now())`, biz, owner)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at, reality_scene_id) VALUES
		($1,$2,'有承载的店','Addr','ACTIVE',now(),$4),
		($3,$2,'没有快照的店','Addr','ACTIVE',now(),'')`, storeA, biz, storeB, sceneA)

	// 两场活动：A 挂在被 A 店认领的场景上，另一场挂一个没人认领的场景。
	// 场景 id 只在 payload JSONB 里（037 建表时 activities 没有专列）—— 活动 id 本身
	// 带 run 后缀，所以 A 店那场除了 id 匹配没有第二条路能命中。
	exec(`INSERT INTO activity.activities (id, payload, interested_count, joined_count, capacity, created_at) VALUES
		($1, jsonb_build_object('title','有门店的场景','realitySceneId',$3::text), 0, 3, 10, now()),
		($2, jsonb_build_object('title','没人认领的场景','realitySceneId',$4::text), 0, 1, 10, now())`,
		actA, actUnclaimed, sceneA, sceneUnclaimed)

	// 报名：A 店 2 单 CONFIRMED + 1 单 CANCELLED（窗口外再留一单，边界必须真的生效）；
	// 另有 1 单挂在没人认领的场景上，**完全没有门店**（NULL，不是 ''）。
	// state / store_id 都是后加的列；store_id 写 NULL 才是「没有归因」。
	book := func(activityID, actor, state string, storeID *string, joinedAt time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO activity.participants (activity_id, actor_id, companion_id, slot_key, state, joined_at, updated_at, store_id)
			VALUES ($1,$2,'',$3,$4,$5,now(),$6)`,
			activityID, actor, "slot_"+actor, state, joinedAt, storeID); err != nil {
			t.Fatalf("seed participant %s: %v", actor, err)
		}
	}
	storeAPtr := storeA
	book(actA, "user_sb_p1_"+run, "CONFIRMED", &storeAPtr, now.Add(-3*time.Hour))
	book(actA, "user_sb_p2_"+run, "CONFIRMED", &storeAPtr, now.Add(-2*time.Hour))
	book(actA, "user_sb_p3_"+run, "CANCELLED", &storeAPtr, now.Add(-time.Hour))
	// 窗口外的一单：归因了但不该进这个窗口（窗口写成 90 天它就进来了）。
	book(actA, "user_sb_p4_"+run, "CONFIRMED", &storeAPtr, now.Add(-45*24*time.Hour))
	// 没人认领场景上的那一单：store_id 必须真的是 NULL（不是 ''——'' 会被
	// idx_participants_store 的部分索引收进去，把没归因的单算成有归因）。
	book(actUnclaimed, "user_sb_p5_"+run, "CONFIRMED", nil, now.Add(-5*time.Hour))

	// A 店两条快照：故意先插旧的再插新的 —— 取错（ORDER BY 写反、取 created_at、
	// 或不取最新而取了最早）都会读出 12/25 而不是 61/74。
	exec(`INSERT INTO business.scene_supply_snapshots
		(business_id,store_id,scene_id,current_capacity_pct,forecast_capacity_pct,accepting_traffic,confidence,recorded_at,source)
		VALUES ($1,$2,$3,12,25,false,0.5,$4,'MEASURED'), ($1,$2,$3,61,74,true,0.8,$5,'MEASURED')`,
		biz, storeA, sceneA, now.Add(-90*time.Minute), now.Add(-12*time.Minute))

	board, err := storeboard.NewPostgres(pool).Board(ctx, since)
	if err != nil {
		t.Fatalf("Board 对真库执行失败（列名/别名/join key 一错就是这里）: %v", err)
	}

	// 覆盖率：窗口内 4 单（A 店 3 单 + 挂在无人认领场景上的那 1 单），其中 3 单带
	// store_id。窗口外那 1 单不该被算进来（窗口写成 90 天就是 5/4）。
	if board.Coverage.Bookings != 4 || board.Coverage.Attributed != 3 {
		t.Fatalf("覆盖率错（窗口外那一单必须不计、NULL 不算有归因）: bookings=%d attributed=%d",
			board.Coverage.Bookings, board.Coverage.Attributed)
	}
	if board.Coverage.Rate == nil || math.Abs(*board.Coverage.Rate-0.75) > 1e-9 {
		t.Fatalf("coverage.rate = %v, want 0.75（归因率是这个页面最容易被读成「多少单跑了」的数）", board.Coverage.Rate)
	}
	if board.AttributedSince == nil {
		t.Fatalf("attributedSince 不能为 null：库里已经有带门店的报名，页面要拿它解释历史老单为什么不归因")
	}

	byID := map[string]storeboard.StoreRow{}
	for _, row := range board.Stores {
		byID[row.StoreID] = row
	}
	a, ok := byID[storeA]
	if !ok {
		t.Fatalf("A 店没出现在列表里（ACTIVE 过滤错了？）: %+v", board.Stores)
	}
	if a.Name != "有承载的店" || a.BusinessID != biz {
		t.Fatalf("身份字段读错: %+v", a)
	}
	// 并排 join 快照会把这三个数各自乘 2 —— 2/1 与 2/0 同时成立才算没有 fan-out。
	if a.Bookings != 2 || a.Cancelled != 1 {
		t.Fatalf("A 店计数错（2 单 CONFIRMED + 1 单取消，窗口外那一单不该在）: bookings=%d cancelled=%d", a.Bookings, a.Cancelled)
	}
	if a.CancelRate == nil || math.Abs(*a.CancelRate-1.0/3.0) > 1e-9 {
		t.Fatalf("A 店取消率 = %v, want 1/3（分母是 bookings + cancelled）", a.CancelRate)
	}
	// 快照必须取最新那条（61/74，not 12/25）。
	if a.CapacityPct == nil || *a.CapacityPct != 61 || a.ForecastPct == nil || *a.ForecastPct != 74 {
		t.Fatalf("最新快照读错（期望 61/74）: capacity=%v forecast=%v", a.CapacityPct, a.ForecastPct)
	}
	if a.AcceptingTraffic == nil || !*a.AcceptingTraffic {
		t.Fatalf("acceptingTraffic = %v, want true（最新那条说接流量）", a.AcceptingTraffic)
	}
	if a.SnapshotAt == nil || math.Abs(float64(now.Sub(*a.SnapshotAt).Minutes())-12) > 2 {
		t.Fatalf("snapshotAt 不是最新那条: %v", a.SnapshotAt)
	}
	if a.SnapshotAgeMinutes == nil || *a.SnapshotAgeMinutes < 10 || *a.SnapshotAgeMinutes > 15 {
		t.Fatalf("snapshotAgeMinutes = %v, want ~12（页面据此把超过 60 分钟的标红）", a.SnapshotAgeMinutes)
	}

	b, ok := byID[storeB]
	if !ok {
		t.Fatalf("B 店没出现在列表里（它也是 ACTIVE，没有快照不等于没有门店）: %+v", board.Stores)
	}
	if b.Bookings != 0 || b.Cancelled != 0 || b.CancelRate != nil {
		t.Fatalf("B 店没有单：计数是 0（真计数），取消率是 null（算不出来）: %+v", b)
	}
	// 关键一条：一家**从未上报过**承载的店，五列必须全是 null。写成 0 就是谎报
	// 「这家店报告它现在空着」。
	if b.CapacityPct != nil || b.ForecastPct != nil || b.AcceptingTraffic != nil ||
		b.SnapshotAt != nil || b.SnapshotAgeMinutes != nil {
		t.Fatalf("B 店没有任何快照，承载五列必须全是 null: %+v", b)
	}

	// 没人认领的场景：unclaimed 那一场（而且必须排除掉 A 店那一场 —— 不加 NOT EXISTS
	// 或者忘了 status='ACTIVE'，A 店那场不会被算进来，但一个 CLOSED 店认领的场景
	// 会被错算进去）。
	if board.UnclaimedScenes < 1 {
		t.Fatalf("无人认领的场景数至少 1（actUnclaimed 挂着 %s，没有任何 ACTIVE 店认领）: %d",
			sceneUnclaimed, board.UnclaimedScenes)
	}

	// 排序：bookings DESC（同数按店名）。这个断言不依赖全库别的行 —— 只检查列表自身
	// 单调不增，且预约多的 A 店必须排在 0 单的 B 店前面。
	for i := 1; i < len(board.Stores); i++ {
		if board.Stores[i-1].Bookings < board.Stores[i].Bookings {
			t.Fatalf("排序不是 bookings DESC: %+v", board.Stores)
		}
	}
	if idxA, idxB := indexOfStore(board.Stores, storeA), indexOfStore(board.Stores, storeB); idxA > idxB {
		t.Fatalf("2 单的 A 店必须排在 0 单的 B 店前面: A@%d B@%d", idxA, idxB)
	}
}

func indexOfStore(rows []storeboard.StoreRow, storeID string) int {
	for i, row := range rows {
		if row.StoreID == storeID {
			return i
		}
	}
	return -1
}
