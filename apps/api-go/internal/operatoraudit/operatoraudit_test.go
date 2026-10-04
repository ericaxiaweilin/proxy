package operatoraudit

import (
	"context"
	"errors"
	"testing"
	"time"
)

type memStore struct {
	rows []Entry
	fail bool
}

func (m *memStore) Append(_ context.Context, e Entry) error {
	if m.fail {
		return errors.New("store down")
	}
	m.rows = append(m.rows, e)
	return nil
}

func (m *memStore) Recent(_ context.Context, limit int) ([]Entry, error) {
	if limit > 0 && len(m.rows) > limit {
		return m.rows[:limit], nil
	}
	return m.rows, nil
}

// The Recorder is what handlers hold, and its whole job is to make an audit gap visible
// instead of fatal-or-silent. Both halves get pinned: a failed write must be counted, and
// counting must never turn into an error the caller has to handle (the action already
// happened; aborting it would paper over the gap with a data-consistency story).
func TestRecorderCountsFailuresWithoutFailingTheCaller(t *testing.T) {
	store := &memStore{}
	rec := NewRecorder(store)
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "X", Outcome: OutcomeOK})
	if recorded, failed := rec.Counts(); recorded != 1 || failed != 0 {
		t.Fatalf("counts = (%d, %d), want (1, 0)", recorded, failed)
	}
	if len(store.rows) != 1 || store.rows[0].Action != "X" {
		t.Fatalf("rows = %+v", store.rows)
	}
	// A zero ActedAt must be filled in, not written as the zero time.
	if store.rows[0].ActedAt.IsZero() {
		t.Error("ActedAt was left zero")
	}

	store.fail = true
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "Y", Outcome: OutcomeOK})
	if recorded, failed := rec.Counts(); recorded != 2 || failed != 1 {
		t.Fatalf("after a failed write, counts = (%d, %d), want (2, 1)", recorded, failed)
	}
}

// No store means nothing can be persisted. That must read as "not connected", never as an
// empty log — an empty list and a clean record are the same shape on screen.
func TestRecorderWithoutAStoreIsNotConnected(t *testing.T) {
	rec := NewRecorder(nil)
	if rec.Connected() {
		t.Fatal("a recorder with no store must not report connected")
	}
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "X", Outcome: OutcomeOK})
	if recorded, failed := rec.Counts(); recorded != 1 || failed != 1 {
		t.Fatalf("an unauditable action must be counted as a failure, got (%d, %d)", recorded, failed)
	}
	rows, err := rec.Recent(context.Background(), 10)
	if err != nil || rows != nil {
		t.Fatalf("Recent on a nil store = (%v, %v), want (nil, nil)", rows, err)
	}
}

// A nil *Recorder is what a Server with no database holds. Every method must be safe on it
// — handlers call Record unconditionally and must not have to nil-check first.
func TestNilRecorderIsSafe(t *testing.T) {
	var rec *Recorder
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "X"})
	if recorded, failed := rec.Counts(); recorded != 0 || failed != 0 {
		t.Fatalf("nil recorder counts = (%d, %d), want (0, 0)", recorded, failed)
	}
	if rec.Connected() {
		t.Error("nil recorder must not report connected")
	}
	if rows, err := rec.Recent(context.Background(), 10); rows != nil || err != nil {
		t.Fatalf("nil recorder Recent = (%v, %v)", rows, err)
	}
}

func TestRecordStampsActedAtAndNeverInventsDetail(t *testing.T) {
	store := &memStore{}
	rec := NewRecorder(store)
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "X", Outcome: OutcomeOK})
	got := store.rows[0].ActedAt
	if got.IsZero() {
		t.Fatal("ActedAt was left at the zero time — it would sort before every real row and read as 1970")
	}
	if d := got.Sub(time.Now()); d > time.Minute || d < -time.Minute {
		t.Errorf("ActedAt = %v, want roughly now", got)
	}
	if store.rows[0].Detail != nil {
		t.Errorf("Detail = %v, want nil — an empty map would claim we recorded something we did not", store.rows[0].Detail)
	}

	// An explicit timestamp is kept, not overwritten.
	when := time.Date(2026, 10, 4, 1, 2, 3, 0, time.UTC)
	rec.Record(context.Background(), Entry{OperatorID: "op_a", Action: "Y", Outcome: OutcomeOK, ActedAt: when})
	if !store.rows[1].ActedAt.Equal(when) {
		t.Errorf("ActedAt = %v, want the caller's %v", store.rows[1].ActedAt, when)
	}
}
