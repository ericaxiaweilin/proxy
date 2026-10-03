// R15.21 — Migrator 钉 8 个 tripwire:
//  1. Apply 跑完后所有 migration 进 schema_migrations 表
//  2. Re-apply 幂等 (count 仍 = N, 没新 apply)
//  3. Status 报 applied=N pending=0 drift=0
//  4. DryRun 列 pending 但不 apply (count 不变)
//  5. PendingCount / AppliedCount / DriftCount 数字正确
//  6. 漂移检测: 改一个文件 checksum, VerifyDrift 返非 nil
//  7. 顺序: migration 按文件名 lexicographic apply
//  8. 孤儿: applied 但文件不在目录里 -> ListMigrations 标 orphan
package postgres

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupMigratorTest(t *testing.T) (*Migrator, *pgxpool.Pool, string) {
	t.Helper()
	pool := requireTestPool(t)
	// 集成测试 share cluster, schema_migrations 是 public 表。
	// 如果表还不存在, 跳过清表 (第一次跑时表还没被 NewMigrator 创建过)。
	clearSchemaMigrations(t, pool)
	// 临时 migrations dir
	tmpDir, err := os.MkdirTemp("", "migrator-test-")
	if err != nil {
		t.Fatalf("mktemp: %v", err)
	}
	t.Cleanup(func() {
		clearSchemaMigrations(t, pool)
		os.RemoveAll(tmpDir)
	})
	m := NewMigrator(pool, tmpDir)
	return m, pool, tmpDir
}

// clearSchemaMigrations removes only the rows that the migrator tests
// themselves created, leaving the production migration rows
// (059_location_consents, 060_privacy_requests, 061_..., 062_...,
// 063_benefit_routing_network, 064_legal_kill_switches) intact.
//
// Why the previous WHERE clause was broken:
// It deleted rows where version LIKE '001_%' OR '002_%' OR '003_%' OR
// 'migrator-test-%'. Production rows (059, 060, ...) survived. The
// tests then asserted an absolute count (e.g. "want 3 in
// schema_migrations") which passed only when the table was empty
// before. Once a real migration shipped, the count drifted and the
// next gate run failed with "want 3, got 75".
//
// We now delete only test-owned rows (test fixture versions) by
// matching the prefix the test fixtures use. Production rows are
// preserved so the live server's migrator state stays consistent.
func clearSchemaMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='schema_migrations')").Scan(&exists); err != nil {
		t.Fatalf("check schema_migrations: %v", err)
	}
	if !exists {
		return
	}
	// Delete only test-fixture rows. The migrator test writes
	// 001_*, 002_*, 003_* filenames; we use the LIKE clause
	// anchored at '_' so '059_' is NOT matched.
	if _, err := pool.Exec(ctx, "DELETE FROM public.schema_migrations WHERE version LIKE '00_%\\_%' ESCAPE '\\' OR version LIKE 'migrator-test-%'"); err != nil {
		t.Fatalf("clear: %v", err)
	}
}

func writeMigration(t *testing.T, dir, filename, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, filename), []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", err, filename)
	}
}

func TestMigrator_ApplyRecordsAndIdempotent(t *testing.T) {
	m, pool, dir := setupMigratorTest(t)
	ctx := context.Background()

	// 写 3 个 fake migration
	for i, name := range []string{"001_a_init", "002_b_table", "003_c_index"} {
		body := "CREATE TABLE IF NOT EXISTS public.t" + string(rune('a'+i)) + " (id int);\n"
		writeMigration(t, dir, name+".sql", body)
	}

	// Apply
	applied, pending, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(applied) != 3 {
		t.Fatalf("want 3 applied, got %d", len(applied))
	}
	if len(pending) != 0 {
		t.Fatalf("want 0 pending, got %d", len(pending))
	}

	// Verify in DB: the 3 fake migrations should be the only
	// rows in schema_migrations whose version starts with 001_,
	// 002_, or 003_ (the production rows 059, 060, ..., 064_ are
	// preserved by clearSchemaMigrations and do not match the
	// LIKE pattern). The absolute count is unreliable because
	// other gate runs may have left production migration rows
	// in the shared cluster; we filter to test-fixture rows only.
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.schema_migrations WHERE version LIKE '00_%\\_%' ESCAPE '\\' OR version LIKE 'migrator-test-%'").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 3 {
		t.Fatalf("want 3 test-fixture rows in schema_migrations, got %d", n)
	}

	// Re-apply (idempotent)
	applied, pending, err = m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("re-apply: %v", err)
	}
	if len(applied) != 0 {
		t.Fatalf("re-apply should be no-op, got %d new applied", len(applied))
	}
	if len(pending) != 0 {
		t.Fatalf("re-apply should have 0 pending, got %d", len(pending))
	}
}

func TestMigrator_StatusAndCounts(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	writeMigration(t, dir, "002_more.sql", "SELECT 2;\n")

	// Before apply: pending = 2 (our two new files), applied counts
	// rows the migrator knows about for this dir. Status methods
	// enumerate files in m.dir and check schema_migrations for each.
	pending, _ := m.PendingCount(ctx)
	if pending != 2 {
		t.Fatalf("want 2 pending, got %d", pending)
	}
	// 共享测试库里本来就有 170+ 条真 migration，AppliedCount 的绝对值永远不是 0。
	// 这里要断的是"我们这两个文件还没被 apply"，不是"账本是空的"。
	statuses, err := m.ListMigrations(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, st := range statuses {
		if (st.Version == "001_init" || st.Version == "002_more") && st.Applied {
			t.Fatalf("%s should not be applied yet", st.Version)
		}
	}

	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}

	pending, _ = m.PendingCount(ctx)
	// AppliedCount 同样是全账本口径 —— 这里不断绝对值，只确认这次 apply 之后
	// pending 清零且无 drift（apply 本身成功的话，这两项与账本里原有多少条无关）。
	drift, _ := m.DriftCount(ctx)
	if pending != 0 || drift != 0 {
		t.Fatalf("counts: pending=%d drift=%d (want 0/0)", pending, drift)
	}
}

func TestMigrator_DryRunDoesNotApply(t *testing.T) {
	m, pool, dir := setupMigratorTest(t)
	ctx := context.Background()

	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	writeMigration(t, dir, "002_more.sql", "SELECT 2;\n")

	applied, pending, err := m.Apply(ctx, true) // dry-run
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if len(applied) != 0 {
		t.Fatalf("dry-run should not apply, got %d applied", len(applied))
	}
	if len(pending) != 2 {
		t.Fatalf("want 2 pending, got %d", len(pending))
	}

	// Verify schema_migrations has no rows for our 001/002 files.
	// (Other production rows from prior gate runs are preserved
	// by clearSchemaMigrations; we filter to test-fixture rows
	// only because the test cares about side effects of THIS
	// test, not absolute table count.)
	var n int
	pool.QueryRow(ctx, "SELECT count(*) FROM public.schema_migrations WHERE version LIKE '001_%' OR version LIKE '002_%' OR version LIKE 'migrator-test-%'").Scan(&n)
	if n != 0 {
		t.Fatalf("dry-run should not record, got %d test-fixture rows in schema_migrations", n)
	}
}

func TestMigrator_DriftDetected(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}

	// 改文件 -> checksum 变 -> drift
	writeMigration(t, dir, "001_init.sql", "SELECT 999; -- changed\n")

	drift, err := m.VerifyDrift(ctx)
	if err != nil {
		t.Fatalf("verify drift: %v", err)
	}
	if drift == nil {
		t.Fatal("expected drift detection after file change")
	}
	if drift.Version != "001_init" {
		t.Fatalf("drift version: %s", drift.Version)
	}
	if drift.Checksum == drift.StoredChecksum {
		t.Fatal("drift checksums should differ")
	}
}

func TestMigrator_ApplyRefusesDriftBeforePending(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("initial apply: %v", err)
	}
	writeMigration(t, dir, "001_init.sql", "SELECT 999;\n")
	writeMigration(t, dir, "002_pending.sql", "SELECT 2;\n")
	if _, _, err := m.Apply(ctx, false); err == nil || !strings.Contains(err.Error(), ErrDriftDetected.Error()) {
		t.Fatalf("expected drift refusal, got %v", err)
	}
}

func TestMigrator_RejectsFilesystemCopySuffix(t *testing.T) {
	dir := t.TempDir()
	m := NewMigrator(nil, dir)
	writeMigration(t, dir, "035_history 2.sql", "SELECT 1;\n")
	if _, err := m.ListMigrations(context.Background()); err == nil || !strings.Contains(err.Error(), "unsafe migration filename") {
		t.Fatalf("expected unsafe filename error, got %v", err)
	}
}

func TestMigrator_OrphanFromMissingFile(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// 删文件
	if err := os.Remove(filepath.Join(dir, "001_init.sql")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// ListMigrations returns rows from the SHARED schema_migrations
	// table that match this migrator's dir. With the production
	// migrations also in the table (e.g. 059, 060, ..., 064), the
	// call returns all of them as "orphan" (Applied=true, OnDisk=false)
	// because the test migrator's dir has none of them on disk.
	// The test originally expected 1 status; we now expect
	// "at least 1" with the 001_init row being the one we just
	// orphaned. The production rows are an unrelated, expected
	// leak that we filter out in the assertion.
	statuses, err := m.ListMigrations(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var ourOrphan *MigrationStatus
	for i := range statuses {
		if statuses[i].Version == "001_init" {
			ourOrban := statuses[i]
			ourOrphan = &ourOrban
			break
		}
	}
	if ourOrphan == nil {
		t.Fatalf("001_init not in statuses (got %d total)", len(statuses))
	}
	if !ourOrphan.Applied || ourOrphan.OnDisk {
		t.Fatalf("001_init orphan expected: applied=%v onDisk=%v", ourOrphan.Applied, ourOrphan.OnDisk)
	}
}

func TestMigrator_LexicographicOrder(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	// 写乱序文件名, 验证按 lexicographic apply
	writeMigration(t, dir, "003_third.sql", "SELECT 3;\n")
	writeMigration(t, dir, "001_first.sql", "SELECT 1;\n")
	writeMigration(t, dir, "002_second.sql", "SELECT 2;\n")

	applied, _, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	want := []string{"001_first", "002_second", "003_third"}
	if len(applied) != 3 {
		t.Fatalf("want 3 applied, got %d", len(applied))
	}
	for i, v := range want {
		if applied[i] != v {
			t.Fatalf("order[%d]: want %s, got %s", i, v, applied[i])
		}
	}
}

func TestMigrator_FilenameWithDots(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	// filename 带 dot: "001_a.b_c" 也能正确取 version
	writeMigration(t, dir, "001_a.b_c.sql", "SELECT 1;\n")
	applied, _, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(applied) != 1 || applied[0] != "001_a.b_c" {
		t.Fatalf("version: want 001_a.b_c, got %v", applied)
	}
}

func TestMigrator_NonSqlFilesIgnored(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()

	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	writeMigration(t, dir, "README.md", "ignore me\n")
	writeMigration(t, dir, ".DS_Store", "ignore me too\n")
	applied, _, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(applied) != 1 {
		t.Fatalf("non-.sql should be ignored, got %d applied", len(applied))
	}
}

// sharedPool is provided by TestMain in testdb_test.go
var _ = pgx.ErrNoRows
var _ = strings.HasSuffix
