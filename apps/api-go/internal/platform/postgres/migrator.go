package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Migrator 跟踪 / apply / 状态 migration 文件。R15.21 加。
// 之前 applyMigrations (testdb_test.go) 是无状态 apply, 不记版本。
// production 部署需要 schema_migrations 表, 防止:
//   - 同一个 migration 跑两次 (idempotency)
//   - 漏跑 (partial apply)
//   - 漂移 (drift) — 已 apply 的 migration 跟当前文件 checksum 不一致
//
// 用法:
//   m := NewMigrator(pool, migrationsDir)
//   m.Status(ctx)  -> 已 apply + pending + drift
//   m.Apply(ctx, false)  -> 真 apply, 记 schema_migrations
//   m.Apply(ctx, true)   -> dry-run, 只列 pending 不真 apply
type Migrator struct {
	pool          *pgxpool.Pool
	migrationsDir string
	// allowNoTable: 若 schema_migrations 表不存在, 第一次 apply 自动建。
	// 默认 true。设为 false 可拒绝, 让 caller 显式跑 init。
	allowInitSchema bool
}

func NewMigrator(pool *pgxpool.Pool, migrationsDir string) *Migrator {
	return &Migrator{pool: pool, migrationsDir: migrationsDir, allowInitSchema: true}
}

func (m *Migrator) WithAllowInitSchema(b bool) *Migrator {
	m.allowInitSchema = b
	return m
}

// MigrationStatus 一行 migration 的当前状态。
type MigrationStatus struct {
	Version    string    // e.g. "033_media_auditor_role"
	Filename   string    // "033_media_auditor_role.sql"
	Applied    bool      // 是否已 apply
	AppliedAt  time.Time // zero if not applied
	Checksum   string    // 当前文件 SHA-256 (hex 12 chars)
	OnDisk     bool      // 文件在 migrations 目录里
	Drift      bool      // Applied + Checksum != stored
	StoredChecksum string // 之前 apply 时存的 checksum (空 = 还没 apply)
}

// ListMigrations 读 migrations 目录 + 跟 schema_migrations 表对账,
// 返回所有 migration 的状态 (按 version 排序)。
func (m *Migrator) ListMigrations(ctx context.Context) ([]MigrationStatus, error) {
	files, err := m.readMigrationFiles()
	if err != nil {
		return nil, err
	}
	applied, err := m.loadApplied(ctx)
	if err != nil {
		return nil, err
	}
	// 合并: 目录里所有 + 已 apply 但文件不在目录里的 (孤儿)
	all := make(map[string]*MigrationStatus, len(files)+len(applied))
	for _, f := range files {
		sum := sha256Hex([]byte(f.Content))
		all[f.Version] = &MigrationStatus{
			Version:  f.Version,
			Filename: f.Filename,
			OnDisk:   true,
			Checksum: sum,
		}
		if prev, ok := applied[f.Version]; ok {
			all[f.Version].Applied = true
			all[f.Version].AppliedAt = prev.AppliedAt
			all[f.Version].StoredChecksum = prev.Checksum
			all[f.Version].Drift = prev.Checksum != sum
		}
	}
	for v, prev := range applied {
		if _, ok := all[v]; !ok {
			all[v] = &MigrationStatus{
				Version:        v,
				Applied:        true,
				AppliedAt:      prev.AppliedAt,
				StoredChecksum: prev.Checksum,
			}
		}
	}
	out := make([]MigrationStatus, 0, len(all))
	for _, s := range all {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// AppliedCount 已 apply migration 数。
func (m *Migrator) AppliedCount(ctx context.Context) (int, error) {
	all, err := m.loadApplied(ctx)
	if err != nil {
		return 0, err
	}
	return len(all), nil
}

// PendingCount 未 apply migration 数 (files - applied ∩ on disk)。
func (m *Migrator) PendingCount(ctx context.Context) (int, error) {
	statuses, err := m.ListMigrations(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, s := range statuses {
		if s.OnDisk && !s.Applied {
			n++
		}
	}
	return n, nil
}

// DriftCount 已 apply 但 checksum 跟当前文件不一致的数。
// drift = 有人改了已 apply 的 migration 文件。
func (m *Migrator) DriftCount(ctx context.Context) (int, error) {
	statuses, err := m.ListMigrations(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, s := range statuses {
		if s.Drift {
			n++
		}
	}
	return n, nil
}

// Apply 应用所有未 apply 的 migration。如果 dryRun=true, 只列
// pending 不真 apply (用于生产部署前预览)。
// 返回: applied=实际新 apply 的, pending=未 apply 的(dryRun=true
// 时列出, dryRun=false 时保持空)。
// 语义: 调完一次 Apply(false) 后, pending 应该总是空。
func (m *Migrator) Apply(ctx context.Context, dryRun bool) (applied []string, pending []string, err error) {
	files, err := m.readMigrationFiles()
	if err != nil {
		return nil, nil, err
	}
	already, err := m.loadApplied(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, f := range files {
		if _, ok := already[f.Version]; ok {
			continue
		}
		if dryRun {
			pending = append(pending, f.Version)
			continue
		}
		if err := m.applyOne(ctx, f); err != nil {
			return applied, nil, fmt.Errorf("apply %s: %w", f.Filename, err)
		}
		applied = append(applied, f.Version)
	}
	return applied, pending, nil
}

func (m *Migrator) applyOne(ctx context.Context, f migrationFile) error {
	sum := sha256Hex([]byte(f.Content))
	// 跑 migration
	if _, err := m.pool.Exec(ctx, f.Content); err != nil {
		return fmt.Errorf("exec: %w", err)
	}
	// 记 schema_migrations
	if err := m.recordApplied(ctx, f.Version, sum); err != nil {
		return fmt.Errorf("record: %w", err)
	}
	return nil
}

// ensureSchemaMigrationsTable 确保 schema_migrations 表存在。
// 在所有 read/write 前调一次。
func (m *Migrator) ensureSchemaMigrationsTable(ctx context.Context) error {
	if !m.allowInitSchema {
		return nil
	}
	_, err := m.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			checksum TEXT NOT NULL,
			filename TEXT NOT NULL
		)`)
	return err
}

type appliedMigration struct {
	Version   string
	AppliedAt time.Time
	Checksum  string
	Filename  string
}

func (m *Migrator) loadApplied(ctx context.Context) (map[string]appliedMigration, error) {
	if err := m.ensureSchemaMigrationsTable(ctx); err != nil {
		return nil, err
	}
	rows, err := m.pool.Query(ctx, `
		SELECT version, applied_at, checksum, filename
		FROM public.schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]appliedMigration)
	for rows.Next() {
		var am appliedMigration
		if err := rows.Scan(&am.Version, &am.AppliedAt, &am.Checksum, &am.Filename); err != nil {
			return nil, err
		}
		out[am.Version] = am
	}
	return out, rows.Err()
}

func (m *Migrator) recordApplied(ctx context.Context, version, checksum string) error {
	if err := m.ensureSchemaMigrationsTable(ctx); err != nil {
		return err
	}
	filename := version + ".sql"
	_, err := m.pool.Exec(ctx, `
		INSERT INTO public.schema_migrations (version, checksum, filename)
		VALUES ($1, $2, $3)
		ON CONFLICT (version) DO UPDATE
		SET applied_at = now(), checksum = EXCLUDED.checksum, filename = EXCLUDED.filename`,
		version, checksum, filename)
	return err
}

type migrationFile struct {
	Version string // e.g. "033_media_auditor_role"
	Filename string // "033_media_auditor_role.sql"
	Content string
}

func (m *Migrator) readMigrationFiles() ([]migrationFile, error) {
	entries, err := os.ReadDir(m.migrationsDir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %s: %w", m.migrationsDir, err)
	}
	var files []migrationFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		path := filepath.Join(m.migrationsDir, e.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		// Version = filename 不带 .sql 后缀
		ver := strings.TrimSuffix(e.Name(), ".sql")
		files = append(files, migrationFile{
			Version:  ver,
			Filename: e.Name(),
			Content:  string(raw),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Version < files[j].Version })
	return files, nil
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	// 截短 12 字符 (48 bit, 碰撞概率 ~ 1/16 trillion, 足够防误判)
	return hex.EncodeToString(h[:])[:12]
}

// ErrDriftDetected 有人改了已 apply 的 migration 文件, 不能 apply。
var ErrDriftDetected = fmt.Errorf("migration drift detected (file changed after apply)")

// VerifyDrift 返回第一个 drift migration, 或 nil (if no drift)。
func (m *Migrator) VerifyDrift(ctx context.Context) (*MigrationStatus, error) {
	statuses, err := m.ListMigrations(ctx)
	if err != nil {
		return nil, err
	}
	for i := range statuses {
		if statuses[i].Drift {
			return &statuses[i], nil
		}
	}
	return nil, nil
}

// ensure pgx import used (for tests / future queries)
var _ = pgx.ErrNoRows
