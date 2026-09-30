package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ORDER-ROLE-001：数据库角色姿态检查。
//
// 订单 / 审计的守卫是触发器 + 权限（migrations/146）。这两层只有在**运行角色**满足几个
// 前提时才真的成立：不是超级用户（超级用户绕过一切权限检查）、不是 proxy_breakglass
// 成员（成员能越过守卫）、对只追加的审计表没有改删权限、也不是它们的属主（属主能
// DROP TRIGGER / 重新 GRANT）。本检查把这些前提变成可验证的清单：启动时打日志，设了
// PROXY_ENFORCE_DB_ROLE_SEPARATION=true 则任何一条不满足都拒绝启动。

const (
	PostureSuperuser      = "RUNTIME_IS_SUPERUSER"
	PostureCanOverride    = "RUNTIME_CAN_OVERRIDE_GUARDS"
	PostureCanRewriteLogs = "RUNTIME_CAN_REWRITE_AUDIT"
	PostureOwnsAuditTable = "RUNTIME_OWNS_AUDIT_TABLE"
	// PostureFKIntoReadonlyParent：运行角色**能往子表 INSERT**，但那个外键指向的父表
	// 它**改不了**。这种 INSERT 必然失败 —— 外键校验要在父行上取 `FOR KEY SHARE` 行锁，
	// 而那个锁需要 UPDATE（普通 SELECT 不需要）。
	//
	// 2026-09-30 的 LC-28 就是这一条：146 的 harden_append_only 撤掉了属主 proxy 对
	// policy.policy_decisions 的 UPDATE，而 065 留了一条
	// policy.order_decisions.decision_id → policy.policy_decisions(id) 的外键，于是每一次
	// 策略盖章都 permission denied，PLATFORM_PAY 付费单永远确认不了（修法见迁移 149）。
	//
	// 只报「子表运行角色真的能写」的那些：父表改不了、子表它也写不了的外键是休眠的，
	// 报出来只是噪音，而且这一条在 PROXY_ENFORCE_DB_ROLE_SEPARATION=true 下会拒绝启动。
	PostureFKIntoReadonlyParent = "FK_INTO_READONLY_PARENT"
)

// PostureFinding 是一条不满足的前提。
type PostureFinding struct {
	Code   string
	Detail string
}

// appendOnlyTables 是 138 硬化过的只追加审计表。
var appendOnlyTables = []string{
	"fulfillment.audit_log",
	"policy.policy_decisions",
	"policy.order_decisions",
	"operator.number_lookups",
}

// CurrentRole 返回连接池用的数据库角色。
func CurrentRole(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var role string
	if err := pool.QueryRow(ctx, `SELECT current_user`).Scan(&role); err != nil {
		return "", err
	}
	return role, nil
}

// RolePosture 检查 role 是否满足上面的前提，返回不满足的清单（空 = 满足）。检查的是
// 传入的角色，不要求以它连接，所以测试可以用临时角色覆盖每个分支。
func RolePosture(ctx context.Context, pool *pgxpool.Pool, role string) ([]PostureFinding, error) {
	return rolePostureFor(ctx, pool, role, appendOnlyTables)
}

func rolePostureFor(ctx context.Context, pool *pgxpool.Pool, role string, tables []string) ([]PostureFinding, error) {
	var superuser bool
	if err := pool.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = $1`, role).Scan(&superuser); err != nil {
		return nil, fmt.Errorf("role %q: %w", role, err)
	}
	findings := []PostureFinding{}
	if superuser {
		// 超级用户绕过所有权限检查，也天然能破窗；其余几项对它没有意义。
		return append(findings, PostureFinding{PostureSuperuser, fmt.Sprintf("role %q is a superuser: it bypasses privilege checks and the guard override gate", role)}), nil
	}

	var member bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy_breakglass') AND pg_has_role($1, 'proxy_breakglass', 'MEMBER')`, role).Scan(&member); err != nil {
		return nil, err
	}
	if member {
		findings = append(findings, PostureFinding{PostureCanOverride, fmt.Sprintf("role %q is a member of proxy_breakglass: it can bypass the order guards", role)})
	}

	var rewritable, owned []string
	for _, table := range tables {
		var exists, canUpdate, canDelete, canTruncate, owner bool
		if err := pool.QueryRow(ctx, `
			SELECT to_regclass($2) IS NOT NULL,
			       COALESCE(has_table_privilege($1, to_regclass($2), 'UPDATE'), false),
			       COALESCE(has_table_privilege($1, to_regclass($2), 'DELETE'), false),
			       COALESCE(has_table_privilege($1, to_regclass($2), 'TRUNCATE'), false),
			       COALESCE((SELECT pg_get_userbyid(relowner) = $1 FROM pg_class WHERE oid = to_regclass($2)), false)`,
			role, table).Scan(&exists, &canUpdate, &canDelete, &canTruncate, &owner); err != nil {
			return nil, err
		}
		if !exists {
			continue // 表还没迁移出来：不是这条检查的事
		}
		if canUpdate || canDelete || canTruncate {
			rewritable = append(rewritable, table)
		}
		if owner {
			owned = append(owned, table)
		}
	}
	if len(rewritable) > 0 {
		findings = append(findings, PostureFinding{PostureCanRewriteLogs, fmt.Sprintf("role %q can UPDATE/DELETE/TRUNCATE append-only audit tables: %s", role, strings.Join(rewritable, ", "))})
	}
	if len(owned) > 0 {
		findings = append(findings, PostureFinding{PostureOwnsAuditTable, fmt.Sprintf("role %q owns append-only audit tables (%s): an owner can drop their triggers and re-grant itself; run migrations as a separate owner role (PRODUCTION.md, Database roles)", role, strings.Join(owned, ", "))})
	}
	traps, err := fkTrapsFor(ctx, pool, role)
	if err != nil {
		return nil, err
	}
	if len(traps) > 0 {
		findings = append(findings, PostureFinding{PostureFKIntoReadonlyParent, fmt.Sprintf("role %q can INSERT rows whose foreign key points at a table it cannot UPDATE: %s — the FK check takes FOR KEY SHARE on the parent row, and that lock needs UPDATE, so every such insert fails (see migrations/149)", role, strings.Join(traps, "; "))})
	}
	return findings, nil
}

// fkTrapsFor：列出「运行角色能 INSERT 子表、但改不了父表」的外键。这些 INSERT 必然失败。
//
// 这一条是 2026-09-30 那次生产缺陷的通用形式：当时只有 policy.order_decisions 一处，
// 但任何一张**新**的同类表都会重新制造它，而且症状同样是「看起来写进去了其实没有」。
// 放在启动检查里，新表在下一次启动就会被点名，不必等到有人发现付费单确认不了。
func fkTrapsFor(ctx context.Context, pool *pgxpool.Pool, role string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.conrelid::regclass::text || ' -> ' || c.confrelid::regclass::text || ' (' || c.conname || ')'
		FROM pg_constraint c
		WHERE c.contype = 'f'
		  AND NOT has_table_privilege($1, c.confrelid, 'UPDATE')
		  AND has_table_privilege($1, c.conrelid, 'INSERT')
		ORDER BY 1`, role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var trap string
		if err := rows.Scan(&trap); err != nil {
			return nil, err
		}
		out = append(out, trap)
	}
	return out, rows.Err()
}
