package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ORDER-FK-LOCK-001（migrations/149）：只追加表被撤掉 UPDATE 之后，**指向它的外键会静默失效**。
//
// 机制：外键校验要在被引用的那一行上取 `FOR KEY SHARE` 行锁，而 `FOR KEY SHARE` 需要
// UPDATE 权限 —— 普通 `SELECT` 不需要。146 的 harden_append_only 把 UPDATE 从属主
// （也就是运行角色 proxy）一起撤了，于是 065 里那条
//
//	policy.order_decisions.decision_id REFERENCES policy.policy_decisions(id)
//
// 每次写入都必然报 `permission denied for table policy_decisions`。后果是 PLATFORM_PAY
// 付费单永远确认不了；客户端只看到 500 command_transaction_failed，因为真实错误被
// SQLSTATE 25P02 顶掉了（DISPATCH-ERROR-HONESTY-001）。
//
// 两段：
//   - mechanism：硬化之后，指向该表的外键真的会失败，而普通 SELECT 照常。没有这一段，
//     下一个人会以为「撤 UPDATE 只影响写」，然后把外键加回去。
//   - current schema：这种外键不存在了，引用完整性改由 BEFORE INSERT 触发器承担，并且
//     **错误契约不变**（无效引用仍然是 SQLSTATE 23503）。触发器只是为了绕开锁权限，
//     不是把约束放宽成「随便写」。
func TestForeignKeyIntoHardenedTablePostgres(t *testing.T) {
	pool := testPool(t)
	run := itoa(time.Now().UnixNano())

	t.Run("mechanism", func(t *testing.T) {
		// 必须用非超级用户实测：超级用户绕过所有权限检查，只测超级用户等于什么都没测
		// （testdb_test.go 起的临时集群里 proxy 就是超级用户）。
		ctx := context.Background()
		role, schema := "t_fk_"+run, "t_fk_"+run
		requireScratchRole(t, pool, role, "")
		if _, err := pool.Exec(ctx, `CREATE SCHEMA `+schema+` AUTHORIZATION `+role); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) })
		// 调用 fulfillment.harden_append_only 需要 schema USAGE。
		if _, err := pool.Exec(ctx, `GRANT USAGE ON SCHEMA fulfillment TO `+role); err != nil {
			t.Fatal(err)
		}
		parent, child := schema+".parent", schema+".child"
		for _, statement := range []string{
			`CREATE TABLE ` + parent + ` (id TEXT PRIMARY KEY)`,
			`CREATE TABLE ` + child + ` (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES ` + parent + `(id))`,
			`INSERT INTO ` + parent + ` VALUES ('p1')`,
			`INSERT INTO ` + child + ` VALUES ('c1', 'p1')`,
		} {
			if err := asRole(t, pool, role, false, true, statement); err != nil {
				t.Fatalf("%s: %v", statement, err)
			}
		}
		// 硬化前，外键写入正常。
		if err := asRole(t, pool, role, false, false, `INSERT INTO `+child+` VALUES ('c1b','p1')`); err != nil {
			t.Fatalf("before hardening the FK insert must work: %v", err)
		}
		if err := asRole(t, pool, role, false, true, `SELECT fulfillment.harden_append_only('`+parent+`')`); err != nil {
			t.Fatalf("harden_append_only: %v", err)
		}

		// 普通 SELECT 照常 —— 这正是缺陷难被发现的原因：读得到，写不进。
		var rows int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+parent).Scan(&rows); err != nil || rows != 1 {
			t.Fatalf("a plain SELECT must keep working after hardening: rows=%d err=%v", rows, err)
		}

		// 机制本体：FOR KEY SHARE 需要 UPDATE，SELECT 不需要。
		if err := asRole(t, pool, role, false, false, `SELECT 1 FROM `+parent+` WHERE id='p1' FOR KEY SHARE`); err == nil ||
			!strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("FOR KEY SHARE must require UPDATE after hardening, got %v", err)
		}
		// 于是外键校验失败 —— 这就是 LC-28 阻断。
		if err := asRole(t, pool, role, false, false, `INSERT INTO `+child+` VALUES ('c2','p1')`); err == nil ||
			!strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("an FK into a hardened table must fail on its lock, got %v", err)
		}
	})

	t.Run("current schema", func(t *testing.T) {
		ctx := context.Background()

		var inboundForeignKeys int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM pg_constraint
			WHERE contype = 'f' AND confrelid = 'policy.policy_decisions'::regclass`).Scan(&inboundForeignKeys); err != nil {
			t.Fatal(err)
		}
		if inboundForeignKeys != 0 {
			t.Fatalf("policy.policy_decisions has %d incoming foreign key(s); its FOR KEY SHARE needs UPDATE, "+
				"which 146 revoked — such an FK can never be satisfied (see migrations/149)", inboundForeignKeys)
		}

		var guardTriggers int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM pg_trigger tr
			JOIN pg_proc p ON p.oid = tr.tgfoid
			WHERE tr.tgrelid = 'policy.order_decisions'::regclass
			  AND NOT tr.tgisinternal
			  AND p.proname = 'check_order_decision_ref'`).Scan(&guardTriggers); err != nil {
			t.Fatal(err)
		}
		if guardTriggers != 1 {
			t.Fatalf("policy.order_decisions must keep its referential check as a trigger, found %d "+
				"(migrations/149); without it decision_id is unconstrained", guardTriggers)
		}

		// 触发器必须保住外键的错误契约：有效引用放行，无效引用报 23503。
		// 用临时表挂同一个触发器函数来测 —— policy.order_decisions 是只追加表，写进去删不掉。
		probe := requireProbeTable(t, pool, run)
		if _, err := pool.Exec(ctx, `INSERT INTO `+probe+` SELECT id FROM policy.policy_decisions LIMIT 1`); err != nil {
			t.Fatalf("a decision id that exists must be accepted: %v", err)
		}
		_, err := pool.Exec(ctx, `INSERT INTO `+probe+` VALUES ('pdec_does_not_exist_`+run+`')`)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
			t.Fatalf("a missing decision id must still be foreign_key_violation (23503), got %v", err)
		}
	})
}

// requireProbeTable 建一张只带 decision_id 的临时表，并挂上真正的守卫触发器函数。
func requireProbeTable(t *testing.T, pool *pgxpool.Pool, run string) string {
	t.Helper()
	ctx := context.Background()
	schema := "t_fkp_" + run
	if _, err := pool.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) })
	table := schema + ".probe"
	if _, err := pool.Exec(ctx, `CREATE TABLE `+table+` (decision_id TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		CREATE TRIGGER probe_decision_ref BEFORE INSERT ON `+table+`
		FOR EACH ROW EXECUTE FUNCTION policy.check_order_decision_ref()`); err != nil {
		t.Fatalf("attach the guard: %v", err)
	}
	return table
}
