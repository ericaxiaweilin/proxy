// Command consent-audit：行为数据的同意核查（只读，不改任何数据）。
//
// 回答一个问题：localnet.interaction_events 里的每一条浏览行为事件，在它发生的那一刻，
// 平台拿得出这个用户对 BEHAVIOR_ANALYTICS 的有效同意吗？（Nghị định 356/2025 Art. 6.2：举证责任在控制者。）
//
//	DATABASE_URL=... go run ./cmd/consent-audit
//
// 分三类：WITH_CONSENT（事件时同意有效、现在也没撤回）/ NO_CONSENT_AT_TIME（事件时没有有效同意：
// 默认开时期留下的、或同意之前的）/ WITHDRAWN_SINCE（事件时有同意，但用户后来撤回了）。
// 后两类就是需要决定怎么处理的数据 —— 这个命令只报数，不删、不改：删不删、匿名化还是保留，
// 是产品和法务的决定，不是一个脚本该替他们做的。
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const query = `
SELECT e.event_type,
       CASE
         WHEN at_time.action IS DISTINCT FROM 'GRANT' THEN 'NO_CONSENT_AT_TIME'
         WHEN now_state.action IS DISTINCT FROM 'GRANT' THEN 'WITHDRAWN_SINCE'
         ELSE 'WITH_CONSENT'
       END AS status,
       COUNT(*), COUNT(DISTINCT e.actor_id), MIN(e.created_at), MAX(e.created_at)
FROM localnet.interaction_events e
LEFT JOIN LATERAL (SELECT c.action FROM privacy.purpose_consents c
                    WHERE c.user_id = e.actor_id AND c.purpose = 'BEHAVIOR_ANALYTICS' AND c.acted_at <= e.created_at
                    ORDER BY c.acted_at DESC LIMIT 1) at_time ON TRUE
LEFT JOIN LATERAL (SELECT c.action FROM privacy.purpose_consents c
                    WHERE c.user_id = e.actor_id AND c.purpose = 'BEHAVIOR_ANALYTICS'
                    ORDER BY c.acted_at DESC LIMIT 1) now_state ON TRUE
GROUP BY 1, 2
ORDER BY 2, 1`

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(2)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer pool.Close()
	rows, err := pool.Query(ctx, query)
	if err != nil {
		fmt.Fprintln(os.Stderr, "query:", err)
		os.Exit(1)
	}
	defer rows.Close()
	fmt.Printf("%-20s %-20s %8s %7s  %s\n", "status", "event_type", "events", "users", "first → last")
	totals := map[string]int{}
	for rows.Next() {
		var eventType, status string
		var n, users int
		var first, last time.Time
		if err := rows.Scan(&eventType, &status, &n, &users, &first, &last); err != nil {
			fmt.Fprintln(os.Stderr, "scan:", err)
			os.Exit(1)
		}
		totals[status] += n
		fmt.Printf("%-20s %-20s %8d %7d  %s → %s\n", status, eventType, n, users, first.Format("2006-01-02"), last.Format("2006-01-02"))
	}
	if err := rows.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "rows:", err)
		os.Exit(1)
	}
	fmt.Printf("\nWITH_CONSENT=%d  NO_CONSENT_AT_TIME=%d  WITHDRAWN_SINCE=%d\n", totals["WITH_CONSENT"], totals["NO_CONSENT_AT_TIME"], totals["WITHDRAWN_SINCE"])
	if totals["NO_CONSENT_AT_TIME"]+totals["WITHDRAWN_SINCE"] > 0 {
		os.Exit(3) // 有需要处理的数据：让 CI / 值班脚本能感知
	}
}
