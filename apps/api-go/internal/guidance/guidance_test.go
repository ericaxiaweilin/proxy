package guidance

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func TestStepsAreOrderedByPriorityAndOnlyClaimWhatIsTrue(t *testing.T) {
	steps := BuildSteps(State{})
	if len(steps) != 4 || steps[0].ID != "complete_profile" || steps[1].ID != "first_post" || steps[2].ID != "first_demand" {
		t.Fatalf("profile first, then post, then demand: %+v", steps)
	}
	if n := NextStep(steps); n == nil || n.ID != "complete_profile" || n.Target != TargetEditProfile {
		t.Fatalf("a brand-new user is asked to finish the profile first: %+v", n)
	}
	done := BuildSteps(State{ProfileComplete: true, Posts: 2})
	if n := NextStep(done); n.ID != "first_demand" || !done[0].Done || !done[1].Done {
		t.Fatalf("done steps are marked and skipped: %+v next=%+v", done, n)
	}
	if NextStep(BuildSteps(State{ProfileComplete: true, Posts: 1, Demands: 1, ActivitiesJoined: 1})) != nil {
		t.Fatal("nothing left means no next step")
	}
	for _, s := range steps {
		for _, banned := range []string{"奖励", "领取", "红包", "优惠"} {
			if contains(s.Title+s.Reason, banned) {
				t.Errorf("guidance must not promise rewards before any are defined: %q", s.Title+s.Reason)
			}
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

type fakeSource struct {
	cand  map[string][]string // nudge key by min age → ids
	state map[string]State
}

func (f fakeSource) Candidates(_ context.Context, _ time.Time, minAge, _ time.Duration, _ int) ([]string, error) {
	return f.cand[minAge.String()], nil
}
func (f fakeSource) LoadState(_ context.Context, id string) (State, error) { return f.state[id], nil }

type recorder struct{ calls [][3]string }

func (r *recorder) Nudge(_ context.Context, user, key, _, _, _ string) error {
	r.calls = append(r.calls, [3]string{user, key, ""})
	return nil
}

func TestNudgesSkipPeopleWhoDidItWhoseProfileIsIncompleteAndTheRestricted(t *testing.T) {
	src := fakeSource{
		cand: map[string][]string{(24 * time.Hour).String(): {"idle", "poster", "noprofile", "banned"}, (72 * time.Hour).String(): {"idle"}},
		state: map[string]State{
			"idle":      {ProfileComplete: true},
			"poster":    {ProfileComplete: true, Posts: 3},
			"noprofile": {},
			"banned":    {ProfileComplete: true},
		},
	}
	rec := &recorder{}
	sent, err := RunNudges(context.Background(), src, rec, func(_ context.Context, id string) bool { return id == "banned" }, time.Now(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if sent["FIRST_POST"] != 1 || sent["FIRST_DEMAND"] != 1 || len(rec.calls) != 2 {
		t.Fatalf("only the idle, complete, unrestricted user is nudged (once per kind): %v %v", sent, rec.calls)
	}
	if rec.calls[0][0] != "idle" || rec.calls[0][1] != "FIRST_POST" || rec.calls[1][1] != "FIRST_DEMAND" {
		t.Fatalf("calls: %v", rec.calls)
	}
}

func TestNudgeWindowsDoNotCollideSoNobodyGetsTwoOnTheSameDay(t *testing.T) {
	a, b := Nudges[0], Nudges[1]
	if !(b.MinAge-a.MinAge >= 24*time.Hour) {
		t.Fatalf("second nudge starts at least a day after the first: %v %v", a.MinAge, b.MinAge)
	}
}

func TestGetNextStepsReadsOnlyTheCallersOwnState(t *testing.T) {
	c := &Commands{Source: fakeSource{state: map[string]State{"me": {ProfileComplete: true}, "other": {ProfileComplete: true, Posts: 9, Demands: 9, ActivitiesJoined: 9}}}}
	res := c.HandleContext(context.Background(), command.Envelope{CommandType: "GetNextSteps", Actor: command.Actor{ID: "me"}, Payload: map[string]any{"userId": "other"}})
	if res.Error != nil || res.Body["doneCount"] != 1 {
		t.Fatalf("a payload userId must not redirect the read: %+v %v", res.Error, res.Body)
	}
	if anon := c.HandleContext(context.Background(), command.Envelope{CommandType: "GetNextSteps"}); anon.Error == nil || anon.Error.ErrorCode != "NEXT_STEPS_REQUIRES_ACTOR" {
		t.Fatalf("anonymous refused: %+v", anon.Error)
	}
}
