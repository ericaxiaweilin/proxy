package matching

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// ConsoleStore 是运营控制台要的那几个口（OPS-MATCHING-TUNABLES-001）。
//
// 为什么是接口而不是直接用 *Postgres：跟 OpsMetrics / Gravity 同一口径 ——
// api 层要能在没有库的情况下测「门、校验、审计、界面字段」这一层。反过来说，
// SQL 本身（列名、upsert 的 version、JSON path）只有对真库跑过才算数，
// 那部分在 internal/platform/postgres 的集成测试里钉。
type ConsoleStore interface {
	TunableOverrides(ctx context.Context) (map[string]TunableChange, error)
	SetTunableOverrides(ctx context.Context, values map[string]float64, by string) (map[string]int, error)
	DecisionTrace(ctx context.Context, limit int) ([]TraceBatch, TraceSummary, error)
}

var _ ConsoleStore = (*Postgres)(nil)

// TunableChange 是一个旋钮上一次被谁改的。库里没有那一行 = 没人改过 = 引擎在用
// DefaultTunables() 的那个数（「谁改的」这个问题要有明确答案，不能靠一个 seed
// 出来的默认行冒充改动记录）。
type TunableChange struct {
	Key       string    `json:"key"`
	Value     float64   `json:"value"`
	UpdatedBy string    `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
	Version   int       `json:"version"`
}

// TunableOverrides 读出厂里存的全部覆盖值。套到默认值上是调用方的事（只有
// Tunables.With 才知道边界，读的时候顺手校验才不会有两份校验）。
func (p *Postgres) TunableOverrides(ctx context.Context) (map[string]TunableChange, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT key, value, updated_by, updated_at, version
		FROM decision.engine_tunables ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]TunableChange{}
	for rows.Next() {
		var c TunableChange
		if err := rows.Scan(&c.Key, &c.Value, &c.UpdatedBy, &c.UpdatedAt, &c.Version); err != nil {
			return nil, err
		}
		out[c.Key] = c
	}
	return out, rows.Err()
}

// ApplyStoredTunables 把库里的覆盖值套到出厂默认上、生效，回一句给启动日志的话。
//
// 故意不返回 error：读不到库、或者库里某个值已经不在现在的边界内（换版本后收紧），
// 都不该拦住进程启动 —— 退回出厂默认就是接线之前那套数，引擎行为逐位相同。
// 但原因必须说出来：「界面摆的是库里的数、引擎其实在用默认值」一旦藏起来，
// 就又是两份账对不上。控制台的 warnings 报同一件事。
func ApplyStoredTunables(ctx context.Context, p *Postgres) string {
	overrides, err := p.TunableOverrides(ctx)
	if err != nil {
		return fmt.Sprintf("撮合旋钮加载失败，按出厂默认跑: %v", err)
	}
	if len(overrides) == 0 {
		return "撮合旋钮: 库里没有覆盖值，按出厂默认跑"
	}
	values := make(map[string]float64, len(overrides))
	for key, c := range overrides {
		values[key] = c.Value
	}
	next, err := DefaultTunables().With(values)
	if err != nil {
		return fmt.Sprintf("撮合旋钮有值不在现在的边界内，整套退回出厂默认: %v", err)
	}
	SetTunables(next)
	return fmt.Sprintf("撮合旋钮: 按库里的 %d 项覆盖生效", len(values))
}

// SetTunableOverrides 一次写一组旋钮，全部成功或全部不写。
//
// 为什么必须是一个事务：运营调口径通常是一起动几个（把可靠提到 45 就把适配从 5 降下来）。
// 逐条写的话，第 3 条失败会留下「改了 2 个半」的库状态，而进程里生效的是校验过的整套 ——
// 两份账又对不上了，而且没有任何报错指向这个缝隙。
// 返回每个 key 的新 version。
func (p *Postgres) SetTunableOverrides(ctx context.Context, values map[string]float64, by string) (map[string]int, error) {
	if len(values) == 0 {
		return map[string]int{}, nil
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	versions := make(map[string]int, len(values))
	// 按 key 排序写：两个运营同时改重叠的旋钮时，加锁顺序一致才不会互相死锁
	// （Go 遍历 map 的顺序是随机的，两边各随机一次就可能一前一后反向持锁）。
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := values[key]
		var version int
		if err := tx.QueryRow(ctx, `
			INSERT INTO decision.engine_tunables (key, value, updated_by, updated_at, version)
			VALUES ($1, $2, $3, now(), 1)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
			    updated_at = now(), version = decision.engine_tunables.version + 1
			RETURNING version`, key, value, by).Scan(&version); err != nil {
			return nil, err
		}
		versions[key] = version
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return versions, nil
}
