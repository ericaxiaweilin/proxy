package main

import (
	"os"
	"path/filepath"
	"testing"
)

// DEV-FEED-PIPELINE-001 (2026-10-02): the pipeline moved off
// scripts/dev-feed-pipeline.mjs onto `go -C apps/api-go run ./cmd/devdata`, and
// the launchd job runs it that way. `-C` puts the *child process* inside
// apps/api-go, so a repoRoot() built on the plain working directory resolved to
// apps/api-go, found no `.env`, and every tick died with "读不到 DATABASE_URL" —
// while the gate's other assertions (launchd loaded, hundreds of posts in the
// DB, devpipe visible in /v1/feed) all describe history and stayed green.
//
// The Node versions were immune by accident: they carried an absolute default
// repo path. These tests pin the shape instead of the accident.
func TestRepoRootResolvesFromModuleSubdirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "apps", "api-go"), 0o755); err != nil {
		t.Fatalf("mkdir module dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "apps", "api-go", "go.mod"), []byte("module x\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}

	t.Setenv("PROXY_ROOT", "")
	t.Setenv("REPO_ROOT", "")
	t.Chdir(filepath.Join(root, "apps", "api-go"))

	got := repoRoot()
	if filepath.Clean(got) != filepath.Clean(root) {
		t.Fatalf("repoRoot() from apps/api-go = %q, want %q — the launchd form `go -C apps/api-go run` lands here, so a cwd-only answer hides the repo .env", got, root)
	}
}

func TestRepoRootHonoursEnvOverride(t *testing.T) {
	t.Setenv("PROXY_ROOT", "/override/proxy")
	t.Setenv("REPO_ROOT", "/should/not/be/used")
	if got := repoRoot(); got != "/override/proxy" {
		t.Fatalf("repoRoot() = %q, want the PROXY_ROOT override", got)
	}
}

// databaseURL is what actually fails a tick: it must reach the repo `.env` even
// when the working directory is the module directory and has no `.env` itself.
func TestDatabaseURLReadsRepoEnvFromModuleDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "apps", "api-go"), 0o755); err != nil {
		t.Fatalf("mkdir module dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "apps", "api-go", "go.mod"), []byte("module x\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("DATABASE_URL=postgres://dev@localhost/devdb\n"), 0o644); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	t.Setenv("DATABASE_URL", "")
	t.Setenv("PROXY_ROOT", "")
	t.Setenv("REPO_ROOT", "")
	t.Chdir(filepath.Join(root, "apps", "api-go"))

	dsn, err := databaseURL()
	if err != nil {
		t.Fatalf("databaseURL(): %v — a launchd tick would die here while the gate stays green", err)
	}
	if dsn != "postgres://dev@localhost/devdb" {
		t.Fatalf("databaseURL() = %q, want the value from the repo .env", dsn)
	}
}

// A missing DATABASE_URL must be an error, not an empty DSN that later opens a
// pool against something unintended.
func TestDatabaseURLFailsLoudlyWhenNothingIsConfigured(t *testing.T) {
	isolated := t.TempDir()
	if err := os.WriteFile(filepath.Join(isolated, "go.mod"), []byte("module x\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PROXY_ROOT", isolated)
	t.Setenv("REPO_ROOT", "")

	if _, err := databaseURL(); err == nil {
		t.Fatal("databaseURL() succeeded with no DATABASE_URL anywhere — an empty DSN must not be treated as usable")
	}
}
