package matchengine

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

func ptr(v float64) *float64 { return &v }

type memRecorder struct{ rows []Decision }

func (m *memRecorder) Record(_ context.Context, d []Decision) error {
	m.rows = append(m.rows, d...)
	return nil
}

func cand(id string, completed int, distM float64) Candidate {
	d := distM
	return Candidate{AgentID: id, Signals: matching.Signals{Completed: completed, OnTime: completed, DistanceM: &d}}
}

func TestEveryCandidateGetsAVerdictWithTheFirstFailingGateAndNobodyIsSilentlyDropped(t *testing.T) {
	rec := &memRecorder{}
	e := &Engine{
		Gates: []Gate{
			ExclusionGate{Excluded: map[string]string{"owner": ReasonSelf, "applied": ReasonAlreadyApplied}},
			AccountGate{Level: func(_ context.Context, id string) (string, error) {
				if id == "banned" {
					return "SUSPENDED", nil
				}
				return "", nil
			}},
			PermissionGate{Granted: func(_ context.Context, id string) (bool, error) {
				if id == "broken" {
					return false, errors.New("db down")
				}
				return id != "nopermit", nil
			}},
			LocationGate{RadiusM: 30_000},
		},
		SetSize: 2, Recorder: rec, NewID: func() string { return "ms_test" }, Now: func() time.Time { return time.Unix(1_800_000_000, 0) },
	}
	lat, lng := 21.0, 105.8
	pool := []Candidate{cand("owner", 5, 100), cand("applied", 5, 100), cand("banned", 5, 100), cand("nopermit", 5, 100), cand("broken", 5, 100),
		cand("far", 5, 90_000), {AgentID: "lost"}, cand("good1", 30, 1000), cand("good2", 10, 2000), cand("good3", 2, 3000)}
	res := e.Run(context.Background(), Subject{Kind: SubjectOpportunity, ID: "opp1", RequesterID: "owner", Lat: &lat, Lng: &lng}, pool)

	want := map[string]string{"owner": ReasonSelf, "applied": ReasonAlreadyApplied, "banned": ReasonAccountRestricted, "nopermit": ReasonNoOrderPermission,
		"broken": ReasonGateUnavailable}
	got := map[string]Ineligible{}
	for _, ig := range res.Ineligible {
		got[ig.AgentID] = ig
	}
	for id, reason := range want {
		if got[id].Reason != reason {
			t.Errorf("%s should fail with %s, got %+v", id, reason, got[id])
		}
	}
	if !got["broken"].Unknown {
		t.Error("an unreadable gate is marked Unknown, distinct from 'not eligible'")
	}
	if got["far"].Reason != ReasonOutOfRadius || got["lost"].Reason != ReasonLocationUnknown {
		t.Errorf("distance gate: far=%+v lost=%+v", got["far"], got["lost"])
	}
	if res.Health.Retrieved != 10 || res.Health.Qualified != 3 || len(res.Ineligible) != 7 || res.Health.ByReason[ReasonSelf] != 1 {
		t.Errorf("supply health must account for everyone: %+v", res.Health)
	}
	if len(rec.rows) != 10 {
		t.Fatalf("every candidate (eligible or not) is written to the audit: %d rows", len(rec.rows))
	}
	for _, r := range rec.rows {
		if r.SnapshotID != "ms_test" || r.RankVersion != res.RankVersion || r.SubjectID != "opp1" {
			t.Errorf("audit row carries snapshot/version/subject: %+v", r)
		}
		if r.Eligible && (r.OrganicRank == 0 || r.Gate != "") || !r.Eligible && (r.Reason == "" || r.Gate == "") {
			t.Errorf("eligible rows have a rank, ineligible rows a gate and reason: %+v", r)
		}
	}
}

func TestQualifiedAreRankedByTheEngineFormulaAndTheSetIsFinite(t *testing.T) {
	e := &Engine{SetSize: 2}
	res := e.Run(context.Background(), Subject{Kind: SubjectOpportunity, ID: "o"}, []Candidate{cand("low", 1, 0), cand("high", 40, 0), cand("mid", 10, 0)})
	if len(res.Qualified) != 3 || res.Qualified[0].AgentID != "high" || res.Qualified[2].AgentID != "low" {
		t.Fatalf("more completed orders rank higher: %+v", res.Qualified)
	}
	if len(res.CandidateSet) != 2 {
		t.Fatalf("the candidate set is finite (no infinite list): %d", len(res.CandidateSet))
	}
	if res.RankVersion == "" || res.RankVersion != RankVersion(matching.CurrentTunables()) {
		t.Fatalf("the run carries the formula version: %q", res.RankVersion)
	}
	for _, en := range res.Qualified {
		if len(en.Reasons) == 0 || len(en.Reasons) > 2 {
			t.Errorf("each entry carries 1-2 human reason codes, never a bare score: %+v", en)
		}
	}
}

func TestANewcomerGetsAnExplorationSlotOnlyWhenNoneIsAlreadyInTheSet(t *testing.T) {
	tun := matching.DefaultTunables()
	e := &Engine{SetSize: 2, Tunables: func() matching.Tunables { return tun }}
	pool := []Candidate{cand("a", 40, 0), cand("b", 35, 0), cand("c", 30, 0), cand("rookie", 0, 0)}
	res := e.Run(context.Background(), Subject{ID: "o"}, pool)
	last := res.CandidateSet[len(res.CandidateSet)-1]
	if !last.Exploration || last.AgentID != "rookie" {
		t.Fatalf("with only veterans in the top set, the best newcomer takes the last slot: %+v", res.CandidateSet)
	}
	for i, en := range res.CandidateSet {
		if en.Rank != i+1 {
			t.Errorf("ranks are renumbered 1..n: %+v", res.CandidateSet)
		}
	}
	// 候选池不超过集合大小：所有人都在集合里，不需要探索位。
	withRookieAlready := e.Run(context.Background(), Subject{ID: "o"}, []Candidate{cand("rookie", 0, 0), cand("a", 40, 0)})
	for _, en := range withRookieAlready.CandidateSet {
		if en.Exploration {
			t.Fatalf("no exploration slot is needed when a newcomer is already in the set: %+v", withRookieAlready.CandidateSet)
		}
	}
}

func TestRankVersionChangesWhenTheTunablesChange(t *testing.T) {
	a := matching.DefaultTunables()
	b := a
	b.DistanceWeight += 5
	if RankVersion(a) == RankVersion(b) || RankVersion(a) != RankVersion(a) {
		t.Fatal("same knobs → same version; moved knob → different version")
	}
}

func TestSupplyThinAndEmptyAreStatedNotImplied(t *testing.T) {
	e := &Engine{SetSize: 5, Gates: []Gate{PermissionGate{Granted: func(context.Context, string) (bool, error) { return false, nil }}}}
	res := e.Run(context.Background(), Subject{ID: "o"}, []Candidate{cand("a", 1, 0), cand("b", 1, 0)})
	if !res.Health.Empty || !res.Health.Thin || len(res.CandidateSet) != 0 {
		t.Fatalf("nobody qualified: %+v", res.Health)
	}
	_ = fmt.Sprint()
}
