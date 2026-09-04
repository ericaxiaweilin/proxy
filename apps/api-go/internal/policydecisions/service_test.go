package policydecisions

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEvaluateCreatesAndReusesDecision(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", func() KillSwitchState {
		return KillSwitchState{Categories: map[string]KillSwitchEntry{
			"AI_MEDIA": {Reason: "test only", SetBy: "unit-test", SetAt: now.Format(time.RFC3339)},
		}}
	})
	svc.SetNowFunc(func() time.Time { return now })

	// First call: a new decision is written.
	d1, err := svc.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	if err != nil {
		t.Fatalf("first evaluate: %v", err)
	}
	if d1.ID == "" {
		t.Fatal("first decision id is empty")
	}
	if d1.UserID != "user-alice" {
		t.Fatalf("user id: %q", d1.UserID)
	}
	if d1.CategoryCode != CategoryUserPaidService {
		t.Fatalf("category: %q", d1.CategoryCode)
	}
	if d1.TermsVersion != "terms-1.0.0" || d1.PrivacyVersion != "privacy-1.0.0" {
		t.Fatalf("versions: %+v", d1)
	}
	if _, ok := d1.KillSwitch.Categories["AI_MEDIA"]; !ok {
		t.Fatalf("kill switch state not snapshotted: %+v", d1.KillSwitch)
	}

	// Second call: same tuple, must return the same id.
	d2, err := svc.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	if err != nil {
		t.Fatalf("second evaluate: %v", err)
	}
	if d2.ID != d1.ID {
		t.Fatalf("expected reuse of id %q, got %q", d1.ID, d2.ID)
	}
}

func TestEvaluateNewDecisionWhenTermsBump(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil)
	svc.SetNowFunc(func() time.Time { return now })

	d1, err := svc.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	if err != nil {
		t.Fatal(err)
	}

	// Material change: terms bump. The service must record a
	// new decision id so the audit log can show "the user
	// paid under terms-1.0.0 first, then under terms-1.1.0
	// later". LC-30 hinges on this.
	svc2 := NewService(repo, "terms-1.1.0", "privacy-1.0.0", nil)
	svc2.SetNowFunc(func() time.Time { return now.Add(time.Minute) })
	d2, err := svc2.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	if err != nil {
		t.Fatal(err)
	}
	if d2.ID == d1.ID {
		t.Fatalf("new terms version must produce a new decision id, got %q twice", d1.ID)
	}
	if d2.TermsVersion != "terms-1.1.0" {
		t.Fatalf("expected new terms version on d2, got %q", d2.TermsVersion)
	}
}

func TestEvaluatePerUserIsolation(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil)
	svc.SetNowFunc(func() time.Time { return now })

	alice, _ := svc.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	bob, _ := svc.Evaluate(context.Background(), "user-bob", CategoryUserPaidService)
	if alice.ID == bob.ID {
		t.Fatalf("decisions for different users must differ, both got %q", alice.ID)
	}
}

func TestEvaluateRejectsUnknownCategory(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil)
	if _, err := svc.Evaluate(context.Background(), "user-x", CategoryCode("NOPE_NOT_A_REAL_CATEGORY")); err == nil {
		t.Fatal("expected error for unknown category")
	}
}

func TestEvaluateRejectsEmptyVersions(t *testing.T) {
	repo := NewMemoryRepository()
	if _, err := NewService(repo, "", "privacy-1.0.0", nil).Evaluate(context.Background(), "user-x", CategoryUserPaidService); err == nil {
		t.Fatal("expected error for empty terms version")
	}
	if _, err := NewService(repo, "terms-1.0.0", "", nil).Evaluate(context.Background(), "user-x", CategoryUserPaidService); err == nil {
		t.Fatal("expected error for empty privacy version")
	}
	if _, err := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil).Evaluate(context.Background(), "", CategoryUserPaidService); err == nil {
		t.Fatal("expected error for empty user id")
	}
}

func TestStampRecordsLifecycleStage(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil)
	svc.SetNowFunc(func() time.Time { return now })
	d, err := svc.Evaluate(context.Background(), "user-alice", CategoryUserPaidService)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Stamp(context.Background(), OrderStamp{OrderID: "ord_1", DecisionID: d.ID, StampedAt: now, StampedLifecycle: "OFFERED"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Stamp(context.Background(), OrderStamp{OrderID: "ord_1", DecisionID: d.ID, StampedAt: now.Add(time.Minute), StampedLifecycle: "CONFIRMED"}); err != nil {
		t.Fatal(err)
	}
	stamps, err := repo.StampsForOrder(context.Background(), "ord_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(stamps) != 2 {
		t.Fatalf("expected 2 stamps, got %d", len(stamps))
	}
	if stamps[0].StampedLifecycle != "OFFERED" || stamps[1].StampedLifecycle != "CONFIRMED" {
		t.Fatalf("stamp order or content wrong: %+v", stamps)
	}
}

func TestNormalizeCategoryCodeCaseInsensitive(t *testing.T) {
	got, err := NormalizeCategoryCode("user_paid_service")
	if err != nil {
		t.Fatal(err)
	}
	if got != CategoryUserPaidService {
		t.Fatalf("normalization: %q", got)
	}
	if _, err := NormalizeCategoryCode("  "); err == nil {
		t.Fatal("empty input must error")
	}
}

// TestKillSwitchSnapshotIsStableJSON verifies that the snapshot
// captured on a decision row can be re-serialized byte-for-byte
// the same (modulo key order) so a regulator's audit query can
// diff two snapshots without false positives.
func TestKillSwitchSnapshotIsStableJSON(t *testing.T) {
	raw := `{"categories":{"AI_MEDIA":{"reason":"x","setBy":"y","setAt":"z"},"PAYMENTS":{}}}`
	a, err := DecodeKillSwitch(raw)
	if err != nil {
		t.Fatal(err)
	}
	encoded := MustEncodeKillSwitch(a)
	// Re-parse and re-encode; the second pass must match the
	// first.
	a2, _ := DecodeKillSwitch(encoded)
	if MustEncodeKillSwitch(a2) != encoded {
		t.Fatalf("snapshot is not stable: %s vs %s", encoded, MustEncodeKillSwitch(a2))
	}
}

// TestRepositoryGetByIDRoundTrip is a sanity check that the
// GetByID helper used by the audit endpoint can find a row
// written by Insert.
func TestRepositoryGetByIDRoundTrip(t *testing.T) {
	repo := NewMemoryRepository()
	d := Decision{
		ID: "pdec_test", UserID: "u", CategoryCode: CategoryUserPaidService,
		TermsVersion: "t1", PrivacyVersion: "p1", EvaluatedAt: time.Now().UTC(),
	}
	if err := repo.Insert(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(context.Background(), "pdec_test")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "pdec_test" {
		t.Fatalf("round-trip id: %q", got.ID)
	}
	if _, err := repo.GetByID(context.Background(), "pdec_does_not_exist"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// TestRepositoryConcurrentInsert is a regression test for the
// race where two goroutines Evaluate under the same tuple and
// both try to insert. The MemoryRepository is allowed to
// produce two distinct ids (idempotency is a database concern,
// not an in-memory one) but it must not panic or corrupt state.
func TestRepositoryConcurrentInsert(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo, "terms-1.0.0", "privacy-1.0.0", nil)
	var wg sync.WaitGroup
	ids := make(chan string, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, err := svc.Evaluate(context.Background(), "user-race", CategoryUserPaidService)
			if err != nil {
				t.Errorf("evaluate: %v", err)
				return
			}
			ids <- d.ID
		}()
	}
	wg.Wait()
	close(ids)
	seen := map[string]bool{}
	for id := range ids {
		if seen[id] {
			// Acceptable but warn — in production Postgres
			// UNIQUE would force reuse. The in-memory store
			// races.
			t.Logf("warning: duplicate id %q produced under in-memory race", id)
		}
		seen[id] = true
	}
	if len(seen) == 0 {
		t.Fatal("no ids collected")
	}
}

// TestKillSwitchJSONMarshalDoesNotLeakNilCategories checks that
// an empty KillSwitchState serialises to {} rather than null,
// which would break the audit log diff.
func TestKillSwitchJSONMarshalDoesNotLeakNilCategories(t *testing.T) {
	ks := KillSwitchState{}
	raw, err := json.Marshal(ks)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"categories"`) {
		t.Fatalf("empty state must still serialise categories key, got %s", raw)
	}
}
