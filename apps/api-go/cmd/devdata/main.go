// Command devdata holds the developer-side data tools that used to be Node
// scripts in scripts/*.mjs (dev-feed-pipeline, dev-distance-tiers,
// dev-availability, smoke-social-media). The toolchain for this repo is Go plus
// the RN app's own build, so a script the gate depends on must not need a JS
// runtime; talking to Postgres through pgx also drops the hardcoded homebrew
// psql path those scripts carried.
//
// What these tools are allowed to write is deliberately narrow: dev-only rows
// (devpipe_/devseed_/user_devseed_ identities, their coordinates, their
// schedules, plain-text posts) and reversible anonymous sessions. Nothing here
// deletes business data, and every seed path is insert-if-absent — a row that
// already exists keeps its current values (AGENTS.md data invariant). The one
// exception is the rolling availability window, whose whole purpose is to move
// its own dev rows forward in time.
//
// No fabricated numbers: distances are computed from real city coordinates by
// the read model, spend stays 0 until payments are wired, and a missing media
// byte blob reports FAILED instead of a placeholder.
//
// usage:
//
//	go -C apps/api-go run ./cmd/devdata feed-pipeline [--dry-run] [--backfill N]
//	go -C apps/api-go run ./cmd/devdata distance-tiers [--verify]
//	go -C apps/api-go run ./cmd/devdata availability [--verify]
//	go -C apps/api-go run ./cmd/devdata social-smoke
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: devdata <feed-pipeline|distance-tiers --verify|availability [--verify]|social-smoke> [args...]")
		os.Exit(2)
	}
	name := os.Args[1]
	args := os.Args[2:]

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	switch name {
	case "social-smoke":
		if err := runSocialSmoke(ctx, os.Stdout); err != nil {
			exitWith(err)
		}
		return
	case "feed-pipeline", "distance-tiers", "availability":
	default:
		fmt.Fprintf(os.Stderr, "devdata: unknown tool %q\n", name)
		os.Exit(2)
	}

	pool, err := openPool(ctx)
	if err != nil {
		exitWith(err)
	}
	defer pool.Close()

	// Each tool gets one writer, the way the Node scripts had one stdout: the pipeline's
	// tier sub-report is buffered inside feedPipeline and only its verdict line is
	// quoted, so splitting the stream here would either duplicate that line or drop the
	// tier table from a standalone `distance-tiers` run.
	switch name {
	case "feed-pipeline":
		err = feedPipeline(ctx, pool, os.Stdout, args)
	case "distance-tiers":
		err = distanceTiers(ctx, pool, os.Stdout, args)
	case "availability":
		err = availability(ctx, pool, os.Stdout, args)
	}
	exitWith(err)
}

// openPool connects the Postgres-backed tools. social-smoke is the one tool that
// talks to the API instead of the database, so it must not fail on a missing
// DATABASE_URL before it has made a single request.
func openPool(ctx context.Context) (*pgxpool.Pool, error) {
	dsn, err := databaseURL()
	if err != nil {
		return nil, err
	}
	pool, err := postgres.Open(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

func exitWith(err error) {
	if err == nil {
		return
	}
	// The Node versions wrote human-readable failures to stderr and set a
	// non-zero exit code; a Go panic stack would be a worse handoff.
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}

// databaseURL prefers DATABASE_URL (the env every other api-go command uses) and
// falls back to the .env the dev scripts read, so the tools stay runnable from a
// bare shell the way `node scripts/dev-*.mjs` was.
func databaseURL() (string, error) {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn, nil
	}
	for _, candidate := range []string{".env", repoRoot() + "/.env"} {
		body, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(body), "\n") {
			if value, found := strings.CutPrefix(strings.TrimSpace(line), "DATABASE_URL="); found {
				value = strings.Trim(strings.TrimSpace(value), `"'`)
				if value != "" {
					return value, nil
				}
			}
		}
	}
	return "", fmt.Errorf("读不到 DATABASE_URL（设环境变量，或在 %s/.env 里写一行 DATABASE_URL=...）", repoRoot())
}

// repoRoot resolves the repository root the way the Node scripts did — they
// carried `PROXY_ROOT || "/Users/thanhhuyennguyen/proxy"`, so they found `.env`
// no matter where they were launched. A plain cwd here would not: the launchd
// pipeline runs `go -C apps/api-go run ./cmd/devdata`, which puts the working
// directory inside apps/api-go, and the tool would then fail to read the repo's
// `.env` and every tick would die with "读不到 DATABASE_URL" while the gate's
// historical assertions stayed green. So walk up to the directory that owns the
// Go module instead of trusting cwd.
func repoRoot() string {
	for _, key := range []string{"PROXY_ROOT", "REPO_ROOT"} {
		if root := os.Getenv(key); root != "" {
			return root
		}
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "apps", "api-go", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return wd
		}
	}
}

func hasFlag(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}

// flagValue reads `--backfill 6`: the value is the argument after the flag.
func flagValue(args []string, flag string) (string, bool) {
	for i, arg := range args {
		if arg == flag && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}
