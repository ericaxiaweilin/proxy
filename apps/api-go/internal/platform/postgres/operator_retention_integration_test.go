package postgres

// OPS-RETENTION-001：留存与复购的读模型必须真的对库跑过。
//
// 理由跟 OPS-MERCHANT-001 一模一样：api 层那组测试用的是假 Source，它证明 handler
// 会把字段透出来、会拒绝没有来源的指标，一个字都不证明这 11 个子查询能跑。
// 这里钉的是：列名（localnet.interaction_events 的用户列叫 actor_id，不是
// user_account_id —— 猜就炸）、两个窗口的边界、生命周期分布的 GROUP BY、
// 「窗口前有没有人」那个开关，以及**窗口内没人下单时不许算出一个 0% 的复购率**。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorRetentionCountsRealOrdersAcrossTwoWindows(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())

	// 订单永不硬删（143 的守卫），所以这些行会留下 —— id 带 run 后缀不会跟下一轮撞。
	// 断言全部用「至少」，因为跑在有别的数据的库上时全局计数不止我这些。
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	insert := `INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'CONFIRMED',1,'{}',$5,now())`
	// R1：窗口内 3 张单，全都找同一个服务者 → 重复下单人 +1、回头找她组 +1。
	for i := 0; i < 3; i++ {
		exec(insert, "ord_ret_a"+itoa(int64(i))+"_"+run, "req_ret_1_"+run, "agent_ret_1_"+run,
			"need_ret_1_"+run, now.Add(-time.Duration(i+1)*time.Hour))
	}
	// R2：窗口内 1 张单 → 只算下单人，不算重复。
	exec(insert, "ord_ret_b_"+run, "req_ret_2_"+run, "agent_ret_1_"+run, "need_ret_2_"+run, now.Add(-2*time.Hour))
	// R3：窗口内 1 张 + 窗口前 45 天 1 张 → 前期人群 +1（这一条决定「同期群留存能不能算」）。
	exec(insert, "ord_ret_c_in_"+run, "req_ret_3_"+run, "agent_ret_2_"+run, "need_ret_3_"+run, now.Add(-3*time.Hour))
	exec(insert, "ord_ret_c_old_"+run, "req_ret_3_"+run, "agent_ret_2_"+run, "need_ret_3_"+run, now.Add(-45*24*time.Hour))
	// 一个**真实账号**下的单：可归因性那条判据（请求方在不在 identity.user_accounts）
	// 只有拿真账号和假 id 各种一张才对撞得出来 —— 全用假 id 的话，这条永远数出 0，
	// 而 0 看起来跟「库里没有测试行」一模一样。
	exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',now(),now())`,
		"user_osh_real_"+run)
	exec(insert, "ord_ret_real_"+run, "user_osh_real_"+run, "agent_ret_1_"+run, "need_ret_real_"+run, now.Add(-4*time.Hour))
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id = $1`, "user_osh_real_"+run)
	})

	// 状态机：CANCELLED 与 COMPLETED 都得真的走一遍（守卫不许直接 INSERT 成这些状态）。
	exec(`UPDATE fulfillment.orders SET lifecycle='CANCELLED', version=version+1, updated_at=now() WHERE id=$1`,
		"ord_ret_b_"+run)
	exec(`UPDATE fulfillment.orders SET lifecycle='EXECUTING', version=version+1, updated_at=now() WHERE id=$1`,
		"ord_ret_a0_"+run)
	exec(`UPDATE fulfillment.orders SET lifecycle='COMPLETED', version=version+1, updated_at=now() WHERE id=$1`,
		"ord_ret_a0_"+run)

	ret, err := opsmetrics.NewPostgres(pool).Retention(ctx, now)
	if err != nil {
		t.Fatalf("Retention 对真库执行失败（列名 / 子查询 / GROUP BY 一错就是这里）: %v", err)
	}
	if ret.WindowDays != 30 {
		t.Fatalf("窗口天数没带上: %d", ret.WindowDays)
	}
	if ret.Requesters < 3 {
		t.Fatalf("下单人数 %d，我种了 3 个", ret.Requesters)
	}
	if ret.RepeatRequests < 1 {
		t.Fatalf("重复下单人数 %d，R1 下了 3 单", ret.RepeatRequests)
	}
	if ret.SamePairRepeatGroups < 1 {
		t.Fatalf("回头找她的组数 %d，R1×agent_1 是 3 单", ret.SamePairRepeatGroups)
	}
	if ret.AgentsWithOrders < 2 {
		t.Fatalf("有单的服务者数 %d", ret.AgentsWithOrders)
	}
	if ret.Completed < 1 || ret.Cancelled < 1 {
		t.Fatalf("完成 / 取消没数出来: completed=%d cancelled=%d", ret.Completed, ret.Cancelled)
	}
	if ret.Lifecycle["COMPLETED"] < 1 || ret.Lifecycle["CANCELLED"] < 1 {
		t.Fatalf("生命周期分布缺了走完全程的那些: %v", ret.Lifecycle)
	}
	// 窗口外的 45 天前那一单不能进窗口计数：R3 在窗口内只有 1 单，不该被算成重复。
	if got := ret.Lifecycle["CONFIRMED"]; got < 3 {
		t.Fatalf("窗口内 CONFIRMED 只有 %d（R1 剩 2 单 + R3 的窗口内 1 单，窗口外那单不该进来）", got)
	}
	// 「窗口前有没有人下过单」这个开关决定这一页敢不敢提留存 —— 必须是真的查出来的。
	if ret.PriorWindowRequesters < 1 {
		t.Fatalf("前期人群开关为 %d，我明明种了一个 45 天前下过单的人", ret.PriorWindowRequesters)
	}
	if ret.RepeatRequests > ret.Requesters {
		t.Fatalf("重复下单的人比下单的人还多: %d > %d", ret.RepeatRequests, ret.Requesters)
	}
	// 可归因性：真人下的那一张必须落进 attributable，五张假 id 的落进 unattributed；
	// 两边相加必须**正好等于**窗口内的总单数 —— 有一条既没算进这边也没算进那边，
	// 就是分母在偷偷缩水（这台库里一半以上是集成测试留下的行，全靠这条兜住）。
	if ret.OrdersAttributable < 1 {
		t.Fatalf("能追溯到账号的单是 %d，我明明种了一张真账号下的单", ret.OrdersAttributable)
	}
	if ret.OrdersUnattributed < 5 {
		t.Fatalf("对不上账号的单 %d，我种了 5 张假 id 的窗口内单", ret.OrdersUnattributed)
	}
	if ret.OrdersAttributable+ret.OrdersUnattributed != ret.Orders {
		t.Fatalf("可归因 %d + 不可归因 %d ≠ 窗口内 %d 张 —— 有单两边都没数到",
			ret.OrdersAttributable, ret.OrdersUnattributed, ret.Orders)
	}
	if ret.RealRequesters < 1 || ret.RealRequesters > ret.Requesters {
		t.Fatalf("能追溯到账号的下单人 %d，应当在 [1, %d] 内", ret.RealRequesters, ret.Requesters)
	}
	if ret.RealRepeatRequesters > ret.RealRequesters {
		t.Fatalf("重复下单人 %d 比能追溯到账号的下单人 %d 还多", ret.RealRepeatRequesters, ret.RealRequesters)
	}
	// 标题那个比例的分母是**能追溯到账号的人**，不是全量 id：这里按同一口径重算一遍对撞。
	// 它是 nil 也算失败 —— 分母有了就该给数，「没有业务成色声明」是 api 层门的事，不在这层。
	want := float64(int64(float64(ret.RealRepeatRequesters)/float64(ret.RealRequesters)*1000+0.5)) / 10
	if ret.RepeatRequesterRate == nil {
		t.Fatalf("分母是 %d 却不给比例", ret.RealRequesters)
	}
	if *ret.RepeatRequesterRate < want-0.11 || *ret.RepeatRequesterRate > want+0.11 {
		t.Fatalf("复购率 %g 跟 %d/%d 算出来的 %g 对不上",
			*ret.RepeatRequesterRate, ret.RealRepeatRequesters, ret.RealRequesters, want)
	}
}

// 窗口里一个下单的人都没有时，比例必须是 0 而不是「0% 复购率」那种看起来像结论的数。
//
// 用的是**未来**的窗口，不是过去的：这一包的窗口口径跟 Population / Merchants 一致，
// 只有下界（created_at >= now-30d），没有上界。拿 2019 年当 now 会把我刚种下的 2026 年
// 订单全算进「窗口内」—— 那不是空窗口，是测了个别的东西。要一个确定没有数据的
// 窗口，只能往未来取。
func TestOperatorRetentionNeverInventsARateFromAnEmptyWindow(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	ret, err := opsmetrics.NewPostgres(pool).Retention(ctx, time.Now().UTC().AddDate(5, 0, 0))
	if err != nil {
		t.Fatalf("Retention: %v", err)
	}
	if ret.Orders != 0 || ret.Requesters != 0 {
		t.Fatalf("未来的窗口里不该有订单: %+v", ret)
	}
	if ret.RepeatRequesterRate != nil {
		t.Fatalf("分母是 0 却给出了比例 %g —— 那会被读成「复购率 0%%」，而事实是这个窗口没数据", *ret.RepeatRequesterRate)
	}
	if len(ret.Lifecycle) != 0 {
		t.Fatalf("空窗口的生命周期分布不该有内容: %v", ret.Lifecycle)
	}
}
