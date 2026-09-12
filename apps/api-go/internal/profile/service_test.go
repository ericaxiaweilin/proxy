package profile

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// envelopeFor 构造 profile 域的测试信封（字段集与其它域测试一致）。
func envelopeFor(kind, actorType, actorID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_profile_test",
		CommandType:    kind,
		CommandVersion: 1,
		Actor:          command.Actor{Type: actorType, ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "UserProfile", ID: "new"},
		IdempotencyKey: "profile-test-key",
		AuthContext:    map[string]any{},
		Purpose:        "test",
		CorrelationID:  "corr_profile_test",
		RequestedAt:    "2026-09-11T00:00:00Z",
		Payload:        payload,
	}
}

func testService(now time.Time) (*Service, *clock.Fixed) {
	fixed := clock.NewFixed(now)
	return NewWithRepositoryAndClock(NewMemoryRepository(), fixed), fixed
}

// profileRecord 取命令响应里的 profile 对象。
func profileRecord(t *testing.T, result command.Result) map[string]any {
	t.Helper()
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%v)", result.Outcome, result.Error)
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &value); err != nil {
		t.Fatalf("decode operationRef: %v (%q)", err, result.OperationRef)
	}
	record, ok := value["profile"].(map[string]any)
	if !ok {
		t.Fatalf("profile missing in payload %#v", value)
	}
	return record
}

func errorCode(t *testing.T, result command.Result) string {
	t.Helper()
	if result.Error == nil {
		t.Fatalf("expected rejection, got outcome %s payload %q", result.Outcome, result.OperationRef)
	}
	return result.Error.ErrorCode
}

// Upsert 必须有 UPSERT 语义：同一账户改名不产生第二行，且老的 handle 释放。
func TestUpsertUserProfileIsUpsertAndFreesOldHandle(t *testing.T) {
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	svc, _ := testService(now)

	first := profileRecord(t, svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_a", map[string]any{
		"name": "Linh", "handle": "linh", "bio": "hello", "city": "HCM", "avatarUrl": "media/a.png",
	})))
	if first["userAccountId"] != "user_a" || first["handle"] != "linh" {
		t.Fatalf("unexpected stored profile %#v", first)
	}
	createdAt := first["createdAt"]

	// 同一账户换 handle：仍是同一条记录，createdAt 不变。
	renamed := profileRecord(t, svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_a", map[string]any{
		"name": "Linh", "handle": "linh2",
	})))
	if renamed["handle"] != "linh2" {
		t.Fatalf("expected rename to linh2, got %#v", renamed["handle"])
	}
	if renamed["createdAt"] != createdAt {
		t.Fatalf("createdAt must be preserved on upsert: %v -> %v", createdAt, renamed["createdAt"])
	}

	// 老 handle 必须被释放，别人可以接手。
	if freed := svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_b", map[string]any{
		"name": "B", "handle": "linh",
	})); freed.Outcome != "ACCEPTED" {
		t.Fatalf("freed handle must be claimable by another user, got %s (%v)", freed.Outcome, freed.Error)
	}

	// 现在的 handle 属于 user_a，user_b 再抢必须被拒。
	got := svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_c", map[string]any{
		"name": "C", "handle": "linh2",
	}))
	if code := errorCode(t, got); code != "PROFILE_HANDLE_TAKEN" {
		t.Fatalf("expected PROFILE_HANDLE_TAKEN, got %s", code)
	}

	// 原账户自己的记录必须还在。
	read := profileRecord(t, svc.HandleContext(t.Context(), envelopeFor("GetUserProfile", "USER", "user_a", map[string]any{
		"userAccountId": "user_a",
	})))
	if read["handle"] != "linh2" || read["name"] != "Linh" {
		t.Fatalf("read back mismatch: %#v", read)
	}
}

// 输入归一化：去空白 + 剥 @ 前缀（mobile 展示时再补回）。
func TestUpsertUserProfileNormalizesInput(t *testing.T) {
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	svc, _ := testService(now)

	record := profileRecord(t, svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_trim", map[string]any{
		"name": "  Linh  ", "handle": " @linh ", "bio": " hi ", "city": " HCM ", "avatarUrl": " media/a.png ",
	})))
	if record["name"] != "Linh" || record["handle"] != "linh" || record["bio"] != "hi" ||
		record["city"] != "HCM" || record["avatarUrl"] != "media/a.png" {
		t.Fatalf("normalization failed: %#v", record)
	}
	if record["createdAt"] != "2026-09-11T10:00:00Z" || record["updatedAt"] != "2026-09-11T10:00:00Z" {
		t.Fatalf("clock not honoured: %#v", record)
	}

	// GetByHandle 接受带 @ 的输入，解析到同一账户。
	byHandle := profileRecord(t, svc.HandleContext(t.Context(), envelopeFor("GetUserProfile", "USER", "user_other", map[string]any{
		"handle": "@linh",
	})))
	if byHandle["userAccountId"] != "user_trim" {
		t.Fatalf("handle lookup mismatch: %#v", byHandle)
	}
}

// 长度/必填校验与 mobile profile-store 的 MAX_* 一致（name≤60 handle≤60 bio≤280 city≤60）。
func TestUpsertUserProfileValidation(t *testing.T) {
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	svc, _ := testService(now)

	cases := []struct {
		name    string
		payload map[string]any
	}{
		{"empty name", map[string]any{"name": "   ", "handle": "ok"}},
		{"empty handle", map[string]any{"name": "ok", "handle": "  "}},
		{"name over 60 runes", map[string]any{"name": strings.Repeat("名", 61), "handle": "ok"}},
		{"handle over 60 runes", map[string]any{"name": "ok", "handle": strings.Repeat("h", 61)}},
		{"bio over 280 runes", map[string]any{"name": "ok", "handle": "ok", "bio": strings.Repeat("字", 281)}},
		{"city over 60 runes", map[string]any{"name": "ok", "handle": "ok", "city": strings.Repeat("城", 61)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_valid", tc.payload))
			if code := errorCode(t, got); code != "INVALID_USER_PROFILE" {
				t.Fatalf("expected INVALID_USER_PROFILE, got %s", code)
			}
		})
	}

	// 边界值必须通过：60 / 60 / 280 / 60。
	ok := svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "USER", "user_edge", map[string]any{
		"name": strings.Repeat("名", 60), "handle": strings.Repeat("h", 60),
		"bio": strings.Repeat("字", 280), "city": strings.Repeat("城", 60),
	}))
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("boundary values must be accepted, got %s (%v)", ok.Outcome, ok.Error)
	}
}

// 只有本人才写自己的名片：actor 必须是 USER。
func TestUpsertUserProfileRejectsNonUserActor(t *testing.T) {
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	svc, _ := testService(now)

	got := svc.HandleContext(t.Context(), envelopeFor("UpsertUserProfile", "AI", "agent_x", map[string]any{
		"name": "Bot", "handle": "bot",
	}))
	if code := errorCode(t, got); code != "PROFILE_NOT_OWNED" {
		t.Fatalf("expected PROFILE_NOT_OWNED, got %s", code)
	}
}

// 读路径：既没有 id 也没有 handle 一律拒；未知目标 → USER_PROFILE_NOT_FOUND。
func TestGetUserProfileLookupGuards(t *testing.T) {
	now := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	svc, _ := testService(now)

	if code := errorCode(t, svc.HandleContext(t.Context(), envelopeFor("GetUserProfile", "USER", "user_a", map[string]any{}))); code != "INVALID_PROFILE_LOOKUP" {
		t.Fatalf("expected INVALID_PROFILE_LOOKUP, got %s", code)
	}
	missingID := svc.HandleContext(t.Context(), envelopeFor("GetUserProfile", "USER", "user_a", map[string]any{"userAccountId": "user_missing"}))
	if code := errorCode(t, missingID); code != "USER_PROFILE_NOT_FOUND" {
		t.Fatalf("expected USER_PROFILE_NOT_FOUND, got %s", code)
	}
	missingHandle := svc.HandleContext(t.Context(), envelopeFor("GetUserProfile", "USER", "user_a", map[string]any{"handle": "@nobody"}))
	if code := errorCode(t, missingHandle); code != "USER_PROFILE_NOT_FOUND" {
		t.Fatalf("expected USER_PROFILE_NOT_FOUND, got %s", code)
	}
}

// 未注册的命令必须显式拒绝，而不是静默 501（域能力边界的自证）。
func TestSupportsProfileCommandsOnly(t *testing.T) {
	svc := New()
	for _, kind := range []string{"UpsertUserProfile", "GetUserProfile", "GetUserProfileRaw", "CreateSocialConnection"} {
		want := kind == "UpsertUserProfile" || kind == "GetUserProfile"
		if got := svc.Supports(kind); got != want {
			t.Fatalf("Supports(%q) = %v, want %v", kind, got, want)
		}
	}
}
