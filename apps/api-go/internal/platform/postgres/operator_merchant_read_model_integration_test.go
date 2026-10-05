package postgres

// OPS-MERCHANT-001：商家管理读模型必须真的跑在真库上。
//
// 为什么内存桩不够：/v1/operator/merchant 的 api 层测试用的是 stubOpsMetrics ——
// 它证明 handler 会转发字段，**一个字都不证明 SQL 能跑**。这一页初稿里写过
// `WHERE status='PENDING'`：store_recommendations（092）建表时就没有 status 列，
// 处置在 093 的另一张表里。那是一条解析期就报错的 SQL，表是空的也一样报，
// 而 api 层测试全绿、我手动跑的那次 dev 探针也全绿（因为它跑的是改好的版本）。
// 只有真的对库执行一次才能挡住这一类。
//
// 同时钉住口径（读模型的全部计数走相关子查询，不是并排 LEFT JOIN）：
// accounts × stores × memberships × products × photos × orders 一旦并排 join，
// 一家 2 店 × 25 菜 × 6 张照片的账户会数出几百行 —— 那种数字看起来完全正常，
// 只有把已知种子量摆在那里对撞才会露馅。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorMerchantReadModelRunsAgainstRealSchema(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())

	biz, owner := "biz_omr_"+run, "user_omr_"+run
	storeA, storeB := "st_omr_a_"+run, "st_omr_b_"+run
	// 订单永不硬删（143 的 guard_order_write 会拦下 DELETE）：这里的行留在库里，
	// 但 id / order_no 都是 run 级唯一，不会跟下一轮撞。cleanup 只删自己种的
	// business.* 行（那几张表没有防删触发器）。
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM business.store_products WHERE business_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM business.store_photos WHERE business_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM business.store_lines WHERE business_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM business.memberships WHERE business_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM business.stores WHERE business_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM business.accounts WHERE id = $1`, biz)
		// 账号必须排在主体之后：049 给 business.accounts.owner_user_id 加了
		// ON DELETE RESTRICT 的外键。订单行本来就删不掉（143 的守卫），而它的
		// requester_id 是纯 TEXT（049 没管 fulfillment），所以留个 run 级唯一的
		// 假请求方不影响任何页面 —— 读模型靠 store_id 找店，店已经被删了。
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id IN ($1,$2,$3)`, owner, "user_omr_m2_"+run, "user_omr_m3_"+run)
	})

	exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES
		($1,'ACTIVE',now(),now()), ($2,'ACTIVE',now(),now()), ($3,'ACTIVE',now(),now())`,
		owner, "user_omr_m2_"+run, "user_omr_m3_"+run)
	exec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$2,'Ops Read Model Co','ACTIVE',now())`, biz, owner)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at) VALUES
		($1,$2,'Active','x','ACTIVE',now()), ($3,$2,'Closed','x','CLOSED',now())`, storeA, biz, storeB)
	exec(`INSERT INTO business.memberships (business_id, user_id, role, status, created_at) VALUES
		($1,$2,'OWNER','ACTIVE',now()), ($1,$3,'OPERATOR','ACTIVE',now()), ($1,$4,'VIEWER','ACTIVE',now())`,
		biz, owner, "user_omr_m2_"+run, "user_omr_m3_"+run)
	// store_lines：A 店三项都填了，B 店全空 —— 「有简介 / 有营业时间 / 有店徽」必须是 1/1/1 而不是 2/2/2。
	exec(`INSERT INTO business.store_lines (store_id, business_id, logo_asset_path, description, hours_json, updated_by, updated_at)
		VALUES ($1,$2,$3,'开在河内老城区的一条巷子里','{"mon":"09:00-22:00"}',$4,now())`,
		storeA, biz, "store/logo_"+run+".jpg", owner)
	exec(`INSERT INTO business.store_lines (store_id, business_id, updated_by, updated_at) VALUES ($1,$2,$3,now())`, storeB, biz, owner)
	// 已知量放大到能被 fan-out 看出来：20 + 5 = 25 道菜、4 + 2 = 6 张照片。
	// 并排 LEFT JOIN 会把它们各自乘上天文数字，绝不可能同时等于 25 和 6。
	for i := 0; i < 20; i++ {
		exec(`INSERT INTO business.store_products (id, store_id, business_id, name, created_at, updated_at)
			VALUES ($1,$2,$3,$4,now(),now())`, "sp_omr_a"+itoa(int64(i))+"_"+run, storeA, biz, "菜 "+itoa(int64(i)))
	}
	for i := 0; i < 5; i++ {
		exec(`INSERT INTO business.store_products (id, store_id, business_id, name, created_at, updated_at)
			VALUES ($1,$2,$3,$4,now(),now())`, "sp_omr_b"+itoa(int64(i))+"_"+run, storeB, biz, "闭店菜 "+itoa(int64(i)))
	}
	for i := 0; i < 4; i++ {
		exec(`INSERT INTO business.store_photos (id, store_id, business_id, uploaded_by, asset_path, created_at)
			VALUES ($1,$2,$3,$4,$5,now())`, "ph_omr_a"+itoa(int64(i))+"_"+run, storeA, biz, owner, "store/photo_"+itoa(int64(i))+"_"+run+".jpg")
	}
	for i := 0; i < 2; i++ {
		exec(`INSERT INTO business.store_photos (id, store_id, business_id, uploaded_by, asset_path, created_at)
			VALUES ($1,$2,$3,$4,$5,now())`, "ph_omr_b"+itoa(int64(i))+"_"+run, storeB, biz, owner, "store/photo_b"+itoa(int64(i))+"_"+run+".jpg")
	}

	// 订单：窗口内挂到门店 4 单（A 店 1 单在 1 小时前 + 2 单在 29 天前，B 店 1 单在 2 天前），
	// 窗口外 2 单（31 天前）。30 天这个边界必须真的生效：忽略窗口数出来是 6，
	// 窗口写成 7 天是 1 —— 两个都不是 4。
	type seed struct {
		store string
		ago   time.Duration
	}
	orders := []seed{
		{storeA, time.Hour},
		{storeA, 29 * 24 * time.Hour},
		{storeA, 29 * 24 * time.Hour + 3 * time.Hour},
		{storeB, 2 * 24 * time.Hour},
		{storeA, 31 * 24 * time.Hour},
		{storeA, 40 * 24 * time.Hour},
	}
	for i, o := range orders {
		exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at, store_id)
			VALUES ($1,$2,$3,$4,'CONFIRMED',1,'{}',$5,now(),$6)`,
			"ord_omr_"+itoa(int64(i))+"_"+run, "req_omr_"+run, "agent_omr_"+run, "need_omr_"+run,
			now.Add(-o.ago), o.store)
	}
	// 没挂到门店的一单：只进 orders30dAll，不进 orders30d。少了它，
	// 「归因链路还没建」这个差别就测不出来。
	exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'CONFIRMED',1,'{}',$5,now())`,
		"ord_omr_nostore_"+run, "req_omr_"+run, "agent_omr_"+run, "need_omr_"+run, now.Add(-3*time.Hour))

	// 推荐队列：一条没有处置记录（待处理），一条已经 ACCEPT。
	// 处置表 append-only 但没有防删触发器，所以两条都在 cleanup 里删掉。
	recOpen, recDone := "sr_omr_open_"+run, "sr_omr_done_"+run
	beforePending, err := opsmetrics.NewPostgres(pool).PendingRecommendations(ctx)
	if err != nil {
		t.Fatalf("待处理推荐基线读不出来: %v", err)
	}
	exec(`INSERT INTO business.store_recommendations (id, store_name, city, reason, recommended_by, created_at)
		VALUES ($1,'Ops Rec Open','河内','测试种子',$3,now()),
		       ($2,'Ops Rec Done','河内','测试种子',$3,now())`, recOpen, recDone, "user_omr_"+run)
	exec(`INSERT INTO business.store_recommendation_dispositions (id, recommendation_id, decision, decided_by, created_at)
		VALUES ($1,$2,'ACCEPT',$3,now())`, "srd_omr_"+run, recDone, "user_omr_"+run)
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM business.store_recommendation_dispositions WHERE id = $1`, "srd_omr_"+run)
		_, _ = pool.Exec(bg, `DELETE FROM business.store_recommendations WHERE id = ANY($1)`, []string{recOpen, recDone})
	})

	res, err := opsmetrics.NewPostgres(pool).Merchants(ctx, now)
	if err != nil {
		t.Fatalf("Merchants 对真库执行失败（列名/别名/join key 一错就是这里）: %v", err)
	}

	// 逐主体：种下的已知量必须原样数出来。
	var mine *opsmetrics.MerchantRow
	for i := range res.Merchants {
		if res.Merchants[i].BusinessID == biz {
			mine = &res.Merchants[i]
		}
	}
	if mine == nil {
		// 列表截到 100 行（按 orders_30d 倒序）。今天全库挂到门店的订单是 0，
		// 我种的 4 单必然排第一；如果哪天被挤出前 100，报应要落在消息里，
		// 不能悄悄放过 —— accounts 总数足够小说明不是截断，是真的没数出来。
		t.Fatalf("种子账户没出现在列表里（accounts=%d，LIMIT 100 是否已经截断？）", res.Totals.Accounts)
	}
	if mine.Name != "Ops Read Model Co" || mine.Status != "ACTIVE" {
		t.Fatalf("主体身份字段读错: %+v", mine)
	}
	if mine.Stores != 2 || mine.ActiveStores != 1 {
		t.Fatalf("门店数错（active 是 CLOSED 过滤出来的）: stores=%d active=%d", mine.Stores, mine.ActiveStores)
	}
	if mine.Members != 3 {
		t.Fatalf("成员数被放大或漏数: %d", mine.Members)
	}
	if mine.Products != 25 || mine.Photos != 6 {
		t.Fatalf("菜品/照片同时正确才算没有 fan-out: products=%d photos=%d", mine.Products, mine.Photos)
	}
	if mine.Orders30d != 4 {
		t.Fatalf("30 天窗口没生效或归因漏了: orders30d=%d（期望 4：3 单在 A 店窗口内、1 单在 B 店；2 单在窗口外）", mine.Orders30d)
	}
	if mine.StoresWithDescription != 1 || mine.StoresWithHours != 1 || mine.StoresWithLogo != 1 {
		t.Fatalf("资料完整度只该数填了的那家: desc=%d hours=%d logo=%d",
			mine.StoresWithDescription, mine.StoresWithHours, mine.StoresWithLogo)
	}

	// 整盘：窗口内挂店 / 全部两列的差别必须存在（只报前者会被读成「这些店没生意」）。
	if res.Totals.Orders30d < 4 {
		t.Fatalf("整盘挂店订单少于自己种的 4 单: %d", res.Totals.Orders30d)
	}
	if res.Totals.Orders30dAll <= res.Totals.Orders30d {
		t.Fatalf("orders30dAll(%d) 必须大于 orders30d(%d)：库里还有一单没归因到门店，两列相等说明归因被当成全量在报",
			res.Totals.Orders30dAll, res.Totals.Orders30d)
	}
	if res.Totals.StoresWithOrders < 2 {
		t.Fatalf("有单的门店数（DISTINCT store_id）错: %d", res.Totals.StoresWithOrders)
	}
	if res.Totals.Accounts < 1 || res.Totals.Stores < 2 || res.Totals.StoreLines < 2 || res.Totals.ProductRows < 25 {
		t.Fatalf("整盘计数漏了自己种下的行: %+v", res.Totals)
	}
	// 「待处理」用页面自己那个字段对撞差值：种了 2 条推荐、其中 1 条已经处置，
	// 所以只该多 1。写成 status='PENDING' 那种 SQL 在这里直接报错；join key 写错
	// （比如拿 disposition.id 去比）会数出 0，差值对不上。
	if got := res.Totals.PendingRecommendations - beforePending; got != 1 {
		t.Fatalf("待处理推荐差值应为 1（种了 2 条、其中 1 条已有处置），实测 %d（基线 %d → 页面 %d）",
			got, beforePending, res.Totals.PendingRecommendations)
	}
	if res.WindowDays != 30 {
		t.Fatalf("窗口天数没告诉调用方: %d", res.WindowDays)
	}
}
