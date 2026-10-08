// Command consent-audit：行为数据的同意核查（只读，不改任何数据）。
//
// 回答：localnet.interaction_events 里的每条浏览行为事件，在它发生的那一刻，平台拿得出
// 「这个用户对某个用途的有效同意」吗？（Nghị định 356/2025 Art. 6.2：举证责任在控制者。）
// 判定规则用的就是线上读取用的那一份（internal/consent.ValidAtSQL），不是另写的一版。
//
//	DATABASE_URL=... go run ./cmd/consent-audit
//
// 输出：每个用途有多少事件是「事件时同意有效、现在也没撤回」的（这个用途可以处理的量），
// 以及**没有任何一个采集用途有效同意**的事件数 —— 这批是需要产品 / 法务决定怎么处理的数据
// （删除 / 匿名化 / 保留的依据）。命令只报数，不删不改。有待处理数据时退出码 3。
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/consent"
)

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

	capture := consent.CapturePurposes()
	anyValid := make([]string, 0, len(capture))
	cols := []string{"COUNT(*)"}
	for _, p := range capture {
		cols = append(cols, "COUNT(*) FILTER (WHERE "+consent.ValidAtSQL("e.actor_id", "e.created_at", p)+")")
		anyValid = append(anyValid, consent.ValidAtSQL("e.actor_id", "e.created_at", p))
	}
	cols = append(cols, "COUNT(*) FILTER (WHERE NOT ("+strings.Join(anyValid, " OR ")+"))")
	cols = append(cols, "COUNT(DISTINCT e.actor_id) FILTER (WHERE NOT ("+strings.Join(anyValid, " OR ")+"))")
	row := pool.QueryRow(ctx, "SELECT "+strings.Join(cols, ", ")+" FROM localnet.interaction_events e")
	total, perPurpose := 0, make([]int, len(capture))
	var none, noneUsers int
	dest := []any{&total}
	for i := range perPurpose {
		dest = append(dest, &perPurpose[i])
	}
	dest = append(dest, &none, &noneUsers)
	if err := row.Scan(dest...); err != nil {
		fmt.Fprintln(os.Stderr, "query:", err)
		os.Exit(1)
	}
	fmt.Printf("behavior events total: %d\n\n", total)
	fmt.Printf("%-26s %s\n", "purpose", "events processable under a valid consent")
	for i, p := range capture {
		fmt.Printf("%-26s %d\n", p, perPurpose[i])
	}
	fmt.Printf("\nNO valid consent for ANY capture purpose at event time: %d events from %d users\n", none, noneUsers)
	if none > 0 {
		os.Exit(3)
	}
}
