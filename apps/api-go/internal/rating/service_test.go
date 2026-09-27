package rating

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

func seedOrder(t *testing.T, orders *fulfillment.MemoryRepository, id, agentID, requesterID, lifecycle string) {
	t.Helper()
	if err := orders.CreateOrder(context.Background(), fulfillment.Order{
		ID: id, AgentID: agentID, RequesterID: requesterID, Lifecycle: lifecycle,
		Version: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("seedOrder: %v", err)
	}
}

func TestSubmitRatingRequiresTheProviderNotTheClient(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	seedOrder(t, orders, "order_1", "agent_1", "client_1", "COMPLETED")
	svc := New(NewMemoryRepository(), orders)

	// The client (requester) tries to rate — must be rejected; only the
	// provider (agent) rates the client, mirroring recordSatisfaction's
	// opposite-direction check.
	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitRating",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "client_1"},
		Payload:     map[string]any{"orderId": "order_1", "stars": 5},
	})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "ONLY_PROVIDER_RATES" {
		t.Fatalf("expected ONLY_PROVIDER_RATES, got %s: %+v", result.Outcome, result.Error)
	}

	// The provider (agent) rating succeeds.
	ok := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitRating",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
		Payload:     map[string]any{"orderId": "order_1", "stars": 5},
	})
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED for the real provider, got %s: %+v", ok.Outcome, ok.Error)
	}
}

func TestSubmitRatingRequiresACompletedOrder(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	seedOrder(t, orders, "order_1", "agent_1", "client_1", "EXECUTING")
	svc := New(NewMemoryRepository(), orders)

	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitRating",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
		Payload:     map[string]any{"orderId": "order_1", "stars": 5},
	})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "ORDER_NOT_COMPLETED" {
		t.Fatalf("expected ORDER_NOT_COMPLETED, got %s: %+v", result.Outcome, result.Error)
	}
}

func TestSubmitRatingValidatesStarRange(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	seedOrder(t, orders, "order_1", "agent_1", "client_1", "COMPLETED")
	svc := New(NewMemoryRepository(), orders)

	for _, stars := range []int{0, 6, -1} {
		result := svc.HandleContext(context.Background(), command.Envelope{
			CommandType: "SubmitRating",
			Actor:       command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
			Payload:     map[string]any{"orderId": "order_1", "stars": stars},
		})
		if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "INVALID_STARS" {
			t.Fatalf("stars=%d: expected INVALID_STARS, got %s: %+v", stars, result.Outcome, result.Error)
		}
	}
}

func TestSubmitRatingOnTheSameOrderOverwritesNotStacks(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	seedOrder(t, orders, "order_1", "agent_1", "client_1", "COMPLETED")
	repo := NewMemoryRepository()
	svc := New(repo, orders)
	ctx := context.Background()

	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitRating", Actor: command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
		Payload: map[string]any{"orderId": "order_1", "stars": 2},
	})
	svc.HandleContext(ctx, command.Envelope{
		CommandType: "SubmitRating", Actor: command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
		Payload: map[string]any{"orderId": "order_1", "stars": 5},
	})

	avg, count, err := svc.GetUserRatingAggregate(ctx, "client_1")
	if err != nil {
		t.Fatalf("GetUserRatingAggregate: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected the re-rate to overwrite (count=1), got count=%d", count)
	}
	if avg != 5 {
		t.Fatalf("expected the overwritten value (5), got avg=%v", avg)
	}
}

func TestGetUserRatingAggregateReturnsZeroCountNotAFakeDefault(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	svc := New(NewMemoryRepository(), orders)

	// MARKET-FAKE-JUDGMENT-001: nobody has ever rated this user. The
	// aggregate must say "0 ratings", never a fabricated average.
	avg, count, err := svc.GetUserRatingAggregate(context.Background(), "nobody_rated")
	if err != nil {
		t.Fatalf("GetUserRatingAggregate: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected count=0 for an unrated user, got %d", count)
	}
	if avg != 0 {
		t.Fatalf("expected avg=0 (caller must treat count==0 as no-data, not read avg), got %v", avg)
	}
}

func TestSubmitRatingRejectsUnknownOrder(t *testing.T) {
	orders := fulfillment.NewMemoryRepository()
	svc := New(NewMemoryRepository(), orders)

	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SubmitRating",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
		Payload:     map[string]any{"orderId": "no_such_order", "stars": 5},
	})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "ORDER_NOT_FOUND" {
		t.Fatalf("expected ORDER_NOT_FOUND, got %s: %+v", result.Outcome, result.Error)
	}
}

func TestSupportsAndUnknownCommandRejection(t *testing.T) {
	svc := NewWithClock(NewMemoryRepository(), fulfillment.NewMemoryRepository(), clock.NewFixed(time.Now()))
	if !svc.Supports("SubmitRating") {
		t.Fatal("expected SubmitRating to be supported")
	}
	if svc.Supports("SomethingElse") {
		t.Fatal("expected an unknown command type to be unsupported")
	}
	result := svc.HandleContext(context.Background(), command.Envelope{CommandType: "SomethingElse"})
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for an unsupported command, got %s", result.Outcome)
	}
}
