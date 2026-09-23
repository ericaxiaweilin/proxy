package twininsight

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TWIN-INSIGHT-002 写侧测试。
//
// 这里钉的是三道 fail-closed 闸门：
//   1. 没接审计 → 拒绝（不留"点了按钮没留痕"的口子）；
//   2. 没接未成年人门禁 → 拒绝（COMP-AI-MINOR-001）；
//   3. 目标不是自己的活跃好友 → 拒绝（不能往任意账号身上写）。
// 以及一个正向：过了闸就真的落一行，且字段完整可审计。

func newOperateFixture() (*Service, *MemoryFriendSource, *MemoryActionLog) {
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "friend_1", DisplayName: "Linh", Since: time.Now().Add(-30 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	log := NewMemoryActionLog()
	svc.SetActionLog(log)
	// 门禁默认放行，让每条用例自己决定要不要放行。
	svc.SetCompanionGate(func(context.Context, string) error { return nil })
	return svc, friends, log
}

func TestRecordOperateFailsClosedWithoutActionLog(t *testing.T) {
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	// 故意不 SetActionLog / SetCompanionGate。
	if _, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "friend_1", ActionOperate); err == nil {
		t.Fatal("RecordOperate must refuse when the audit log is not wired")
	}
}

func TestRecordOperateFailsClosedWithoutCompanionGate(t *testing.T) {
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetActionLog(NewMemoryActionLog())
	// 只接审计、不接门禁 → 必须拒绝（宁可关动作，不对未成年人开放）。
	_, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "friend_1", ActionOperate)
	if !errors.Is(err, ErrCompanionGateUnavailable) {
		t.Fatalf("want ErrCompanionGateUnavailable, got %v", err)
	}
}

func TestRecordOperateRejectsUnknownAction(t *testing.T) {
	svc, _, log := newOperateFixture()
	if _, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "friend_1", "delete_everything"); !errors.Is(err, ErrActionInvalid) {
		t.Fatalf("want ErrActionInvalid, got %v", err)
	}
	if len(log.All()) != 0 {
		t.Errorf("a rejected action must not be recorded, got %d rows", len(log.All()))
	}
}

func TestRecordOperateRejectsNonFriendTarget(t *testing.T) {
	svc, _, log := newOperateFixture()
	// stranger 不是 owner_1 的好友 —— 不加这条，任何人可以对任意账号开运营，
	// 审计表会变成一张可以随便往别人身上写的表。
	_, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "stranger_9", ActionOperate)
	if !errors.Is(err, ErrTargetNotAFriend) {
		t.Fatalf("want ErrTargetNotAFriend, got %v", err)
	}
	if len(log.All()) != 0 {
		t.Errorf("a rejected action must not be recorded, got %d rows", len(log.All()))
	}
}

func TestRecordOperatePropagatesCompanionGateRefusal(t *testing.T) {
	svc, _, log := newOperateFixture()
	gateErr := errors.New("minor forbidden")
	svc.SetCompanionGate(func(context.Context, string) error { return gateErr })
	_, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "friend_1", ActionOperate)
	if !errors.Is(err, gateErr) {
		t.Fatalf("gate refusal must propagate unchanged, got %v", err)
	}
	if len(log.All()) != 0 {
		t.Errorf("a gate-rejected action must not be recorded, got %d rows", len(log.All()))
	}
}

func TestRecordOperateWritesAuditableRow(t *testing.T) {
	svc, _, log := newOperateFixture()
	result, err := svc.RecordOperate(context.Background(), "twin_1", "owner_1", "friend_1", ActionObserve)
	if err != nil {
		t.Fatalf("RecordOperate: %v", err)
	}
	if result.TargetID != "friend_1" || result.Action != ActionObserve {
		t.Errorf("result mismatch: %+v", result)
	}
	if result.ActedAt == "" {
		t.Error("actedAt must never be empty (contract min 1)")
	}
	rows := log.All()
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	row := rows[0]
	// 审计必须能回答：谁 / 何时 / 对谁 / 什么动作 / 哪个分身。
	if row.OwnerID != "owner_1" {
		t.Errorf("audit owner = %q, want owner_1", row.OwnerID)
	}
	if row.TargetID != "friend_1" {
		t.Errorf("audit target = %q, want friend_1", row.TargetID)
	}
	if row.TwinID != "twin_1" {
		t.Errorf("audit twin = %q, want twin_1", row.TwinID)
	}
	if row.Action != ActionObserve {
		t.Errorf("audit action = %q, want observe", row.Action)
	}
	if row.ActedAt.IsZero() {
		t.Error("audit actedAt must be set")
	}
	if row.ID == "" {
		t.Error("audit row must have an id")
	}
}

func TestGetInsightRejectsNonFriend(t *testing.T) {
	svc, _, _ := newOperateFixture()
	if _, err := svc.GetInsight(context.Background(), "twin_1", "owner_1", "stranger_9"); !errors.Is(err, ErrTargetNotAFriend) {
		t.Fatalf("want ErrTargetNotAFriend, got %v", err)
	}
}

func TestGetInsightReturnsFriendWithZeroSignal(t *testing.T) {
	svc, _, _ := newOperateFixture()
	insight, err := svc.GetInsight(context.Background(), "twin_1", "owner_1", "friend_1")
	if err != nil {
		t.Fatalf("GetInsight: %v", err)
	}
	if insight.TargetID != "friend_1" {
		t.Errorf("target = %q, want friend_1", insight.TargetID)
	}
	if insight.Score != 0 {
		t.Errorf("no facts must mean score 0, got %d", insight.Score)
	}
}
