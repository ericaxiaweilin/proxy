package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"
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

// ORDER-NO-LEGACY-COMPAT-001（Postgres）：反查 SQL 的谓词必须和索引谓词同源。
//
// 把索引谓词放宽到 `{16,}` 而查询谓词还留着 `{21,}` 的话，查询谓词不蕴含索引谓词 ⇒
// 计划退化成 Seq Scan（客服每查一次全表扫），**而且存量 16 位号直接查不到** ——
// 客服会说「查无此号」，其实那个号是真的。
//
// 这里显式用 `{16,}` 的参数去 EXPLAIN：谓词一旦分叉就红。
func TestLegacyPublicNumberLookupFindsOldNumbersPostgres(t *testing.T) {
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
