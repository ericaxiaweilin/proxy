package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/marketplace"
)

// ORDER-NO-LEGACY-COMPAT-001（Postgres）：跑过 main 那套 16 位编号的库上，
// **已经发出去的号必须还能写**。
//
// 背景：守卫 fulfillment.guard_order_no() 挂在 BEFORE INSERT OR UPDATE ON
// fulfillment.orders 上。144 写的是 `!~ '^[0-9]{21,}$'`，146 又照抄了一遍，
// 于是存量行带着 16 位号时**任何 UPDATE 都被判「order_no must be all digits」**，
// 订单状态机（CONFIRMED→EXECUTING→…）直接冻住，只剩破窗 override 一条路。
// 147 把条件放宽到 `{16,}`。
//
// 这个用例在 147 之前必须是红的 —— 干净库（没有存量号）测不出来，只有这里能钉住。
//
// 每个断言都跑在**自己的事务里并回滚**：fulfillment.orders 上有 orders_audit
// （AFTER INSERT OR UPDATE OR DELETE），落库会往只追加的 fulfillment.audit_log 写行
// （DELETE 被触发器拒），所以「删掉自己造的行」这条路根本走不通，只能靠回滚不留痕。
func TestLegacySixteenDigitOrderNumberStaysWritablePostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := strconv.FormatInt(time.Now().UnixNano(), 10)

	// main 时代形状：yyMMdd + 9 位全局序号 + Luhn 校验位（2 是 260929000001234 的校验位）。
	const legacy = "2609290000012342"
	const insertSQL = `INSERT INTO fulfillment.orders
		(id, requester_id, agent_id, need_id, lifecycle, version, snapshot, created_at, updated_at, order_no)
		VALUES ($1,$2,$3,'need_legacy','CONFIRMED',1,'{}',now(),now(),$4)`

	legacyID := "ord_legacy_" + run
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, insertSQL, legacyID, "user_legacy_"+run, "agent_legacy_"+run, legacy); err != nil {
		t.Fatalf("存量 16 位号必须能落库（守卫已放宽到 {16,}）: %v", err)
	}
	// 状态机推进 —— 收紧的守卫就是死在这一步。
	if _, err := tx.Exec(ctx, `UPDATE fulfillment.orders SET lifecycle='EXECUTING', version=version+1 WHERE id=$1`, legacyID); err != nil {
		t.Fatalf("存量号的行必须还能更新，否则订单状态机冻住: %v", err)
	}
	// 编号仍然不可改（放宽形状不等于放开不可变性）。
	if _, err := tx.Exec(ctx, `UPDATE fulfillment.orders SET order_no='2609290000099992', version=version+1 WHERE id=$1`, legacyID); err == nil {
		t.Fatal("order_no 必须仍然不可改")
	}
	// 上一条错误已经把这个事务打成 aborted，后面的断言必须各开各的事务。
	_ = tx.Rollback(ctx)

	// 守卫没被放成「什么都收」：非数字 / 短于 16 位仍然拒。
	// 这里必须逐个开事务：任一语句报错后同一事务里的后续语句只会得到
	// "current transaction is aborted"，那就变成"因为错的原因而通过"。
	for i, bad := range []string{"PX-A-260929-1234", "260929000001234", "260929000001234a"} {
		badID := "ord_bad_legacy_" + run + "_" + strconv.Itoa(i)
		err := func() error {
			btx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = btx.Rollback(ctx) }()
			_, err = btx.Exec(ctx, insertSQL, badID, "a", "b", bad)
			return err
		}()
		if err == nil {
			t.Fatalf("%q 必须被守卫拒（形状放宽到 {16,} 不等于什么都收）", bad)
		}
	}
}

// ORDER-NO-LEGACY-COMPAT-001（Postgres）：两个部分唯一索引的谓词必须收敛成同一份 `{16,}`。
//
// main 的 137 写的是 `CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE ... ~ '^[0-9]{16,}$'`，
// 统一 21 位时被改成了 `{21,}`，但**跑过 main 那套的库里索引已经按 `{16,}` 建过** ——
// IF NOT EXISTS 会静默跳过，于是老库 16 / 新库 21，谓词永久分叉且谁都不报错。
// 147 改成 DROP + CREATE 收敛。
//
// 只读断言，不留行。
func TestPublicNumberIndexPredicatesConvergedPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	for _, name := range []string{"marketplace_opportunities_number_key", "activity_code_digits_key"} {
		var def string
		if err := pool.QueryRow(ctx, `SELECT indexdef FROM pg_indexes WHERE indexname = $1`, name).Scan(&def); err != nil {
			t.Fatalf("索引 %s 必须存在: %v", name, err)
		}
		if !strings.Contains(def, "{16,}") {
			t.Fatalf("%s 的谓词没收敛到 {16,}（历史 16 位号会掉出唯一性保护）: %s", name, def)
		}
	}
}

// ORDER-NO-LEGACY-COMPAT-001（Postgres）：反查 SQL 的谓词必须和索引谓词同源 ——
// **且真的能把存量 16 位号查出来**。
//
// 把索引谓词放宽到 `{16,}` 而查询谓词还留着 `{21,}` 的话，查询谓词不蕴含索引谓词 ⇒
// 计划退化成 Seq Scan（客服每查一次全表扫），**而且存量 16 位号直接查不到** ——
// 客服会说「查无此号」，其实那个号是真的。
//
// 拆成两个用例，因为「走索引」和「查得到」是两件独立的事：
//
//   - TestLegacyPublicNumberLookupUsesPartialIndexPostgres（计划）
//     只验谓词同源 —— plan 里必须出现那个部分唯一索引名。EXPLAIN 只能证这一半：
//     谓词一分叉，计划就退化成 Seq Scan，红。
//
//   - TestLegacyPublicNumberLookupFindsOldNumbersPostgres（真实查找）
//     **插真行、走真实仓储方法**。这一半 EXPLAIN 证不了 —— 上一版只有 EXPLAIN，
//     名字叫「FindsOldNumbers」却从来没查出过一行，典型假绿：EXPLAIN 只说明
//     「这个计划会用索引」，不说明「用这个计划能取到你要的那行」。反例：
//     第二个谓词 `payload->>'number' = $1` 若被改成前缀 / 包含匹配，plan 照样命中
//     索引（第一个谓词仍然同源），但取回来的是空集或错行 —— 老测试照样绿。
//     更现实的风险是 JSONB：`payload->>'number'` 是从哪一版写入的、存量行
//     真的带这个键吗，schema 一点都不保证，只能真插一行验。
func TestLegacyPublicNumberLookupFindsOldNumbersPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := strconv.FormatInt(time.Now().UnixNano(), 10)

	// main 时代的真实形状：16 位、yyMMdd + 9 位序号 + Luhn 校验位。
	const legacyNo = "2609290000012342"
	const legacyCode = "2609290000098765"

	oppID := "opp_legacy_" + run
	actID := "act_legacy_" + run

	// 诱饵：同前缀、另一条 16 位旧号，且**先于目标行插入**。
	// 用途是钉住「谓词不能过宽」：如果有人把 `= $1` 换成前缀 / 包含匹配，
	// 两行都会命中，QueryRow 按堆顺序返回先插入的诱饵 —— 于是 id / number 断言立刻红。
	// 只有 EXPLAIN 的老测试在这种改动下**照样绿**（第一个谓词仍与索引同源，plan 不变）。
	const decoyNo = "2609290000000001"
	const decoyCode = "2609290000000002"
	decoyOppID := "opp_decoy_" + run
	decoyActID := "act_decoy_" + run

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 这两张表上没有触发器（对比 fulfillment.orders 有只追加的 orders_audit），
	// 所以插入 + 回滚是安全的，不会留下痕迹。
	// 诱饵先插 —— 让「谓词过宽」这种破坏稳定地返回错行，而不是碰运气。
	if _, err := tx.Exec(ctx,
		`INSERT INTO marketplace.opportunities (id, owner_id, payload, responses)
		 VALUES ($1,$2,$3::jsonb,0)`, decoyOppID, "owner_decoy_"+run,
		[]byte(`{"id":"`+decoyOppID+`","number":"`+decoyNo+`","title":"decoy","status":"OPEN"}`)); err != nil {
		t.Fatalf("造诱饵机会行失败: %v", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO activity.activities (id, payload, interested_count, joined_count, capacity)
		 VALUES ($1,$2::jsonb,0,0,10)`, decoyActID,
		[]byte(`{"activityId":"`+decoyActID+`","code":"`+decoyCode+`","title":"decoy","status":"OPEN"}`)); err != nil {
		t.Fatalf("造诱饵活动行失败: %v", err)
	}

	oppPayload, err := json.Marshal(map[string]any{
		"id": oppID, "number": legacyNo, "title": "legacy opportunity", "status": "OPEN",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO marketplace.opportunities (id, owner_id, payload, responses)
		 VALUES ($1,$2,$3::jsonb,0)`, oppID, "owner_legacy_"+run, oppPayload); err != nil {
		t.Fatalf("造一条 16 位旧号机会行失败: %v", err)
	}
	// 注意 JSONB 里的键名：Activity.ID 的 tag 是 `activityId` 不是 `id`。
	// 这正是 EXPLAIN 证不出来的那一半 —— 键名写错，行插得进去、plan 也照样走索引，
	// 但反查回来的 ID 是空的。上一版只 EXPLAIN，所以永远发现不了。
	actPayload, err := json.Marshal(map[string]any{
		"activityId": actID, "code": legacyCode, "title": "legacy activity", "status": "OPEN",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO activity.activities (id, payload, interested_count, joined_count, capacity)
		 VALUES ($1,$2::jsonb,0,0,10)`, actID, actPayload); err != nil {
		t.Fatalf("造一条 16 位旧号活动行失败: %v", err)
	}

	// 把 tx 注入 context，让真实仓储方法在我的事务里跑（queryerForContext 会优先取它），
	// 这样验的是生产代码路径，而不是我在测试里手写 SQL。
	txCtx := context.WithValue(ctx, transactionContextKey{}, tx)

	market := NewMarketplaceRepository(pool)
	got, err := market.GetByNumber(txCtx, legacyNo)
	if err != nil {
		t.Fatalf("16 位旧机会号 %s 必须能反查到（守卫/索引放宽到 {16,} 的意义就在这）: %v", legacyNo, err)
	}
	if got.ID != oppID || got.Number != legacyNo {
		t.Fatalf("反查回来的不是刚插入的那一行：id=%q number=%q，期望 id=%q number=%q",
			got.ID, got.Number, oppID, legacyNo)
	}

	acts := NewActivityRepository(pool)
	found, err := acts.FindActivityByCode(txCtx, legacyCode)
	if err != nil {
		t.Fatalf("16 位旧活动编号 %s 必须能反查到: %v", legacyCode, err)
	}
	if found.ID != actID || found.Code != legacyCode {
		t.Fatalf("反查回来的不是刚插入的那一行：id=%q code=%q，期望 id=%q code=%q",
			found.ID, found.Code, actID, legacyCode)
	}

	// 阴性对照：号确实存在，但**不匹配全数字形状**的展示码不该被反查到
	//（PX-A-… 那种老的展示码不保证唯一，SQL 里故意排除了）。钉住「形状谓词没被
	// 顺手删掉」—— 上一版只验 plan，如果有人把 `~ '^[0-9]{16,}$'` 整条删掉只留
	// `= $1`，plan 就不再命中那个部分索引，老用例仍会红；但如果把索引也换成普通索引，
	// 就可能一起绿掉。这里显式断一次。
	if _, err := market.GetByNumber(txCtx, "PX-A-"+legacyNo); err == nil {
		t.Fatal("非全数字展示码不该被反查到（形状谓词必须留着）")
	}

	// 阴性对照：库里没有的号必须报 not found，而不是别的错。
	if _, err := market.GetByNumber(txCtx, "2609290000000000"); !errors.Is(err, marketplace.ErrOpportunityNotFound) {
		t.Fatalf("不存在的号必须报 ErrOpportunityNotFound，实际: %v", err)
	}
	if _, err := acts.FindActivityByCode(txCtx, "2609290000000000"); !errors.Is(err, activity.ErrActivityNotFound) {
		t.Fatalf("不存在的编号必须报 ErrActivityNotFound，实际: %v", err)
	}
}

// ORDER-NO-LEGACY-COMPAT-001（Postgres，**只验计划**）：谓词与索引谓词同源。
//
// 这一条只能证明「计划会用那个部分唯一索引」，证明不了「查得到行」——
// 那半由上面的 TestLegacyPublicNumberLookupFindsOldNumbersPostgres 真插行来证。
// 拆开是因为两者的失败原因和排查方向完全不同：这里红 = 谓词分叉（退化 Seq Scan），
// 那里红 = 取不回数据（谓词、JSONB 键、或写入形状变了）。
func TestLegacyPublicNumberLookupUsesPartialIndexPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	cases := []struct{ name, sql, index string }{
		{"opportunity number", opportunityByNumberSQL, "marketplace_opportunities_number_key"},
		{"activity code", activityByCodeSQL, "activity_code_digits_key"},
	}
	for _, tc := range cases {
		err := func() error {
			tx, err := pool.Begin(ctx)
			if err != nil {
				return err
			}
			defer func() { _ = tx.Rollback(ctx) }()
			if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
				return err
			}
			rows, err := tx.Query(ctx, `EXPLAIN `+tc.sql, "2609290000012342")
			if err != nil {
				return err
			}
			defer rows.Close()
			var plan strings.Builder
			for rows.Next() {
				var line string
				if err := rows.Scan(&line); err != nil {
					return err
				}
				plan.WriteString(line + "\n")
			}
			if !strings.Contains(plan.String(), tc.index) {
				t.Fatalf("%s 用 16 位旧号反查时必须走 %s，plan:\n%s", tc.name, tc.index, plan.String())
			}
			return nil
		}()
		if err != nil {
			t.Fatal(err)
		}
	}
}
