package postgres

// OPS-SUPPLY-HEALTH-001：供给健康度的 SQL 必须对真库跑过。
//
// 这一条尤其重要，因为这一页的**全部价值**就在于按对的列数：
// seller_real_name_verifications 的 user_account_id 整列是 NULL（身份记在 agent_id 上），
// 数错列会得到 0，而 0 会被读成「供给方一个都没核验」—— 那比没有数更坏。
// 所以这里种一行 user_account_id 为 NULL 的核验记录，断言它**被算进**通过数：
// 谁把口径改回 user_account_id，这条就红。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorSupplyHealthCountsByTheRightColumns(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	before, err := store.SupplyHealth(ctx, now)
	if err != nil {
		t.Fatalf("SupplyHealth 基线（列名一错就是这里）: %v", err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	open, closed := "agent_osh_open_"+run, "agent_osh_closed_"+run
	// 订单永不硬删；这两张单的 id 带 run 后缀，不会跟下一轮撞。
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.availability_windows WHERE agent_id = ANY($1)`, []string{open, closed})
		_, _ = pool.Exec(bg, `DELETE FROM supply.capability_verifications WHERE agent_id = ANY($1)`, []string{open})
		_, _ = pool.Exec(bg, `DELETE FROM supply.seller_real_name_verifications WHERE agent_id = ANY($1)`, []string{open, closed})
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id = ANY($1)`, []string{open, closed})
	})

	exec(`INSERT INTO supply.agent_profiles (agent_id, name, bio, languages, status, created_at, updated_at)
		VALUES ($1,'有窗的小美','会讲三种语言',$2,'ACTIVE',now(),now()),
		       ($3,'窗已过期的阿明','',$4,'ACTIVE',now(),now())`,
		open, `["vi","en","zh"]`, closed, `[]`)
	// A：还有一个没到期的窗；B：唯一的窗已经过去了 —— 两个口径必须分得开。
	exec(`INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'hanoi',now(),now()), ($5,$6,$7,$8,'hanoi',now(),now())`,
		"aw_osh_open_"+run, open, now.Add(-time.Hour), now.Add(24*time.Hour),
		"aw_osh_closed_"+run, closed, now.Add(-48*time.Hour), now.Add(-24*time.Hour))
	// 实名核验：user_account_id 故意留 NULL（真库里就是这样），status 一个 VERIFIED 一个 EXPIRED。
	exec(`INSERT INTO supply.seller_real_name_verifications
		(id, agent_id, user_account_id, legal_name, id_type, id_number_hash, status, method, verified_by, verified_at, expires_at, created_at, updated_at)
		VALUES ($1,$2,NULL,'Nguyễn Văn A','CCCD','hash-a','VERIFIED','DOCUMENT','ops_osh',now(),$3,now(),now()),
		       ($4,$5,NULL,'Trần Văn B','CCCD','hash-b','EXPIRED','DOCUMENT','ops_osh',now()-interval '1 day',$6,now(),now())`,
		"srn_osh_ok_"+run, open, now.AddDate(1, 0, 0), "srn_osh_bad_"+run, closed, now.Add(-time.Hour))
	exec(`INSERT INTO supply.capability_verifications (id, agent_id, capability, status, method, verified_by, verified_at, created_at)
		VALUES ($1,$2,'PHOTOGRAPHY','VERIFIED','DOC','ops_osh',now(),now())`, "cv_osh_"+run, open)
	// 订单：一张对得上档案（该被算进「有单的服务者」），一张故意对不上
	// （orders.agent_id 历史上混写过 user_account id，对不上的那张不许把数撑大）。
	exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'CONFIRMED',1,'{}',now(),now()), ($5,$2,'agent_osh_orphan',$6,'CONFIRMED',1,'{}',now(),now())`,
		"ord_osh_match_"+run, "req_osh_"+run, open, "need_osh_"+run, "ord_osh_orphan_"+run, "need_osh_2_"+run)

	after, err := store.SupplyHealth(ctx, now)
	if err != nil {
		t.Fatalf("SupplyHealth: %v", err)
	}
	d := func(a, b int64) int64 { return b - a }

	if got := d(before.Agents, after.Agents); got != 2 {
		t.Fatalf("档案数 +%d，种了 2 个", got)
	}
	if got := d(before.AgentsActive, after.AgentsActive); got != 2 {
		t.Fatalf("ACTIVE 数 +%d", got)
	}
	if got := d(before.AgentsWithBio, after.AgentsWithBio); got != 1 {
		t.Fatalf("有简介的 +%d（只种了 1 个有 bio）", got)
	}
	if got := d(before.AgentsWithLanguages, after.AgentsWithLanguages); got != 1 {
		t.Fatalf("有语种的 +%d（languages 是 JSONB 空数组的那个不该算）", got)
	}
	if got := d(before.AgentsWithAvailability, after.AgentsWithAvailability); got != 2 {
		t.Fatalf("配过时间窗的 +%d", got)
	}
	// 这一条是这一页的核心区分：配过 ≠ 现在还有。
	if got := d(before.AgentsWithOpenWindow, after.AgentsWithOpenWindow); got != 1 {
		t.Fatalf("还有未过期窗的 +%d（B 的窗已经过去了，不该进来）", got)
	}
	// 按 agent_id 数：那行 user_account_id 是 NULL 的必须被算进通过数。
	if got := d(before.RealNameVerified, after.RealNameVerified); got != 1 {
		t.Fatalf("实名核验通过 +%d —— 如果这里是 0，说明又按 user_account_id 数了（那一列真库里全是 NULL）", got)
	}
	if got := d(before.RealNameExpired, after.RealNameExpired); got != 1 {
		t.Fatalf("过期核验 +%d", got)
	}
	if got := d(before.CapabilityVerified, after.CapabilityVerified); got != 1 {
		t.Fatalf("能力核验 +%d", got)
	}
	// 只对得上档案的那张单该被算进「有单的服务者」。
	if got := d(before.AgentsWithOrders, after.AgentsWithOrders); got != 1 {
		t.Fatalf("有单的服务者 +%d（种了 2 张单，其中一张的 agent_id 对不上任何档案）", got)
	}
	if got := d(before.OrdersWindow, after.OrdersWindow); got != 2 {
		t.Fatalf("窗口内订单 +%d", got)
	}
	if after.RealNameVerified+after.RealNameExpired > after.Agents+1000 {
		t.Fatalf("核验数远超档案数，口径肯定串了: verified=%d agents=%d", after.RealNameVerified, after.Agents)
	}
}

// 空库（刚跑完迁移、什么都还没种）不许报错，也不许凭空有数。
func TestOperatorSupplyHealthOnAnEmptyMarket(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// 拿一个未来的 now：这一包的窗口只有下界，取未来才能让所有表都落在窗口外。
	out, err := opsmetrics.NewPostgres(pool).SupplyHealth(ctx, time.Now().UTC().AddDate(5, 0, 0))
	if err != nil {
		t.Fatalf("SupplyHealth: %v", err)
	}
	if out.OrdersWindow != 0 || out.AgentsWithOrders != 0 || out.DemandTasks != 0 {
		t.Fatalf("未来窗口里不该有窗口内的事实: %+v", out)
	}
	if out.WindowDays != 30 {
		t.Fatalf("窗口天数没带上: %d", out.WindowDays)
	}
}
