package command

import (
	"context"
	"sync"
	"testing"
)

func TestMemoryIdempotencyClaimsOnlyOnce(t *testing.T) {
	store := NewMemoryIdempotencyStore()
	ctx := context.Background()

	claimed, _, err := store.Begin(ctx, "USER:user_001|INDIVIDUAL:user_001", "idem_001", "fingerprint_001")
	if err != nil || claimed != IdempotencyClaimed {
		t.Fatalf("expected first request to claim, got %s %v", claimed, err)
	}

	inProgress, _, err := store.Begin(ctx, "USER:user_001|INDIVIDUAL:user_001", "idem_001", "fingerprint_001")
	if err != nil || inProgress != IdempotencyInProgress {
		t.Fatalf("expected concurrent request to remain in progress, got %s %v", inProgress, err)
	}

	result := Result{CommandID: "cmd_001", Outcome: "ACCEPTED", EventRefs: []string{}, CorrelationID: "corr_001"}
	if err := store.Complete(ctx, "USER:user_001|INDIVIDUAL:user_001", "idem_001", IdempotencyRecord{Fingerprint: "fingerprint_001", Result: result}); err != nil {
		t.Fatal(err)
	}

	replayed, record, err := store.Begin(ctx, "USER:user_001|INDIVIDUAL:user_001", "idem_001", "fingerprint_001")
	if err != nil || replayed != IdempotencyReplay || record == nil || record.Result.CommandID != "cmd_001" {
		t.Fatalf("expected completed request to replay, got %s %#v %v", replayed, record, err)
	}

	conflict, _, err := store.Begin(ctx, "USER:user_001|INDIVIDUAL:user_001", "idem_001", "fingerprint_002")
	if err != nil || conflict != IdempotencyConflict {
		t.Fatalf("expected fingerprint conflict, got %s %v", conflict, err)
	}
}

func TestMemoryIdempotencyConcurrentClaim(t *testing.T) {
	store := NewMemoryIdempotencyStore()
	const workers = 32
	decisions := make(chan IdempotencyDecision, workers)
	var wait sync.WaitGroup
	for i := 0; i < workers; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			decision, _, err := store.Begin(context.Background(), "scope", "idem_concurrent", "same_fingerprint")
			if err != nil {
				t.Errorf("begin failed: %v", err)
				return
			}
			decisions <- decision
		}()
	}
	wait.Wait()
	close(decisions)

	claimed := 0
	for decision := range decisions {
		if decision == IdempotencyClaimed {
			claimed++
		}
	}
	if claimed != 1 {
		t.Fatalf("expected exactly one claim, got %d", claimed)
	}
}
