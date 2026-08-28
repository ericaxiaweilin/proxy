// R15.21 — production migration 管理 CLI
//
// 用法:
//   migrate -dsn <url> -status           # 列出 applied / pending / drift
//   migrate -dsn <url> -apply            # 真 apply 所有 pending
//   migrate -dsn <url> -dry-run          # 列 pending 不真 apply
//   migrate -dsn <url> -check-drift      # 仅检查 drift, exit code 1 if drift
//
// 环境变量 (代替 flag):
//   DATABASE_URL                  DSN
//   PROXY_MIGRATIONS_DIR          migrations dir (default: apps/api-go/migrations)
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
)

func main() {
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "Postgres DSN (or DATABASE_URL env)")
	migDir := flag.String("dir", os.Getenv("PROXY_MIGRATIONS_DIR"), "migrations directory (or PROXY_MIGRATIONS_DIR env)")
	apply := flag.Bool("apply", false, "Apply pending migrations")
	dryRun := flag.Bool("dry-run", false, "List pending without applying")
	status := flag.Bool("status", false, "Show applied/pending/drift summary")
	checkDrift := flag.Bool("check-drift", false, "Exit 1 if drift detected (no apply)")
	flag.Parse()

	if *dsn == "" {
		fmt.Fprintln(os.Stderr, "ERROR: -dsn or DATABASE_URL required")
		os.Exit(1)
	}
	if *migDir == "" {
		// Default: relative to cwd, or absolute via PROXY_REPO_ROOT
		// Try apps/api-go/migrations first, then ../migrations
		candidates := []string{
			"apps/api-go/migrations",
			"../apps/api-go/migrations",
			"migrations",
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				*migDir = c
				break
			}
		}
		if *migDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: -dir or PROXY_MIGRATIONS_DIR required")
			os.Exit(1)
		}
	}
	*migDir, _ = filepath.Abs(*migDir)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(2)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "ping: %v\n", err)
		os.Exit(2)
	}

	m := postgres.NewMigrator(pool, *migDir)

	if *checkDrift {
		drift, err := m.VerifyDrift(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "verify drift: %v\n", err)
			os.Exit(3)
		}
		if drift != nil {
			fmt.Printf("DRIFT: %s (current checksum=%s, stored=%s)\n",
				drift.Version, drift.Checksum, drift.StoredChecksum)
			os.Exit(1)
		}
		fmt.Println("OK: no drift")
		return
	}

	if *status {
		statuses, err := m.ListMigrations(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "status: %v\n", err)
			os.Exit(3)
		}
		var applied, pending, drift, orphan int
		for _, s := range statuses {
			switch {
			case s.Drift:
				drift++
				fmt.Printf("  DRIFT  %s  %s -> %s\n", s.Version, s.StoredChecksum, s.Checksum)
			case s.Applied && !s.OnDisk:
				orphan++
				fmt.Printf("  ORPHAN %s  (applied but file missing)\n", s.Version)
			case s.Applied:
				applied++
				fmt.Printf("  APPLIED %s  at=%s  %s\n", s.Version, s.AppliedAt.Format("2006-01-02 15:04"), s.Checksum)
			default:
				pending++
				fmt.Printf("  PENDING %s  %s\n", s.Version, s.Checksum)
			}
		}
		fmt.Printf("\nsummary: applied=%d pending=%d drift=%d orphan=%d total=%d\n",
			applied, pending, drift, orphan, len(statuses))
		return
	}

	if *apply {
		applied, _, err := m.Apply(ctx, false)
		if err != nil {
			fmt.Fprintf(os.Stderr, "apply: %v\n", err)
			os.Exit(4)
		}
		// skipped = total migrations - applied (already applied)
		statuses, _ := m.ListMigrations(ctx)
		skipped := len(statuses) - len(applied)
		fmt.Printf("applied %d, skipped %d already-applied (out of %d total)\n", len(applied), skipped, len(statuses))
		for _, v := range applied {
			fmt.Printf("  + %s\n", v)
		}
		return
	}

	if *dryRun {
		_, pending, err := m.Apply(ctx, true)
		if err != nil {
			fmt.Fprintf(os.Stderr, "dry-run: %v\n", err)
			os.Exit(4)
		}
		if len(pending) == 0 {
			fmt.Println("OK: no pending migrations (database is up to date)")
			return
		}
		fmt.Printf("would apply %d pending migrations:\n", len(pending))
		for _, v := range pending {
			fmt.Printf("  > %s\n", v)
		}
		return
	}

	fmt.Fprintln(os.Stderr, "ERROR: must specify -status, -apply, -dry-run, or -check-drift")
	os.Exit(1)
}
