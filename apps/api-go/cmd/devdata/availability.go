package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// availability is the port of scripts/dev-availability.mjs: it gives the dev users
// real scheduling rows and keeps the six pre-existing fixtures from expiring.
// HOME-FORYOU-FREE-001.
//
// The rail's "is this person free right now" used to be a hardcoded
// `online: false` plus a `Math.random()` refresh — a number with no relation to
// reality presented as a promise, the same class of error as the 0m distances in
// PERSON-DISTANCE-ZERO-001. The fact source is supply.availability_windows (no
// second table), and free_at is computed on the Postgres read side.
//
// Three states, not two: no schedule at all means FreeAt = nil = unknown, not
// "free". So a deliberate share of users gets no window — if everyone were
// scheduled the rule could not be exercised, which is why "nobody is unscheduled"
// is reported as a failure below.
//
// The rolling window is the one place this tool updates instead of only inserting:
// the six fixtures' end_at was 2026-10-04, so they would all silently expire and the
// rail would show nobody without raising anything.
func availability(ctx context.Context, pool *pgxpool.Pool, out io.Writer, args []string) error {
	fmt.Fprintf(out, "=== dev availability · 滚动 %d 天排期（HOME-FORYOU-FREE-001）===\n", availabilityRollingDays)
	if !hasFlag(args, "--verify") {
		if err := seedAvailabilityWindows(ctx, pool, out); err != nil {
			return err
		}
	}
	return verifyAvailability(ctx, pool, out)
}

const availabilityRollingDays = 14

type scheduleProfile struct {
	suffix    string
	startHour int
	endHour   int
	ratio     float64
}

// Each band decides how many of its people really get a schedule; the 0.35 band and
// the `_none` row are what keep the "unknown" state populated.
var scheduleProfiles = []scheduleProfile{
	{"_am", 9, 21, 1.0},
	{"_pm", 14, 22, 0.9},
	{"_noon", 11, 15, 0.5},
	{"_none", 0, 0, 0.35},
}

// availabilityFixtures are the six hand-written windows that predate this tool; they
// are rolled forward instead of duplicated.
var availabilityFixtures = []string{
	"aw_agent_linh", "aw_agent_mai", "aw_agent_an",
	"aw_agent_thao", "aw_agent_minh", "aw_agent_yen",
}

func seedAvailabilityWindows(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	rows, err := pool.Query(ctx, `
		SELECT agent_id FROM supply.agent_profiles
		 WHERE lat IS NOT NULL
		   AND (agent_id LIKE 'agent_devpipe_%' OR agent_id LIKE 'agent_user_devseed_%')
		 ORDER BY agent_id`)
	if err != nil {
		return fmt.Errorf("list scheduled agents: %w", err)
	}
	var agents []string
	for rows.Next() {
		var agentID string
		if err := rows.Scan(&agentID); err != nil {
			rows.Close()
			return fmt.Errorf("scan agent: %w", err)
		}
		agents = append(agents, agentID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read agents: %w", err)
	}
	if len(agents) == 0 {
		return fmt.Errorf("没有带坐标的开发用户 —— 先跑 devdata distance-tiers")
	}

	written := 0
	for i, agentID := range agents {
		profile := scheduleProfiles[i%len(scheduleProfiles)]
		// Deterministic per-agent share of the band; the multiplier is a prime so the
		// pattern never lines up with the band length.
		if float64((i*7919)%100)/100 >= profile.ratio {
			continue
		}
		if profile.endHour <= profile.startHour {
			continue // the `_none` band writes no window on purpose
		}
		id := "aw_dev_" + agentID + profile.suffix
		result, err := pool.Exec(ctx, `
			INSERT INTO supply.availability_windows
			  (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
			VALUES ($1, $2,
			        date_trunc('day', now()) + make_interval(hours => $3::int),
			        date_trunc('day', now()) + make_interval(hours => $4::int),
			        'dev', 'AVAILABLE', now(), now())
			ON CONFLICT (id) DO UPDATE
			  SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
			      status = 'AVAILABLE', updated_at = now()`,
			id, agentID, profile.startHour, profile.endHour)
		if err != nil {
			return fmt.Errorf("write availability for %s: %w", agentID, err)
		}
		written += int(result.RowsAffected())
	}

	if _, err := pool.Exec(ctx, `
		UPDATE supply.availability_windows
		   SET start_at = date_trunc('day', now()),
		       end_at   = date_trunc('day', now()) + make_interval(days => $1::int),
		       updated_at = now()
		 WHERE id = ANY($2)`,
		availabilityRollingDays, availabilityFixtures); err != nil {
		return fmt.Errorf("roll the six fixture windows forward: %w", err)
	}

	fmt.Fprintf(out, "  已写 %d 段排期（滚动 %d 天）· 6 条 fixture 已往前滚\n", written, availabilityRollingDays)
	return nil
}

func verifyAvailability(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	var total, expired, unscheduled int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM supply.availability_windows WHERE status = 'AVAILABLE'`).Scan(&total); err != nil {
		return fmt.Errorf("count available windows: %w", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM supply.availability_windows WHERE status = 'AVAILABLE' AND end_at <= now()`).Scan(&expired); err != nil {
		return fmt.Errorf("count expired windows: %w", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM supply.agent_profiles a
		 WHERE a.lat IS NOT NULL
		   AND NOT EXISTS (SELECT 1 FROM supply.availability_windows w
		                    WHERE w.agent_id = a.agent_id AND w.status = 'AVAILABLE' AND w.end_at > now())`).
		Scan(&unscheduled); err != nil {
		return fmt.Errorf("count users with no schedule: %w", err)
	}

	fmt.Fprintf(out, "\n  AVAILABLE 窗口：%d 段\n", total)
	fmt.Fprintf(out, "  已过期（必须为 0）：%d\n", expired)
	fmt.Fprintf(out, "  带坐标但**没有排期**的用户：%d（这些人的 FreeAt 是 nil=未知，不是\"有空\"）\n", unscheduled)
	fmt.Fprintln(out, "\n  事实源：supply.availability_windows（free_at 由 Postgres 侧服务端读计算）")
	fmt.Fprintf(out, "  滚动窗口：%d 天 —— 重新执行本命令即可往前滚，不必手工改日期。\n", availabilityRollingDays)

	// The two failure kinds keep the Node script's prefixes: FAIL is a state that makes
	// the rail show nobody, WARN is "this tree can no longer exercise the unknown≠free
	// rule". Both exit non-zero, and a caller grepping FAIL must still find it.
	var failures []string
	if expired != 0 {
		failures = append(failures, fmt.Sprintf(
			"\n  FAIL: 有 %d 段已过期 —— 推荐位会表现为「刷不出人」且不报错。再跑一次本命令即可。", expired))
	} else {
		fmt.Fprintln(out, "\n  排期健康：没有已过期的窗口")
	}
	if unscheduled == 0 {
		failures = append(failures, "\n  WARN: 所有用户都排满了期 —— 「未知 ≠ 有空」这条规则就没法验了。\n"+
			"        _none 档故意不给一部分人排期，就是为了留出「未知」这一态。")
	}
	if len(failures) > 0 {
		return fmt.Errorf("%s", strings.Join(failures, ""))
	}
	return nil
}
