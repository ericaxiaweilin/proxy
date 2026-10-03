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
// The rolling window is the one place this tool updates instead of only inserting.
// Two kinds of rows roll: the six hand-written fixtures (their end_at was a literal
// 2026-10-04, so they would all silently expire and the rail would show nobody without
// raising anything), and the per-band dev windows, which are written relative to now()
// so "跑一次就把排期往前挪"是真的成立 —— 见 scheduleProfiles 上面那段。
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

// scheduleProfile is one band of people. The window is written **relative to now**
// (leadHours in the past, spanHours into the future), not as fixed clock hours.
type scheduleProfile struct {
	suffix    string
	leadHours int
	spanHours int
	ratio     float64
}

// Each band decides how many of its people really get a schedule; the 0.35 band and
// the `_none` row are what keep the "unknown" state populated.
//
// 2026-10-03：这里原来是「今天的 9:00–21:00 / 14:00–22:00 / 11:00–15:00」这种钟点带
// （node 版照搬过来的）。跑过一次就露馅：23:15 执行本命令，写进去的每一段**当时就已经
// 过期**，报告里的「有 N 段已过期 —— 再跑一次本命令即可」在夜里根本救不了，实测
// 118 → 383 段越跑越多。而它承诺给用户看的现象是真的：排期全过期 ⇒ 推荐位表现为
// 「刷不出人」且不报错。
//
// 改成相对 now 之后，每一段都必然覆盖"现在"，过期数按构造为 0；三个状态依然都在 ——
// `_none` 那档不给排期（nil=未知），而查的是别的时段时（今晚 22:00 / 明早 8:00）
// 三段跨度不同，仍然会算出 false（有排期但不覆盖）。
var scheduleProfiles = []scheduleProfile{
	{"_am", 2, 12, 1.0},
	{"_pm", 1, 8, 0.9},
	{"_noon", 3, 4, 0.5},
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
		if profile.spanHours <= 0 {
			continue // the `_none` band writes no window on purpose
		}
		// 一人一行，且 id 只由 agent 决定。原来 id 带档位后缀（aw_dev_<agent>_am），
		// 而档位是按 ORDER BY agent_id 的下标取模分配的 —— 管线每 5 分钟多一个人，
		// 字典序里位数一变，某些人的下标就换档，于是**旧后缀行永远留在库里过期**。
		// 实测攒到 216 段：报告里"再跑一次"根本救不了那种行，因为它已经不是任何人的
		// 当前行了。id 不带档位之后，换档就是同一行改起止时间，不留残骸。
		id := "aw_dev_" + agentID
		result, err := pool.Exec(ctx, `
			INSERT INTO supply.availability_windows
			  (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
			VALUES ($1, $2,
			        now() - make_interval(hours => $3::int),
			        now() + make_interval(hours => $4::int),
			        'dev', 'AVAILABLE', now(), now())
			ON CONFLICT (id) DO UPDATE
			  SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
			      status = 'AVAILABLE', updated_at = now()`,
			id, agentID, profile.leadHours, profile.spanHours)
		if err != nil {
			return fmt.Errorf("write availability for %s: %w", agentID, err)
		}
		written += int(result.RowsAffected())
	}

	// 收掉旧形状留下的残骸：带档位后缀的行（aw_dev_<agent>_am 之类）已经不是任何人的
	// 当前行，却还标着 AVAILABLE。只改状态、不删行（BLOCKED 是这一个域本来就有的合法
	// 状态，见文件头的 AVAILABLE/BLOCKED/BOOKED），且**限定在 aw_dev_ 前缀内** —— 本
	// 工具只收尾自己写过的东西。读模型 lateral 带 end_at > now()，所以这些行并不改变
	// 用户看到的 free_at；留着它们的代价是"过期数永远降不到 0"，于是这条报告变成噪音，
	// 而噪音的门禁等于没有门禁。
	if closed, err := pool.Exec(ctx, `
		UPDATE supply.availability_windows
		   SET status = 'BLOCKED', updated_at = now()
		 WHERE id LIKE 'aw_dev_%'
		   AND status = 'AVAILABLE'
		   AND id <> 'aw_dev_' || agent_id`); err != nil {
		return fmt.Errorf("close superseded dev windows: %w", err)
	} else if n := int(closed.RowsAffected()); n > 0 {
		fmt.Fprintf(out, "  收尾 %d 段被换档取代的旧 dev 行（AVAILABLE→BLOCKED，不删）\n", n)
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

	fmt.Fprintf(out, "  已写 %d 段排期（贴 now 起止）· 6 条 fixture 铺满 %d 天\n", written, availabilityRollingDays)
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
	fmt.Fprintf(out, "  滚动口径：dev 排期按 now()-lead..now()+span 写（重跑即前滚）；6 条 fixture 铺满 %d 天。\n", availabilityRollingDays)

	// The two failure kinds keep the Node script's prefixes: FAIL is a state that makes
	// the rail show nobody, WARN is "this tree can no longer exercise the unknown≠free
	// rule". Both exit non-zero, and a caller grepping FAIL must still find it.
	var failures []string
	if expired != 0 {
		failures = append(failures, fmt.Sprintf(
			"\n  FAIL: 有 %d 段标着 AVAILABLE 却已经过期。读模型 lateral 带 end_at > now()，"+
				"\n        所以它们不会把谁显示成「有空」——真正的问题是滚动没收敛：要么本命令"+
				"\n        跑完到现在已过 span 小时（重跑本命令即可），要么有别的写者在留下旧行。", expired))
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
