package payment

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(cmd, target string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_test_1", CommandType: cmd, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "user_001"}, Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target: command.Target{Type: "Payment", ID: target}, IdempotencyKey: "test_key_123456",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_1", RequestedAt: "2026-08-16T00:00:00Z", Payload: payload,
	}
}

func TestCreatePaymentIntentBalanced(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("CreatePaymentIntent", "order_1", map[string]any{"orderId": "order_1", "agentId": "agent_1", "amountMinor": int64(1200000)}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s %+v", r.Outcome, r.Error)
	}
	ledger, _ := s.repo.ListLedger(nil, "order_1")
	if len(ledger) != 2 {
		t.Fatalf("ledger len %d", len(ledger))
	}
	var debit, credit int64
	for _, e := range ledger {
		if e.EntryType == "DEBIT_REQUESTER" {
			debit += e.AmountMinor
		}
		if e.EntryType == "CREDIT_HOLD" {
			credit += e.AmountMinor
		}
	}
	if debit != credit || debit != 1200000 {
		t.Fatalf("unbalanced %d %d", debit, credit)
	}
}

func TestConfirmDedupeAndAmountMismatch(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("CreatePaymentIntent", "order_1", map[string]any{"orderId": "order_1", "agentId": "agent_1", "amountMinor": int64(1000)}))
	var piID string
	// get intent id from repo
	intents := s.repo.(*MemoryRepository).intents
	for id := range intents {
		piID = id
		break
	}
	if piID == "" {
		t.Fatal("no intent")
	}
	// duplicate callback -> dedupe returns ALREADY_PROCESSED (here we return ACCEPTED with ALREADY_PROCESSED)
	r2 := s.Handle(envelopeFor("ConfirmPaymentIntent", piID, map[string]any{"paymentIntentId": piID, "providerEventId": "evt_1", "status": "SUCCEEDED"}))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("first confirm: %s", r2.Outcome)
	}
	r3 := s.Handle(envelopeFor("ConfirmPaymentIntent", piID, map[string]any{"paymentIntentId": piID, "providerEventId": "evt_1", "status": "SUCCEEDED"}))
	if r3.Outcome != "ACCEPTED" || r3.Aggregate.State != "ALREADY_PROCESSED" {
		t.Fatalf("dedupe: %s %+v", r3.Outcome, r3.Aggregate)
	}
	_ = r
	// amount mismatch
	r4 := s.Handle(envelopeFor("ConfirmPaymentIntent", piID, map[string]any{"paymentIntentId": piID, "providerEventId": "evt_2", "amountMinor": int64(999), "status": "SUCCEEDED"}))
	if r4.Outcome != "REJECTED" || r4.Error.ErrorCode != "AMOUNT_MISMATCH" {
		t.Fatalf("amount mismatch: %s %+v", r4.Outcome, r4.Error)
	}
	// unknown timeout -> PENDING (need a PENDING intent)
	pendingID := "pi_pending"
	_ = s.repo.CreateIntent(nil, PaymentIntent{ID: pendingID, OrderID: "order_pending", RequesterID: "user_001", AgentID: "agent_1", AmountMinor: 1000, Currency: "VND", Status: "PENDING"})
	r5 := s.Handle(envelopeFor("ConfirmPaymentIntent", pendingID, map[string]any{"paymentIntentId": pendingID, "providerEventId": "evt_3", "status": "UNKNOWN"}))
	if r5.Outcome != "PENDING" {
		t.Fatalf("unknown: %s %+v", r5.Outcome, r5.Error)
	}
}

func TestUnbalancedLedgerImpossible(t *testing.T) {
	entries := []LedgerEntry{
		{ID: "1", OrderID: "o1", EntryType: "DEBIT_REQUESTER", AmountMinor: 1000, Currency: "VND"},
		{ID: "2", OrderID: "o1", EntryType: "CREDIT_HOLD", AmountMinor: 999, Currency: "VND"},
	}
	if isBalanced(entries) {
		t.Fatal("should be unbalanced")
	}
	entries2 := []LedgerEntry{
		{ID: "1", OrderID: "o1", EntryType: "DEBIT_REQUESTER", AmountMinor: 1000, Currency: "VND"},
		{ID: "2", OrderID: "o1", EntryType: "CREDIT_HOLD", AmountMinor: 1000, Currency: "VND"},
	}
	if !isBalanced(entries2) {
		t.Fatal("should be balanced")
	}
}
