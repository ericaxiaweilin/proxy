package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/engagement"
)

// TestReceivedEngagementPostgresRoundTrip (ANALYTICS-ME-001): CountReceivedEngagement
// 的真风险在 SQL（join localnet.posts 定归属 + 窗口 + 排除自赞），memory 单测
// 覆盖不到。run-scoped 行 + t.Cleanup，不污染真实用户数据。
func TestReceivedEngagementPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)
	svc := engagement.NewWithRepository(repo)

	run := time.Now().Format("150405.000000")
	owner := "user_rx_pg_" + run
	other := "user_rx_other_pg_" + run
	postID := "post_rx_pg_" + run
	if _, err := pool.Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, visibility, city_scope, status, created_at)
		VALUES ($1, 'USER', $2, 'rx', 'rx test seed', 'PUBLIC', 'hanoi', 'PUBLISHED', NOW())
		ON CONFLICT (id) DO NOTHING`, postID, owner); err != nil {
		t.Fatalf("seed post: %v", err)
	}
	old := time.Now().UTC().AddDate(0, 0, -40)
	fresh := time.Now().UTC().Add(-time.Hour)
	otherOld := "user_rx_old_pg_" + run
	seed := []struct {
		table, id, actor string
		ts               time.Time
		extra            string
	}{
		{"reactions", "rxn_rx_in", other, fresh, ""},
		{"reactions", "rxn_rx_self", owner, fresh, ""},
		{"reactions", "rxn_rx_old", otherOld, old, ""},
		{"replies", "rep_rx_in", other, fresh, ""},
		{"replies", "rep_rx_self", owner, fresh, ""},
		{"replies", "rep_rx_old", otherOld, old, ""},
	}
	for _, s := range seed {
		if s.table == "reactions" {
			_, err := pool.Exec(ctx, `INSERT INTO engagement.reactions (id, post_id, actor_id, kind, created_at) VALUES ($1,$2,$3,'LIKE',$4) ON CONFLICT (id) DO NOTHING`,
				s.id, postID, s.actor, s.ts)
			if err != nil {
				t.Fatalf("seed reaction: %v", err)
			}
		} else {
			_, err := pool.Exec(ctx, `INSERT INTO engagement.replies (reply_id, post_id, actor_id, body, created_at) VALUES ($1,$2,$3,'rx body',$4) ON CONFLICT (reply_id) DO NOTHING`,
				s.id, postID, s.actor, s.ts)
			if err != nil {
				t.Fatalf("seed reply: %v", err)
			}
		}
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM engagement.reactions WHERE post_id=$1`, postID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM engagement.replies WHERE post_id=$1`, postID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.posts WHERE id=$1`, postID)
	})

	since := time.Now().UTC().AddDate(0, 0, -engagement.ReceivedEngagementWindowDays)
	stat, err := repo.CountReceivedEngagement(ctx, owner, since)
	if err != nil {
		t.Fatalf("CountReceivedEngagement: %v", err)
	}
	if stat.Reactions != 1 || stat.Replies != 1 {
		t.Fatalf("stat = %+v, want {reactions:1 replies:1} (self/old excluded)", stat)
	}

	res := svc.HandleContext(ctx, rbEnvelope("GetReceivedEngagementStats", map[string]any{}, owner))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("command: got %s (%+v)", res.Outcome, res.Error)
	}
	var body struct {
		Stats engagement.ReceivedEngagementStats `json:"stats"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Stats.Reactions != 1 || body.Stats.Replies != 1 {
		t.Fatalf("command stats = %+v, want {1 1}", body.Stats)
	}
}
