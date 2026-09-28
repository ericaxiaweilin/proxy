package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// readStringFF finds a top-level string value at key in a JSON payload.
func readStringFF(raw, key string) string {
	var top map[string]any
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return ""
	}
	if s, ok := top[key].(string); ok {
		return s
	}
	return ""
}

// allowSlotOffersPG 给集成测试接一个放行的档位报价发起权校验（ORDER-SLOT-OWNER-001
// 之后没接就 fail closed；生产由 demand + marketplace 判归属）。
func allowSlotOffersPG(svc *fulfillment.Service) {
	svc.SetSlotOfferAuthorizer(func(context.Context, string, string, string, string) (bool, error) { return true, nil })
}

// cleanupRunOutbox 在测试结束时删掉本次运行（run 为纳秒级唯一后缀）自己发布的
// outbox 消息。订单 / 审计行按设计不可删；outbox 行留着会挤占共享库里其它测试
// （TestOutboxPostgresLifecycle 一次只 Claim 50 条）的批次。只删本 run 的行。
func cleanupRunOutbox(t *testing.T, pool *pgxpool.Pool, run string) {
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `
			DELETE FROM integration.outbox_messages
			WHERE principal_id LIKE '%' || $1 OR correlation_id LIKE '%' || $1`, run); err != nil {
			t.Logf("cleanup run outbox: %v", err)
		}
	})
}
