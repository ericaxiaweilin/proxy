package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
)

// enforceDBRolePosture 是 ORDER-ROLE-001 的启动检查：运行角色是否满足「订单守卫 / 审计表
// 真的成立」的前提（postgres.RolePosture）。默认只打日志；PROXY_ENFORCE_DB_ROLE_SEPARATION
// 设为 true / 1 时，任何一条不满足都拒绝启动（fail-closed）。
func enforceDBRolePosture(ctx context.Context, pool *pgxpool.Pool) {
	value := strings.TrimSpace(os.Getenv("PROXY_ENFORCE_DB_ROLE_SEPARATION"))
	strict := strings.EqualFold(value, "true") || value == "1"
	role, err := postgres.CurrentRole(ctx, pool)
	if err != nil {
		if strict {
			log.Fatalf("db role posture: cannot determine the runtime role: %v", err)
		}
		log.Printf("db role posture: cannot determine the runtime role: %v", err)
		return
	}
	findings, err := postgres.RolePosture(ctx, pool, role)
	if err != nil {
		if strict {
			log.Fatalf("db role posture: check failed for role %q: %v", role, err)
		}
		log.Printf("db role posture: check failed for role %q: %v", role, err)
		return
	}
	if len(findings) == 0 {
		log.Printf("db role posture: role %q satisfies the order-guard preconditions", role)
		return
	}
	for _, finding := range findings {
		log.Printf("db role posture: %s: %s", finding.Code, finding.Detail)
	}
	if strict {
		log.Fatalf("PROXY_ENFORCE_DB_ROLE_SEPARATION is set and role %q does not satisfy the order-guard preconditions (%d finding(s) above); refusing to start", role, len(findings))
	}
	log.Printf("db role posture: %d finding(s) for role %q; set PROXY_ENFORCE_DB_ROLE_SEPARATION=true once roles are split (see PRODUCTION.md, Database roles)", len(findings), role)
}
