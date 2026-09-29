package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ORDER-ROLE-001（migrations/146）：数据库角色分离。用临时的非超级用户角色实测 ——
// 超级用户绕过所有权限检查，只测超级用户等于什么都没测。临时角色 / schema / 表都是本次
// 运行自己建的（run 后缀），测试结束自己删；订单与审计行按设计不可删除，不清理。

func requireScratchRole(t *testing.T, pool *pgxpool.Pool, name string, options string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE ROLE `+name+` NOLOGIN `+options); err != nil {
		t.Skipf("cannot create scratch role (needs CREATEROLE): %v", err)
	}
	t.Cleanup(func() {
		// DROP OWNED 只动这个临时角色自己拥有的对象 / 授予它的权限。
		_, _ = pool.Exec(ctx, `DROP OWNED BY `+name)
		_, _ = pool.Exec(ctx, `DROP ROLE IF EXISTS `+name)
	})
}

func requireBreakGlassRole(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_breakglass')`).Scan(&exists); err != nil || !exists {
		t.Skip("proxy_breakglass role is not provisioned in this database")
	}
}

// asRole 在一个事务里以 role 身份执行 statement；commit 为真才提交。
func asRole(t *testing.T, pool *pgxpool.Pool, role string, override bool, commit bool, statement string, args ...any) error {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE `+role); err != nil {
		t.Fatal(err)
	}
	if override {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.guard_override', 'ticket-9 operator correction', true), set_config('proxy.audit_actor', 'dba_'||current_user, true)`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, statement, args...); err != nil {
		return err
	}
	if commit {
		return tx.Commit(ctx)
	}
	return nil
}

// ORDER-BREAKGLASS-ROLE-001：以前任何会话都能 set_config('proxy.guard_override', ...) 越过守卫。
// 现在只有 proxy_breakglass 的成员（含超级用户）才生效；别的角色设了开关再写订单 —— 哪怕
// 这次写入本身合法 —— 也直接报错。成员身份本身什么都不放行：没设开关时守卫照常拦。
func TestGuardOverrideRequiresBreakGlassRolePostgres(t *testing.T) {
	pool := testPool(t)
	requireBreakGlassRole(t, pool)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	role := "t_bg_" + run
	requireScratchRole(t, pool, role, "")
	for _, grant := range []string{
		`GRANT USAGE ON SCHEMA fulfillment TO ` + role,
		`GRANT SELECT, INSERT, UPDATE ON fulfillment.orders, fulfillment.offers TO ` + role,
		`GRANT SELECT, INSERT ON fulfillment.audit_log TO ` + role,
		`GRANT USAGE ON SEQUENCE fulfillment.audit_log_audit_id_seq TO ` + role,
	} {
		if _, err := pool.Exec(ctx, grant); err != nil {
			t.Fatalf("%s: %v", grant, err)
		}
	}
	svc := newAuditedService(pool, NewPolicyDecisionRepository(pool))
	orderA := createPlatformPayOffer(t, svc, "user_bg_req_a_"+run, "user_bg_agent_a_"+run, run+"a")
	orderB := createPlatformPayOffer(t, svc, "user_bg_req_b_"+run, "user_bg_agent_b_"+run, run+"b")
	illegal := `UPDATE fulfillment.orders SET lifecycle='COMPLETED', version=version+1 WHERE id=$1` // OFFERED → COMPLETED
	legal := `UPDATE fulfillment.orders SET lifecycle='CANCELLED', version=version+1 WHERE id=$1`   // OFFERED → CANCELLED

	// 非成员：开关一设就报错（不是静默忽略），合法写入也一样。
	if err := asRole(t, pool, role, true, false, illegal, orderA); err == nil || !strings.Contains(err.Error(), "proxy_breakglass") {
		t.Fatalf("a non-member must not be able to override the guard: %v", err)
	}
	if err := asRole(t, pool, role, true, false, legal, orderB); err == nil || !strings.Contains(err.Error(), "proxy_breakglass") {
		t.Fatalf("setting the override without the role must fail loudly even for a legal write: %v", err)
	}
	// 不设开关：守卫照常拦非法迁移（不是权限错误 —— 角色有 UPDATE 权限）。
	if err := asRole(t, pool, role, false, false, illegal, orderA); err == nil || !strings.Contains(err.Error(), "OFFERED -> COMPLETED") {
		t.Fatalf("without the override the guard must reject the illegal transition: %v", err)
	}

	// 成员：没设开关，守卫照常；设了开关才放行，并且理由 / 操作者 / 库用户进审计行。
	if _, err := pool.Exec(ctx, `GRANT proxy_breakglass TO `+role); err != nil {
		t.Skipf("cannot grant proxy_breakglass: %v", err)
	}
	if err := asRole(t, pool, role, false, false, illegal, orderA); err == nil || !strings.Contains(err.Error(), "OFFERED -> COMPLETED") {
		t.Fatalf("membership alone must not bypass the guard: %v", err)
	}
	if err := asRole(t, pool, role, true, true, illegal, orderA); err != nil {
		t.Fatalf("a proxy_breakglass member with the override set must be allowed: %v", err)
	}
	var newState, reason, dbUser, actor string
	if err := pool.QueryRow(ctx, `
		SELECT new_state, override_reason, db_user, actor_id FROM fulfillment.audit_log
		WHERE table_name='orders' AND row_id=$1 AND operation='UPDATE' ORDER BY audit_id DESC LIMIT 1`, orderA).Scan(&newState, &reason, &dbUser, &actor); err != nil ||
		newState != "COMPLETED" || reason != "ticket-9 operator correction" || dbUser != role || actor != "dba_"+role {
		t.Fatalf("the override must be recorded with reason + db user + actor: state=%q reason=%q db_user=%q actor=%q err=%v", newState, reason, dbUser, actor, err)
	}

	// 撤销成员身份 ⇒ 立刻回到被拒。
	if _, err := pool.Exec(ctx, `REVOKE proxy_breakglass FROM `+role); err != nil {
		t.Fatal(err)
	}
	if err := asRole(t, pool, role, true, false, legal, orderB); err == nil || !strings.Contains(err.Error(), "proxy_breakglass") {
		t.Fatalf("revoking membership must revoke the override immediately: %v", err)
	}
}

// AUDIT-PRIVILEGE-001：harden_append_only 对 PUBLIC 和属主撤销 UPDATE / DELETE / TRUNCATE。
// 用一个非超级用户属主的临时表实测「权限被拒」（不是触发器报错 —— 触发器是另一层）。
func TestHardenAppendOnlyRevokesRewritePrivilegesPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	role, schema := "t_ao_"+run, "t_ao_"+run
	requireScratchRole(t, pool, role, "")
	if _, err := pool.Exec(ctx, `CREATE SCHEMA `+schema+` AUTHORIZATION `+role); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) })
	if _, err := pool.Exec(ctx, `GRANT USAGE ON SCHEMA fulfillment TO `+role); err != nil {
		t.Fatal(err)
	}
	table := schema + ".log"
	if err := asRole(t, pool, role, false, true, `CREATE TABLE `+table+` (id INT, note TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err := asRole(t, pool, role, false, true, `INSERT INTO `+table+` VALUES (1, 'first')`); err != nil {
		t.Fatal(err)
	}
	// 硬化前：属主什么都能改。
	if err := asRole(t, pool, role, false, false, `UPDATE `+table+` SET note='before hardening'`); err != nil {
		t.Fatalf("an owner can rewrite before hardening: %v", err)
	}
	if err := asRole(t, pool, role, false, true, `SELECT fulfillment.harden_append_only('`+table+`')`); err != nil {
		t.Fatalf("harden: %v", err)
	}
	for _, statement := range []string{`UPDATE ` + table + ` SET note='rewritten'`, `DELETE FROM ` + table, `TRUNCATE ` + table} {
		if err := asRole(t, pool, role, false, false, statement); err == nil || !strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("%q must be denied at the privilege layer after hardening, got %v", statement, err)
		}
	}
	if err := asRole(t, pool, role, false, true, `INSERT INTO `+table+` VALUES (2, 'second')`); err != nil {
		t.Fatalf("hardening must keep INSERT: %v", err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("rows: %d %v", rows, err)
	}
}

// AUDIT-PRIVILEGE-001：迁移真的对四张审计表做了硬化（任何被授权者都没有 UPDATE / DELETE / TRUNCATE）。
func TestAuditTablesAreHardenedByMigrationPostgres(t *testing.T) {
	pool := testPool(t)
	for _, table := range appendOnlyTables {
		var granted int
		var exists bool
		if err := pool.QueryRow(context.Background(), `
			SELECT to_regclass($1) IS NOT NULL,
			       (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
			        WHERE c.oid = to_regclass($1) AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE'))`, table).Scan(&exists, &granted); err != nil {
			t.Fatal(err)
		}
		if !exists {
			t.Fatalf("%s must exist", table)
		}
		if granted != 0 {
			t.Fatalf("%s still grants UPDATE/DELETE/TRUNCATE to %d grantee(s): migration 138 must harden it", table, granted)
		}
	}
}

// DB-ROLE-POSTURE-001：启动姿态检查把「守卫 / 审计表成立的前提」变成清单。
func TestRolePostureFindingsPostgres(t *testing.T) {
	pool := testPool(t)
	requireBreakGlassRole(t, pool)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	codes := func(findings []PostureFinding) string {
		out := make([]string, 0, len(findings))
		for _, f := range findings {
			out = append(out, f.Code)
		}
		return strings.Join(out, ",")
	}
	exec := func(statement string) {
		t.Helper()
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}

	// 满足前提的角色：只有读 + 追加，不是属主，不是破窗成员。
	clean := "t_pc_" + run
	requireScratchRole(t, pool, clean, "")
	for _, table := range appendOnlyTables {
		exec(`GRANT SELECT, INSERT ON ` + table + ` TO ` + clean)
	}
	if findings, err := RolePosture(ctx, pool, clean); err != nil || len(findings) != 0 {
		t.Fatalf("a read+append role that is neither owner nor break-glass member is clean: %v %v", findings, err)
	}

	// 能改审计表。
	rewriter := "t_pr_" + run
	requireScratchRole(t, pool, rewriter, "")
	exec(`GRANT SELECT, INSERT, UPDATE ON fulfillment.audit_log TO ` + rewriter)
	if findings, err := RolePosture(ctx, pool, rewriter); err != nil || codes(findings) != PostureCanRewriteLogs {
		t.Fatalf("UPDATE on an audit table must be reported: %v %v", findings, err)
	}

	// 破窗成员。
	member := "t_pm_" + run
	requireScratchRole(t, pool, member, "")
	if _, err := pool.Exec(ctx, `GRANT proxy_breakglass TO `+member); err != nil {
		t.Skipf("cannot grant proxy_breakglass: %v", err)
	}
	if findings, err := RolePosture(ctx, pool, member); err != nil || codes(findings) != PostureCanOverride {
		t.Fatalf("a break-glass member must be reported: %v %v", findings, err)
	}

	// 属主：用一张被硬化过的临时审计表（不去动真表的属主）。
	owner, schema := "t_po_"+run, "t_po_"+run
	requireScratchRole(t, pool, owner, "")
	exec(`CREATE SCHEMA ` + schema + ` AUTHORIZATION ` + owner)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) })
	exec(`GRANT USAGE ON SCHEMA fulfillment TO ` + owner)
	table := schema + ".log"
	if err := asRole(t, pool, owner, false, true, `CREATE TABLE `+table+` (id INT)`); err != nil {
		t.Fatal(err)
	}
	if findings, err := rolePostureFor(ctx, pool, owner, []string{table}); err != nil || codes(findings) != PostureCanRewriteLogs+","+PostureOwnsAuditTable {
		t.Fatalf("an un-hardened owner can rewrite and owns the table: %v %v", findings, err)
	}
	if err := asRole(t, pool, owner, false, true, `SELECT fulfillment.harden_append_only('`+table+`')`); err != nil {
		t.Fatal(err)
	}
	if findings, err := rolePostureFor(ctx, pool, owner, []string{table}); err != nil || codes(findings) != PostureOwnsAuditTable {
		t.Fatalf("after hardening only the ownership finding remains: %v %v", findings, err)
	}

	// 超级用户：只报这一条（其余检查对它没有意义）。
	super := "t_ps_" + run
	if _, err := pool.Exec(ctx, `CREATE ROLE `+super+` NOLOGIN SUPERUSER`); err != nil {
		t.Logf("cannot create a scratch superuser, skipping that branch: %v", err)
	} else {
		t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP ROLE IF EXISTS `+super) })
		if findings, err := RolePosture(ctx, pool, super); err != nil || codes(findings) != PostureSuperuser {
			t.Fatalf("a superuser must be reported as such: %v %v", findings, err)
		}
	}

	// 不存在的角色 = 错误，不是「没有发现」。
	if _, err := RolePosture(ctx, pool, "t_missing_"+run); err == nil || !strings.Contains(err.Error(), pgx.ErrNoRows.Error()) {
		t.Fatalf("an unknown role must be an error, not a clean bill: %v", err)
	}
}
