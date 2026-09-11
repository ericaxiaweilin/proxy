package postgres

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/profile"
)

// profileEnvelope 构造 profile 域信封（actor 必须是 USER —— 域层守卫）。
func profileEnvelope(kind, actorID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_profile_pg",
		CommandType:    kind,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "UserProfile", ID: actorID},
		IdempotencyKey: "profile-pg-test-key",
		AuthContext:    map[string]any{},
		Purpose:        "test",
		CorrelationID:  "corr_profile_pg",
		RequestedAt:    "2026-09-11T00:00:00Z",
		Payload:        payload,
	}
}

func profileBody(t *testing.T, result command.Result) map[string]any {
	t.Helper()
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%v)", result.Outcome, result.Error)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &value); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	record, ok := value["profile"].(map[string]any)
	if !ok {
		t.Fatalf("profile missing in %#v", value)
	}
	return record
}

func profileOutcome(result command.Result) string {
	if result.Error != nil {
		return result.Error.ErrorCode
	}
	return result.Outcome
}

// TestProfilePostgresLifecycle 走真实 PG：081_user_profiles 迁移必须已建表、
// Upsert 是 ON CONFLICT 语义、handle 唯一索引冲突要落成 PROFILE_HANDLE_TAKEN、
// 改名要释放老 handle、读路径按 id / handle 双入口。
//
// 清理纪律：本测试只删自己 run 前缀建的两行（禁止宽前缀 LIKE 误删）。
func TestProfilePostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	repo := NewProfileRepository(pool)
	svc := profile.NewWithRepository(repo)
	ctx := t.Context()

	run := strconv.FormatInt(time.Now().UnixNano(), 10)
	userA := "user_profile_pg_a_" + run
	userB := "user_profile_pg_b_" + run
	handleA := "pg_handle_a_" + run
	handleA2 := "pg_handle_a2_" + run
	t.Cleanup(func() {
		// 精确 id 删除；表内只有本 run 造的行。
		pool.Exec(context.Background(),
			`DELETE FROM profile.user_profiles WHERE user_account_id IN ($1, $2)`, userA, userB)
	})

	// 1. 首次写入：行必须真落库。
	created := profileBody(t, svc.HandleContext(ctx, profileEnvelope("UpsertUserProfile", userA, map[string]any{
		"name": "PG A", "handle": "@" + handleA, "bio": "bio", "city": "HCM", "avatarUrl": "media/pg.png",
	})))
	if created["handle"] != handleA {
		t.Fatalf("handle not normalized: %#v", created["handle"])
	}
	createdAt := created["createdAt"]
	var rowCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM profile.user_profiles WHERE user_account_id = $1`, userA).Scan(&rowCount); err != nil {
		t.Fatalf("count row: %v", err)
	}
	if rowCount != 1 {
		t.Fatalf("expected 1 persisted row, got %d", rowCount)
	}

	// 2. 按 id 读回。
	byID := profileBody(t, svc.HandleContext(ctx, profileEnvelope("GetUserProfile", userB, map[string]any{
		"userAccountId": userA,
	})))
	if byID["userAccountId"] != userA || byID["handle"] != handleA {
		t.Fatalf("read by id mismatch: %#v", byID)
	}

	// 3. 按 handle 读回（带 @ 前缀也要能解析）。
	byHandle := profileBody(t, svc.HandleContext(ctx, profileEnvelope("GetUserProfile", userB, map[string]any{
		"handle": "@" + handleA,
	})))
	if byHandle["userAccountId"] != userA {
		t.Fatalf("read by handle mismatch: %#v", byHandle)
	}

	// 4. handle 全局唯一：另一个账户抢注 → 唯一索引 23505 → PROFILE_HANDLE_TAKEN。
	taken := svc.HandleContext(ctx, profileEnvelope("UpsertUserProfile", userB, map[string]any{
		"name": "PG B", "handle": handleA,
	}))
	if got := profileOutcome(taken); got != "PROFILE_HANDLE_TAKEN" {
		t.Fatalf("expected PROFILE_HANDLE_TAKEN, got %s", got)
	}
	// 拒掉的写入不得留行。
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM profile.user_profiles WHERE user_account_id = $1`, userB).Scan(&rowCount); err != nil {
		t.Fatalf("count userB: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("rejected upsert must not persist a row, got %d", rowCount)
	}

	// 5. 同一账户改名：ON CONFLICT 更新、仍是一行、createdAt 保留、老 handle 释放。
	renamed := profileBody(t, svc.HandleContext(ctx, profileEnvelope("UpsertUserProfile", userA, map[string]any{
		"name": "PG A2", "handle": handleA2,
	})))
	if renamed["handle"] != handleA2 || renamed["name"] != "PG A2" {
		t.Fatalf("rename mismatch: %#v", renamed)
	}
	if renamed["createdAt"] != createdAt {
		t.Fatalf("createdAt must be preserved across upsert: %v -> %v", createdAt, renamed["createdAt"])
	}
	var storedCreated, storedUpdated time.Time
	if err := pool.QueryRow(ctx,
		`SELECT created_at, updated_at FROM profile.user_profiles WHERE user_account_id = $1`, userA).
		Scan(&storedCreated, &storedUpdated); err != nil {
		t.Fatalf("select timestamps: %v", err)
	}
	if storedUpdated.Before(storedCreated) {
		t.Fatalf("updated_at must not precede created_at: %v < %v", storedUpdated, storedCreated)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM profile.user_profiles WHERE user_account_id = $1`, userA).Scan(&rowCount); err != nil {
		t.Fatalf("count after rename: %v", err)
	}
	if rowCount != 1 {
		t.Fatalf("upsert must keep a single row, got %d", rowCount)
	}

	// 老 handle 现在必须可被别的账户接手（唯一索引上没有残留）。
	if reclaimed := svc.HandleContext(ctx, profileEnvelope("UpsertUserProfile", userB, map[string]any{
		"name": "PG B", "handle": handleA,
	})); reclaimed.Outcome != "ACCEPTED" {
		t.Fatalf("freed handle must be reclaimable, got %s (%v)", reclaimed.Outcome, reclaimed.Error)
	}

	// 6. 未知目标 → 业务拒绝（不是 500）。
	missing := svc.HandleContext(ctx, profileEnvelope("GetUserProfile", userA, map[string]any{
		"userAccountId": "user_profile_pg_missing_" + run,
	}))
	if got := profileOutcome(missing); got != "USER_PROFILE_NOT_FOUND" {
		t.Fatalf("expected USER_PROFILE_NOT_FOUND, got %s", got)
	}
}
