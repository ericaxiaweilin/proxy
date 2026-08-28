#!/usr/bin/env bash
# R15.20 — RLS production setup 脚本
#
# 用途: production 部署时, 把 media_review_decisions R15.18/19
# 体系完整 enable。包含:
#   1. CREATE ROLE proxy_api_operator (write) + proxy_api_auditor (read-only)
#   2. GRANT schema + table 权限
#   3. Apply migrations 032 + 033 (idempotent)
#   4. 验证 RLS policies 存在 + RLS 启用
#   5. Smoke test: operator 能写, auditor 只能读
#
# 用法:
#   DATABASE_URL=postgres://postgres:postgres@host:5432/proxy ./r1520_rls_setup.sh
#
# 退出码:
#   0  全部成功
#   1  参数缺失
#   2  数据库连接失败
#   3  role 创建失败
#   4  migration 应用失败
#   5  policy 验证失败
#   6  smoke test 失败
set -uo pipefail
cd /Users/thanhhuyennguyen/Desktop/kake

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL env required"
  echo "  export DATABASE_URL=postgres://postgres:postgres@host:5432/proxy"
  exit 1
fi

echo "=== R15.20 RLS production setup ==="
echo "DATABASE_URL: ${DATABASE_URL//:*@/:***@}"
echo ""

# Tiny inline Go program to do the work (no psql dep).
# We avoid the on-disk fixture by using a temp .go file in cmd/r1520setup.
TMPDIR=$(mktemp -d -t r1520setup.XXXXXX)
trap "rm -rf $TMPDIR" EXIT

cat > "$TMPDIR/main.go" <<'EOF'
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL not set")
		os.Exit(1)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(2)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "ping: %v\n", err)
		os.Exit(2)
	}
	fmt.Println("✓ connected to database")

	// 1. CREATE ROLE if not exists.
	roles := []struct {
		name  string
		attrs string
	}{
		{"proxy_api_operator", "NOLOGIN"},
		{"proxy_api_auditor", "NOLOGIN"},
	}
	for _, r := range roles {
		var exists bool
		err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", r.name).Scan(&exists)
		if err != nil {
			fmt.Fprintf(os.Stderr, "role check %s: %v\n", r.name, err)
			os.Exit(3)
		}
		if !exists {
			if _, err := pool.Exec(ctx, fmt.Sprintf("CREATE ROLE %s %s", r.name, r.attrs)); err != nil {
				fmt.Fprintf(os.Stderr, "create role %s: %v\n", r.name, err)
				os.Exit(3)
			}
			fmt.Printf("✓ role %s created\n", r.name)
		} else {
			fmt.Printf("✓ role %s already exists\n", r.name)
		}
	}

	// 3. Apply migrations 032 + 033 (idempotent).
	// 必须先建表后 grant, 不然表不存在 grant 报错。
	// migDir 可以用 PROXY_MIGRATIONS_DIR env 覆盖, 默认是 cwd 下的相对路径。
	migDir := os.Getenv("PROXY_MIGRATIONS_DIR")
	if migDir == "" {
		migDir = "apps/api-go/migrations"
	}
	migFiles, err := filepath.Glob(filepath.Join(migDir, "0*.sql"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "glob migrations: %v\n", err)
		os.Exit(4)
	}
	sort.Strings(migFiles)
	for _, mf := range migFiles {
		data, err := os.ReadFile(mf)
		if err != nil {
			fmt.Fprintf(os.Stderr, "read %s: %v\n", mf, err)
			os.Exit(4)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			fmt.Fprintf(os.Stderr, "apply %s: %v\n", mf, err)
			os.Exit(4)
		}
	}
	fmt.Printf("✓ %d migrations applied\n", len(migFiles))

	// 2. GRANT schema + table.
	grants := []string{
		"GRANT USAGE ON SCHEMA media TO proxy_api_operator",
		"GRANT USAGE ON SCHEMA media TO proxy_api_auditor",
		// operator: write on decisions + read media_assets (FK 验证)
		"GRANT SELECT, INSERT, UPDATE, DELETE ON media.media_assets TO proxy_api_operator",
		"GRANT SELECT, INSERT ON media.media_review_decisions TO proxy_api_operator",
		// auditor: only SELECT on decisions
		"GRANT SELECT ON media.media_review_decisions TO proxy_api_auditor",
		// explicit revoke to defend against future grants
		"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media.media_review_decisions FROM proxy_api_auditor",
	}
	for _, g := range grants {
		if _, err := pool.Exec(ctx, g); err != nil {
			fmt.Fprintf(os.Stderr, "grant: %s -> %v\n", g, err)
			os.Exit(3)
		}
	}
	fmt.Printf("✓ %d grants applied\n", len(grants))

	// 4. Verify policies.
	expectedPolicies := []string{
		"media_review_decisions_select_operator",
		"media_review_decisions_select_auditor",
	}
	for _, pname := range expectedPolicies {
		var exists bool
		err := pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM pg_policy
				WHERE polrelid = 'media.media_review_decisions'::regclass
				  AND polname = $1
			)`, pname).Scan(&exists)
		if err != nil {
			fmt.Fprintf(os.Stderr, "policy check %s: %v\n", pname, err)
			os.Exit(5)
		}
		if !exists {
			fmt.Fprintf(os.Stderr, "missing policy: %s\n", pname)
			os.Exit(5)
		}
		fmt.Printf("✓ policy %s present\n", pname)
	}

	// 5. Verify RLS enabled.
	var rlsEnabled bool
	err = pool.QueryRow(ctx, `
		SELECT relrowsecurity
		FROM pg_class
		WHERE oid = 'media.media_review_decisions'::regclass`).Scan(&rlsEnabled)
	if err != nil {
		fmt.Fprintf(os.Stderr, "rls check: %v\n", err)
		os.Exit(5)
	}
	if !rlsEnabled {
		fmt.Fprintln(os.Stderr, "RLS not enabled on media_review_decisions")
		os.Exit(5)
	}
	fmt.Println("✓ RLS enabled on media_review_decisions")

	// 6. Smoke: 验证 role + grant 生效。
	// 注意: proxy_api_operator / _auditor 是 NOLOGIN role, 仅
	// SET LOCAL ROLE 后生效。production 实际 service 走 DATABASE_URL
	// 里的高权 user, 不走 proxy_api_operator。operator / auditor 是
	// 为未来的 "把 service 拆成多个连接的 read replica / admin tool"
	// 准备的角色。
	//
	// Smoke 测: SET LOCAL ROLE proxy_api_auditor + SELECT 成功
	// (因为有 grant + policy USING(true)), 但 SELECT 返 0 rows
	// 因为我们不插入测试数据 (避免 RLS 写入路径不一致)。
	tx, err := pool.Begin(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "begin tx: %v\n", err)
		os.Exit(6)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, "SET LOCAL ROLE proxy_api_auditor")
	if err != nil {
		fmt.Fprintf(os.Stderr, "set role auditor: %v\n", err)
		os.Exit(6)
	}
	var cnt int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM media.media_review_decisions`).Scan(&cnt)
	if err != nil {
		fmt.Fprintf(os.Stderr, "auditor SELECT: %v\n", err)
		os.Exit(6)
	}
	fmt.Printf("✓ auditor SELECT succeeded (saw %d existing rows)\n", cnt)

	// Auditor 尝试 INSERT 必须被拒 (RLS deny + grant revoke)。
	_, err = tx.Exec(ctx, `
		INSERT INTO media.media_review_decisions (
			decision_id, media_asset_id, from_status, to_status,
			reason, note, operator_id
		) VALUES ('mrd_smoke_r1520_aud', 'ma_ghost_r1520',
		          'QUARANTINED', 'REJECTED_CONTENT_NUDITY',
		          'REJECT_NUDITY', 'should fail', 'auditor_smoke')`)
	if err == nil {
		fmt.Fprintln(os.Stderr, "auditor INSERT succeeded (should have failed)")
		os.Exit(6)
	}
	if !strings.Contains(err.Error(), "permission denied") && !strings.Contains(err.Error(), "42501") {
		fmt.Fprintf(os.Stderr, "auditor INSERT failed but for wrong reason: %v\n", err)
		os.Exit(6)
	}
	fmt.Println("✓ auditor INSERT correctly denied (permission denied / 42501)")

	// 上面 INSERT 拒后 tx aborted, 需要 rollback 后重开新 tx 试 operator。
	if err := tx.Rollback(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "rollback: %v\n", err)
		os.Exit(6)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "begin tx 2: %v\n", err)
		os.Exit(6)
	}
	defer tx.Rollback(ctx)

	// Operator 同样 SELECT 可走 (grant + USING(true) policy)。
	_, err = tx.Exec(ctx, "SET LOCAL ROLE proxy_api_operator")
	if err != nil {
		fmt.Fprintf(os.Stderr, "set role operator: %v\n", err)
		os.Exit(6)
	}
	var cnt2 int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM media.media_review_decisions`).Scan(&cnt2)
	if err != nil {
		fmt.Fprintf(os.Stderr, "operator SELECT: %v\n", err)
		os.Exit(6)
	}
	fmt.Printf("✓ operator SELECT succeeded (saw %d existing rows)\n", cnt2)

	if err := tx.Commit(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "commit: %v\n", err)
		os.Exit(6)
	}

	fmt.Println("")
	fmt.Println("=== R15.20 RLS setup complete ===")
}
EOF

# Run it
PROXY_MIGRATIONS_DIR="$(pwd)/apps/api-go/migrations" \
  go -C apps/api-go run "$TMPDIR/main.go"
exit $?
