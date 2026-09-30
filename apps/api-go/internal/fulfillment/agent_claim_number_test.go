package fulfillment

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// ORDER-AGENT-CLAIM-NO-001：接单编号（技师号）必须随订单快照冻结。
//
// 用户原话：「我的订单 每个订单记录recipe没有匹配的用户接单编号 必须要有 因为只要去
// 线下接单赚钱 必须有一个唯一的接单编号」。关键点是「线下」：agent_id 是 usr_xxx 内部
// 主键，电话里报不出、对不上号；技师号（identity.agent_claim_numbers，注册时顺序分配、
// 1 起无跳号）才是核销和对账真正要用的那个号。所以它必须**冻结进订单**，而不是让
// 客户端每次去 profile 现查 —— 现查拿到的是「现在」的号，事后对不上「当时是谁接的单」。
//
// 覆盖：三条下单路径都冻结（报价建单 / 接档位 / 接主题邀约）+ 读回来还在 +
// 条款变更不许改它 + 查不到编号时不挡下单（fail-open）。

// stubClaimNumbers 是一个可控的接单编号查询器。
type stubClaimNumbers struct {
	numbers map[string]int
	err     error
	calls   int
}

func (s *stubClaimNumbers) AgentClaimNumber(_ context.Context, userID string) (int, error) {
	s.calls++
	if s.err != nil {
		return 0, s.err
	}
	return s.numbers[userID], nil
}

func TestOrderSnapshotFreezesAgentClaimNumber(t *testing.T) {
	s := New()
	ctx := context.Background()
	reader := &stubClaimNumbers{numbers: map[string]int{
		"agent_linh":        7,
		"agent_topic_no":    42,
		"agent_materialize": 128,
	}}
	s.WithAgentClaimNumbers(reader)

	// 路径 1：报价直接建单（CreateOffer）。
	r := s.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
	var created struct {
		OrderID string `json:"orderId"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &created); err != nil {
		t.Fatal(err)
	}
	order, err := s.repository.GetOrder(ctx, created.OrderID)
	if err != nil {
		t.Fatal(err)
	}
	if order.Snapshot.AgentClaimNumber != 7 {
		t.Fatalf("报价建单必须冻结接单编号 7，got %d", order.Snapshot.AgentClaimNumber)
	}

	// 路径 2：接档位（AcceptSlotOffer）—— 接单那一刻才冻结，不是报价创建时。
	offerID := createSlotOffer(t, s, "task_claim", "slot_claim", "agent_slot")
	accepted := s.Handle(asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": offerID}, ""), "agent_slot"))
	slotOrder, err := s.repository.GetOrder(ctx, accepted.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if slotOrder.Snapshot.AgentClaimNumber != 0 {
		t.Fatalf("agent_slot 没有分配编号（查询器返 0），快照必须是 0 而不是编一个，got %d", slotOrder.Snapshot.AgentClaimNumber)
	}

	// 路径 3：接主题邀约（RespondTopicInvite）。
	invite := s.Handle(envelopeFor("CreateTopicInvite", map[string]any{"agentId": "agent_topic_no", "topicKey": "coffee"}, ""))
	var inviteView struct {
		OfferID string `json:"offerId"`
	}
	_ = json.Unmarshal([]byte(invite.OperationRef), &inviteView)
	topic := s.Handle(asActor(envelopeFor("RespondTopicInvite", map[string]any{"offerId": inviteView.OfferID, "accept": true}, ""), "agent_topic_no"))
	topicOrder, err := s.repository.GetOrder(ctx, topic.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if topicOrder.Snapshot.AgentClaimNumber != 42 {
		t.Fatalf("接主题邀约必须冻结接单编号 42，got %d", topicOrder.Snapshot.AgentClaimNumber)
	}
}

// 编号读回来必须还在，且**条款变更不许改它** —— 它是「当时是谁接的单」的凭证。
func TestAgentClaimNumberSurvivesReadAndAmendments(t *testing.T) {
	s := New()
	ctx := context.Background()
	s.WithAgentClaimNumbers(&stubClaimNumbers{numbers: map[string]int{"agent_linh": 7}})

	orderID := createOffer(t, s)
	confirmAsAgent(s, orderID)

	// 走一次完整条款变更（提出 + 对方接受），确认编号在**被接受的变更**后依然不变 ——
	// 快照整体被换掉是最容易把编号弄丢的路径。
	r, amendmentID := proposeChange(s, "user_001", orderID, map[string]any{"duration": "4H"})
	if r.Outcome != "ACCEPTED" || amendmentID == "" {
		t.Fatalf("propose: %s %+v", r.Outcome, r.Error)
	}
	if accepted := respondChange(s, "agent_linh", orderID, amendmentID, "ACCEPT"); accepted.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", accepted.Error)
	}

	after, err := s.repository.GetOrder(ctx, orderID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Snapshot.Duration != "4H" {
		t.Fatalf("条款变更本身必须生效（否则这个测试是空转），got %q", after.Snapshot.Duration)
	}
	if after.Snapshot.AgentClaimNumber != 7 {
		t.Fatalf("条款变更后接单编号必须还是 7（写入后不变），got %d", after.Snapshot.AgentClaimNumber)
	}
}

// 查不到编号 / 查询器故障 / 没接查询器，**都不能挡下单** —— 编号是核销凭证，不是成交
// 前提。客户端按「未分配」隐藏那一行即可。用户：「不接单 接单编号暂时隐藏」。
func TestMissingAgentClaimNumberNeverBlocksOrder(t *testing.T) {
	cases := []struct {
		name   string
		reader AgentClaimNumberReader
	}{
		{"没接查询器", nil},
		{"查询器故障", &stubClaimNumbers{err: errors.New("db down")}},
		{"返回 0（未分配）", &stubClaimNumbers{numbers: map[string]int{}}},
		{"返回越界值", &stubClaimNumbers{numbers: map[string]int{"agent_no": 99999999}}},
		{"返回负数", &stubClaimNumbers{numbers: map[string]int{"agent_no": -3}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := New()
			ctx := context.Background()
			if tc.reader != nil {
				s.WithAgentClaimNumbers(tc.reader)
			}
			r := s.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
			var created struct {
				OrderID string `json:"orderId"`
			}
			if err := json.Unmarshal([]byte(r.OperationRef), &created); err != nil {
				t.Fatalf("下单不能因为拿不到接单编号而失败: %+v", r)
			}
			if created.OrderID == "" {
				t.Fatalf("下单必须成功，got %+v", r)
			}
			order, err := s.repository.GetOrder(ctx, created.OrderID)
			if err != nil {
				t.Fatal(err)
			}
			// 0 = 未分配，客户端隐藏整行；**绝不能**是编出来的号。
			if order.Snapshot.AgentClaimNumber != 0 {
				t.Fatalf("拿不到编号时必须是 0（未分配），got %d", order.Snapshot.AgentClaimNumber)
			}
			if order.OrderNo == "" {
				t.Fatal("订单编号仍必须正常分配（接单编号缺失不影响它）")
			}
		})
	}
}
