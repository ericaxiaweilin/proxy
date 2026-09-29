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
	return findings, nil
}
