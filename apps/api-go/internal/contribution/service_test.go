package contribution

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "principal_a"},
		Target:         command.Target{Type: "NetworkContribution", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

// 完整链路：提交 → 三层审核 → QUALIFIED → ACTIVATED → VALUE_CREATED → REWARDED。
func TestContributionLifecycle(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("SubmitContribution", map[string]any{
		"contributionType":  "MERCHANT_REFERRAL",
		"targetType":        "MERCHANT",
		"targetId":          "merchant_1",
		"targetPrincipalId": "principal_b",
	}, ""))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "SUBMITTED" {
		t.Fatalf("submit: %s/%s (%+v)", r.Outcome, r.Aggregate.State, r.Error)
	}
	var view struct {
		ContributionID string `json:"contributionId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	id := view.ContributionID

	// 三层审核（顺序任意，各自独立；第三次全过 → QUALIFIED）
	reviews := []string{"ReviewContributionAccess", "ReviewContributionDomain", "ReviewRewardGate"}
	for _, rev := range reviews {
		r = s.Handle(envelopeFor(rev, map[string]any{"decision": "APPROVE", "reason": "ok"}, id))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("%s: %s (%+v)", rev, r.Outcome, r.Error)
		}
	}
	// 三层全过 → QUALIFIED
	if r.Aggregate.State != "QUALIFIED" {
		t.Fatalf("want QUALIFIED, got %s", r.Aggregate.State)
	}

	// ACTIVATED
	r = s.Handle(envelopeFor("ActivateContribution", map[string]any{}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "ACTIVATED" {
		t.Fatalf("activate: %s/%s", r.Outcome, r.Aggregate.State)
	}

	// VALUE_CREATED（Verified Value Event）
	r = s.Handle(envelopeFor("RecordContributionValue", map[string]any{
		"valueType": "FIRST_ORDER", "orderId": "ord_1", "amountVnd": 1200000,
	}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "VALUE_CREATED" {
		t.Fatalf("value: %s/%s", r.Outcome, r.Aggregate.State)
	}

	// REWARDED
	r = s.Handle(envelopeFor("GrantContributionReward", map[string]any{"amountVnd": 50000}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "REWARDED" {
		t.Fatalf("reward: %s/%s (%+v)", r.Outcome, r.Aggregate.State, r.Error)
	}
	var rewardView struct {
		RewardVND int64 `json:"rewardVnd"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &rewardView)
	if rewardView.RewardVND != 50000 {
		t.Fatalf("reward amount wrong: %d", rewardView.RewardVND)
	}
}

// 防 self-referral：被推荐人 = 贡献者 → 拒绝。
func TestSelfReferralRejected(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("SubmitContribution", map[string]any{
		"contributionType":  "AGENT_REFERRAL",
		"targetType":        "AGENT",
		"targetId":          "agent_1",
		"targetPrincipalId": "principal_a", // 与贡献者相同！
	}, ""))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SELF_REFERRAL_NOT_ALLOWED" {
		t.Fatalf("want SELF_REFERRAL, got %s/%+v", r.Outcome, r.Error)
	}
}

// 防 duplicate target：同一目标重复提交 → 拒绝。
func TestDuplicateTargetRejected(t *testing.T) {
	s := New()
	payload := map[string]any{
		"contributionType":  "MERCHANT_REFERRAL",
		"targetType":        "MERCHANT",
		"targetId":          "merchant_9",
		"targetPrincipalId": "principal_b",
	}
	r := s.Handle(envelopeFor("SubmitContribution", payload, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("first submit: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("SubmitContribution", payload, ""))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "DUPLICATE_CONTRIBUTION_TARGET" {
		t.Fatalf("want DUPLICATE, got %s/%+v", r.Outcome, r.Error)
	}
}

// 三层审核分离：任一 REJECT → REJECTED，不是 approved=true 单点。
func TestReviewLayersAreSeparate(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("SubmitContribution", map[string]any{
		"contributionType":  "DRIVER_REFERRAL",
		"targetType":        "DRIVER",
		"targetId":          "driver_1",
		"targetPrincipalId": "principal_b",
	}, ""))
	var view struct {
		ContributionID string `json:"contributionId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	id := view.ContributionID

	// Access PASS + Domain REJECT
	r = s.Handle(envelopeFor("ReviewContributionAccess", map[string]any{"decision": "APPROVE"}, id))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("access: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("ReviewContributionDomain", map[string]any{"decision": "REJECT", "reason": "driver not qualified"}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "REJECTED" {
		t.Fatalf("domain reject: %s/%s", r.Outcome, r.Aggregate.State)
	}
	// 验证 reject_reason
	c, _ := s.repository.GetContribution(nil, id)
	if c.ReviewAccess != "PASSED" || c.ReviewDomain != "FAILED" {
		t.Fatalf("layers must be independent: access=%s domain=%s", c.ReviewAccess, c.ReviewDomain)
	}
}

// Reward Gate：未通过不能发奖。
func TestRewardGateBlocksReward(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("SubmitContribution", map[string]any{
		"contributionType":  "REQUESTER_REFERRAL",
		"targetType":        "REQUESTER",
		"targetId":          "requester_1",
		"targetPrincipalId": "principal_b",
	}, ""))
	var view struct {
		ContributionID string `json:"contributionId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	id := view.ContributionID
	// 只过 Access+Domain，RewardGate 仍 PENDING（state=UNDER_REVIEW）
	for _, rev := range []string{"ReviewContributionAccess", "ReviewContributionDomain"} {
		s.Handle(envelopeFor(rev, map[string]any{"decision": "APPROVE"}, id))
	}
	// 手动推进到 VALUE_CREATED（跳过正常链，模拟值已产生但 Reward Gate 未审）
	c, _ := s.repository.GetContribution(nil, id)
	c.State = "VALUE_CREATED"
	_ = s.repository.UpdateContribution(nil, c, "UNDER_REVIEW")
	// 发奖 → 被 Reward Gate 拦
	r = s.Handle(envelopeFor("GrantContributionReward", map[string]any{"amountVnd": 10000}, id))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "REWARD_GATE_NOT_PASSED" {
		t.Fatalf("want REWARD_GATE_BLOCKED, got %s/%+v", r.Outcome, r.Error)
	}
}

// 状态只能由服务端推进：客户端不能直接置成功（无命令支持跳过状态）。
func TestNoClientForceSuccess(t *testing.T) {
	s := New()
	// 没有 SetState / ForceSuccess 命令
	if s.Supports("ForceContributionSuccess") {
		t.Fatal("must not expose force-success command")
	}
}
