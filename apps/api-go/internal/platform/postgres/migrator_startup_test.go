// R15.22 — migration 自动 apply 在 startup 时的行为
//
// 钉 6 个 tripwire (migrator 路径, 不是 main.go 路径):
//   1. Apply 跑完后, AppliedCount 增 1 (有 1 个新 migration)
//   2. drift detected 时, VerifyDrift 返非 nil
//   3. drift 不存在时, VerifyDrift 返 nil
//   4. 启动模拟: drift -> 阻断 (我们用 VerifyDrift 模拟; main.go
//      实际 fail-fast 是 log.Fatalf, 这里测 verifier)
//   5. 启动模拟: applied 0 时, AppliedCount 保持不变
//   6. 启动模拟: 已有 migration + 新 migration -> Apply 返 [新], 旧的
//      不重新跑
//
// 注: 实际 main.go 启动逻辑通过 e2e (r1522_auto_apply_e2e.sh) 覆盖。
package postgres

import (
	"context"
	"testing"
)

func TestMigrator_Startup_NewMigrationApplied(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	// 共享测试库里本来就有 170+ 条真 migration，AppliedCount 的绝对值永远对不上。
	// 这里只能断言增量：这次的 2 条跑完，总数多了 2。
	before, _ := m.AppliedCount(ctx)
	// 第一个 migration
	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	// 加新 migration (模拟 dev 拉新代码)
	writeMigration(t, dir, "002_new_feature.sql", "SELECT 2;\n")
	applied, pending, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("second apply: %v", err)
	}
	if len(applied) != 1 || applied[0] != "002_new_feature" {
		t.Fatalf("want only 002 applied, got %v", len(applied))
	}
	if len(pending) != 0 {
		t.Fatalf("pending should be empty, got %d", len(pending))
	}

	// 计数: 这次多了 2（不是"一共 2"—— 后者只在空库成立）。
	after, _ := m.AppliedCount(ctx)
	if after-before != 2 {
		t.Fatalf("want +2 applied, got +%d", after-before)
	}
}

func TestMigrator_Startup_DriftDetected(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// 改文件
	writeMigration(t, dir, "001_init.sql", "SELECT 999;\n")
	drift, err := m.VerifyDrift(ctx)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if drift == nil {
		t.Fatal("expected drift detection")
	}
}

func TestMigrator_Startup_NoDrift(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	writeMigration(t, dir, "001_init.sql", "SELECT 1;\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	drift, err := m.VerifyDrift(ctx)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if drift != nil {
		t.Fatalf("no drift expected, got %+v", drift)
	}
}

func TestMigrator_Startup_FirstRunAppliesAll(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	// 模拟全新 db: 3 个 migration 都还没跑
	for _, name := range []string{"001_a", "002_b", "003_c"} {
		writeMigration(t, dir, name+".sql", "SELECT 1;\n")
	}
	applied, pending, err := m.Apply(ctx, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(applied) != 3 {
		t.Fatalf("first run should apply all, got %d", len(applied))
	}
	if len(pending) != 0 {
		t.Fatalf("pending should be empty, got %d", len(pending))
	}
}

func TestMigrator_Startup_SkipsAlreadyApplied(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	for _, name := range []string{"001_a", "002_b"} {
		writeMigration(t, dir, name+".sql", "SELECT 1;\n")
	}
	// 第一次: 跑 2
	applied, _, _ := m.Apply(ctx, false)
	if len(applied) != 2 {
		t.Fatalf("first: want 2, got %d", len(applied))
	}
	// 第二次: 0 (idempotent)
	applied, _, _ = m.Apply(ctx, false)
	if len(applied) != 0 {
		t.Fatalf("second: want 0 (idempotent), got %d", len(applied))
	}
	// 加新
	writeMigration(t, dir, "003_c.sql", "SELECT 1;\n")
	applied, _, _ = m.Apply(ctx, false)
	if len(applied) != 1 || applied[0] != "003_c" {
		t.Fatalf("third: want [003_c], got %v", applied)
	}
}

func TestMigrator_Startup_PreservesChecksumAcrossRuns(t *testing.T) {
	m, _, dir := setupMigratorTest(t)
	ctx := context.Background()
	// foo_x 是本测试专用的固定表名：上次崩溃会残留，先清掉再建。
	// （固定名是故意的 —— drift 断言要改同一个文件比指纹，run 级唯一表名反而测不到。）
	pool := testPool(t)
	pool.Exec(ctx, `DROP TABLE IF EXISTS public.foo_x`)
	writeMigration(t, dir, "001_init.sql", "CREATE TABLE public.foo_x (id int);\n")
	if _, _, err := m.Apply(ctx, false); err != nil {
		t.Fatalf("apply: %v", err)
	}
	// 第二次跑 (重起) 仍无 drift
	drift, _ := m.VerifyDrift(ctx)
	if drift != nil {
		t.Fatalf("second run should have no drift: %+v", drift)
	}
	// 改文件 -> drift
	writeMigration(t, dir, "001_init.sql", "CREATE TABLE public.foo_x (id bigint);\n")
	drift, _ = m.VerifyDrift(ctx)
	if drift == nil {
		t.Fatal("expected drift after file change")
	}
}
