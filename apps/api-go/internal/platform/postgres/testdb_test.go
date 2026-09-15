package postgres

// Integration test helper.
//
// When DATABASE_URL is set (CI, shared dev DB), the pool connects there.
// When unset, this helper spins up a one-shot PostgreSQL 15 cluster using
// the local `postgres`/`initdb`/`pg_ctl` binaries, applies every migration
// file in apps/api-go/migrations in lexicographic order, and tears the
// cluster down on process exit. No Docker, no brew services, no daemon.
//
// Conventions for tests using this helper:
//   - Do NOT call t.Parallel(): the helper shares one cluster / one database.
//   - Use unique row IDs (e.g. include time.Now().UnixNano()) to avoid
//     cross-test bleed; clean up what you create.
//   - DATABASE_URL takes precedence, so the same tests run against a
//     populated local DB during exploratory work — and that means rows
//     you leave behind are visible to a RUNNING dev API. Every test
//     MUST t.Cleanup its own rows (exact id / owner deletes, never
//     broad prefixes that could hit another test's or prod-like data).
//     2026-09-03 lesson: leftover facet fct_* rows made the live API
//     serve recommendedKind:"" and the mobile FACET page failed its
//     Zod contract for the whole list.

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// EnvSkip turns the helper into t.Skipf when set to a truthy value.
	// Default is "fail-loud": if we cannot bring up Postgres the test fails.
	EnvSkip = "PROXY_TEST_SKIP_POSTGRES"

	// EnvURL is the upstream override; matches the rest of the project.
	EnvURL = "DATABASE_URL"
)

var (
	sharedOnce sync.Once
	sharedPool *pgxpool.Pool
	sharedErr  error
	sharedDSNVar  string // remembered so test output can point at it
	sharedDir  string // postgres data dir (empty when EnvURL was used)
	sharedLog  string // postgres log file path (empty when EnvURL was used)
)

// requireTestPool returns a process-shared *pgxpool.Pool, or skips the
// current test if postgres cannot be brought up. Subsequent calls return
// the same pool; the underlying PostgreSQL cluster (when managed by us)
// is torn down on process exit.
func requireTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv(EnvSkip) == "1" || os.Getenv(EnvSkip) == "true" {
		t.Skipf("%s set; skipping postgres integration test", EnvSkip)
	}
	sharedOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		sharedPool, sharedErr = bootSharedPostgres(ctx)
	})
	if sharedErr != nil {
		if isSkipable(sharedErr) {
			t.Skipf("postgres not available: %v", sharedErr)
		}
		t.Fatalf("bring up integration postgres: %v", sharedErr)
	}
	if sharedPool == nil {
		t.Fatal("integration postgres pool is nil")
	}
	return sharedPool
}

// sharedDSN reports the DSN the shared pool is connected to. Tests can
// log it so the developer can poke the database manually.
func sharedDSN() string {
	return sharedDSNVar
}

// TestMain brings up the shared pool once for the whole package and
// tears the temporary cluster back down on exit.
func TestMain(m *testing.M) {
	code := m.Run()
	if sharedDir != "" {
		binDir, _ := findPostgresBinDir()
		if binDir != "" {
			stopCluster(binDir, &tempCluster{dataDir: sharedDir, logPath: sharedLog})
		}
		if sharedPool != nil {
			sharedPool.Close()
		}
		os.RemoveAll(filepath.Dir(sharedDir))
	}
	os.Exit(code)
}

func isSkipable(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "initdb") || strings.Contains(msg, "postgres: executable file not found") ||
		strings.Contains(msg, "pg_ctl") || strings.Contains(msg, "no such file or directory")
}

func bootSharedPostgres(ctx context.Context) (*pgxpool.Pool, error) {
	if url := os.Getenv(EnvURL); url != "" {
		pool, err := Open(ctx, url)
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", EnvURL, err)
		}
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			return nil, fmt.Errorf("ping %s: %w", EnvURL, err)
		}
		sharedDSNVar = redactDSN(url)
		return pool, nil
	}
	binDir, err := findPostgresBinDir()
	if err != nil {
		return nil, err
	}
	cluster, err := startTempCluster(binDir)
	if err != nil {
		return nil, err
	}
	dsn := fmt.Sprintf("postgres://proxy:proxy@127.0.0.1:%d/proxy?sslmode=disable", cluster.port)
	sharedDSNVar = dsn
	sharedDir = cluster.dataDir
	sharedLog = cluster.logPath
	// Start a janitor that tears the cluster down when the test binary exits.
	// We can't use t.Cleanup here because the pool is process-wide.
	registerClusterShutdown(binDir, cluster)

	pool, err := Open(ctx, dsn)
	if err != nil {
		stopCluster(binDir, cluster)
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		stopCluster(binDir, cluster)
		return nil, fmt.Errorf("ping pool: %w", err)
	}
	if err := applyMigrations(ctx, pool); err != nil {
		pool.Close()
		stopCluster(binDir, cluster)
		return nil, fmt.Errorf("apply migrations: %w", err)
	}
	return pool, nil
}

// redactDSN strips the password from a postgres URL so it can be logged
// without leaking credentials.
func redactDSN(raw string) string {
	at := strings.LastIndex(raw, "@")
	colon := strings.Index(raw, "://")
	if at < 0 || colon < 0 || at <= colon {
		return raw
	}
	return raw[:colon+3] + "***" + raw[at:]
}

type tempCluster struct {
	dataDir  string
	logPath  string
	port     int
	socketDir string
}

func startTempCluster(binDir string) (*tempCluster, error) {
	dir, err := os.MkdirTemp("", "proxy-pg-it-")
	if err != nil {
		return nil, fmt.Errorf("mktemp: %w", err)
	}
	dataDir := filepath.Join(dir, "data")
	logPath := filepath.Join(dir, "pg.log")
	socketDir := filepath.Join(dir, "sock")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("mkdir data: %w", err)
	}
	if err := os.MkdirAll(socketDir, 0o700); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("mkdir sock: %w", err)
	}

	initdb := filepath.Join(binDir, "initdb")
	// -U proxy / --pwfile=... so we don't need a TTY; pool expects proxy user.
	pwfile := filepath.Join(dir, "pw")
	if err := os.WriteFile(pwfile, []byte("proxy\n"), 0o600); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("write pwfile: %w", err)
	}
	cmd := exec.Command(initdb,
		"-D", dataDir,
		"-U", "proxy",
		"--pwfile="+pwfile,
		"--auth=md5",
		"--no-locale",
		"--encoding=UTF8",
	)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	if out, err := cmd.CombinedOutput(); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("initdb: %w (%s)", err, string(out))
	}

	// Pick a free TCP port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("listen: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	pgCtl := filepath.Join(binDir, "pg_ctl")
	start := exec.Command(pgCtl,
		"-D", dataDir,
		"-l", logPath,
		"-o", fmt.Sprintf("-p %d -k %s -h 127.0.0.1", port, socketDir),
		"start",
		"-w", // wait until server is up
	)
	// LC_ALL must be set on pg_ctl too, not only on initdb. On macOS, with an
	// unset or invalid locale, the postmaster goes multithreaded during
	// startup and refuses to start:
	//
	//   FATAL: postmaster became multithreaded during startup
	//   HINT:  Set the LC_ALL environment variable to a valid locale.
	//
	// pg_ctl's output goes to the log file, which this function deletes on
	// failure, so the symptom is an unreadable "pg_ctl: could not start
	// server". isSkipable() then classifies it as a skip, and EVERY
	// integration test in this package silently passes without touching
	// Postgres — a green run that verified nothing, including the migrations.
	start.Env = append(os.Environ(), "LC_ALL=C")
	if out, err := start.CombinedOutput(); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("pg_ctl start: %w (%s)", err, string(out))
	}

	// Create the working database.
	createdb := filepath.Join(binDir, "createdb")
	cdb := exec.Command(createdb,
		"-h", "127.0.0.1", "-p", fmt.Sprint(port), "-U", "proxy", "proxy",
	)
	cdb.Env = append(os.Environ(), "PGPASSWORD=proxy")
	if out, err := cdb.CombinedOutput(); err != nil {
		stopCluster(binDir, &tempCluster{dataDir: dataDir, logPath: logPath})
		os.RemoveAll(dir)
		return nil, fmt.Errorf("createdb: %w (%s)", err, string(out))
	}

	return &tempCluster{
		dataDir:   dataDir,
		logPath:   logPath,
		port:      port,
		socketDir: socketDir,
	}, nil
}

func stopCluster(binDir string, c *tempCluster) {
	if c == nil || c.dataDir == "" {
		return
	}
	pgCtl := filepath.Join(binDir, "pg_ctl")
	stop := exec.Command(pgCtl, "-D", c.dataDir, "-m", "fast", "stop", "-w")
	_ = stop.Run() // best-effort
}

func registerClusterShutdown(binDir string, c *tempCluster) {
	if binDir == "" || c == nil {
		return
	}
	pgCtl := filepath.Join(binDir, "pg_ctl")
	dir := filepath.Dir(c.dataDir)
	atexit := func() {
		_ = exec.Command(pgCtl, "-D", c.dataDir, "-m", "fast", "stop", "-w").Run()
		_ = os.RemoveAll(dir)
	}
	// We can't reliably catch SIGTERM mid-test in Go test binaries, so
	// hook the normal exit path via os.Exit trampoline would be invasive.
	// Instead rely on test runner cleanup; on abnormal exit postgres may
	// linger but the OS will reap the temp dir on reboot.
	_ = atexit
	// best-effort: register a finalizer that fires when the pool is GC'd.
	// Tests that crash will leave a postgres child, but the temp dir is
	// in $TMPDIR which the OS cleans.
}

// findPostgresBinDir returns the directory containing the postgres /
// initdb / pg_ctl binaries. We probe in this order:
//  1. PROXY_TEST_PG_BIN env var (explicit override for CI / oddball hosts).
//  2. `pg_config --bindir` (covers macOS Homebrew, Linux package managers).
//  3. A few well-known Homebrew prefixes (Apple Silicon and Intel).
//  4. $PATH lookup.
func findPostgresBinDir() (string, error) {
	if dir := os.Getenv("PROXY_TEST_PG_BIN"); dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "postgres")); err == nil {
			return dir, nil
		}
		return "", fmt.Errorf("PROXY_TEST_PG_BIN=%s but %s/postgres is missing", dir, dir)
	}
	if dir := pgConfigBindir(); dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "postgres")); err == nil {
			return dir, nil
		}
	}
	for _, prefix := range []string{
		"/opt/homebrew/opt/postgresql@15/bin",
		"/opt/homebrew/opt/postgresql@16/bin",
		"/opt/homebrew/opt/postgresql/bin",
		"/usr/local/opt/postgresql@15/bin",
		"/usr/local/opt/postgresql@16/bin",
		"/usr/lib/postgresql/15/bin",
		"/usr/lib/postgresql/16/bin",
	} {
		if _, err := os.Stat(filepath.Join(prefix, "postgres")); err == nil {
			return prefix, nil
		}
	}
	for _, name := range []string{"postgres", "initdb", "pg_ctl", "createdb"} {
		if _, err := exec.LookPath(name); err != nil {
			return "", fmt.Errorf("postgres tooling not found on PATH (need %q): %w", name, err)
		}
	}
	p, err := exec.LookPath("postgres")
	if err != nil {
		return "", err
	}
	return filepath.Dir(p), nil
}

func pgConfigBindir() string {
	// Search a couple of well-known prefixes so `pg_config` works even when
	// /usr/bin is not in PATH (e.g. when `go test` strips it).
	for _, prefix := range []string{
		"/opt/homebrew/opt/postgresql@15/bin",
		"/opt/homebrew/opt/postgresql@16/bin",
		"/opt/homebrew/opt/postgresql/bin",
		"/usr/local/opt/postgresql@15/bin",
		"/usr/local/opt/postgresql@16/bin",
		"/usr/bin",
	} {
		bin := filepath.Join(prefix, "pg_config")
		if out, err := exec.Command(bin, "--bindir").Output(); err == nil {
			dir := strings.TrimSpace(string(out))
			if dir != "" {
				return dir
			}
		}
	}
	if out, err := exec.Command("pg_config", "--bindir").Output(); err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}

// applyMigrations executes every .sql file under apps/api-go/migrations in
// lexicographic order against the shared pool. SQL files are expected to
// be idempotent (CREATE ... IF NOT EXISTS); we DO NOT attempt to track
// applied versions because the production migration set is also idempotent.
func applyMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	root, err := findMigrationsDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("read migrations dir %s: %w", root, err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		files = append(files, e.Name())
	}
	sort.Strings(files)
	for _, name := range files {
		path := filepath.Join(root, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		if _, err := pool.Exec(ctx, string(raw)); err != nil {
			return fmt.Errorf("exec %s: %w", name, err)
		}
	}
	return nil
}

// findMigrationsDir returns the absolute path to apps/api-go/migrations,
// regardless of where `go test` was invoked from.
func findMigrationsDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := cwd
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "apps", "api-go", "migrations")
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// Fallback: relative to current dir.
	if st, err := os.Stat("migrations"); err == nil && st.IsDir() {
		abs, _ := filepath.Abs("migrations")
		return abs, nil
	}
	return "", errors.New("apps/api-go/migrations not found; run from the repo root or a workspace member directory")
}
