package postgres

// MATCH-ENGINE-001：撮合引擎的门源和决策账对真库跑——
// 被安全封禁 / 被拉黑的人不进池且有原因码；整次运行落 matching.decisions；账只能追加（UPDATE 被拒）。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matchengine"
)

func TestMatchEngineGatesAndDecisionLedgerOnRealDB(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	req, banned, blocked, fine := "u_me_r_"+stamp, "u_me_b_"+stamp, "u_me_k_"+stamp, "u_me_f_"+stamp
	opp := "opp_me_" + stamp
	// friendships 的有序对：user_a < user_b
	a, b := req, blocked
	if a > b {
		a, b = b, a
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM safety.blocks WHERE target_id = $1`, banned)
		_, _ = pool.Exec(bg, `DELETE FROM relationship.friendships WHERE user_a = $1 AND user_b = $2`, a, b)
		_, _ = pool.Exec(bg, `DELETE FROM matching.decisions WHERE subject_id = $1`, opp)
	})
	now := time.Now().UTC()
	if _, err := pool.Exec(ctx, `INSERT INTO safety.blocks (id, target_id, block_type, reason, created_at) VALUES ($1,$2,'ACCOUNT','test',$3)`, "sb_"+stamp, banned, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO relationship.friendships (id, user_a, user_b, state, requester_id, created_at, updated_at) VALUES ($1,$2,$3,'BLOCKED',$4,$5,$5)`, "fr_"+stamp, a, b, req, now); err != nil {
		t.Fatal(err)
	}
	store := matchengine.NewPostgres(pool)
	engine := &matchengine.Engine{SetSize: 5, Recorder: store, Gates: []matchengine.Gate{
		matchengine.SafetyGate{Blocked: store.SafetyBlocked},
		matchengine.UserBlockGate{Blocked: store.UserBlocked},
	}}
	res := engine.Run(ctx, matchengine.Subject{Kind: matchengine.SubjectOpportunity, ID: opp, RequesterID: req},
		[]matchengine.Candidate{{AgentID: banned}, {AgentID: blocked}, {AgentID: fine}})
	reasons := map[string]string{}
	for _, x := range res.Ineligible {
		reasons[x.AgentID] = x.Reason
	}
	if reasons[banned] != matchengine.ReasonSafetyBlocked || reasons[blocked] != matchengine.ReasonUserBlocked || len(res.CandidateSet) != 1 || res.CandidateSet[0].AgentID != fine {
		t.Fatalf("gates on real data: %v set=%+v", reasons, res.CandidateSet)
	}
	rows, err := store.Explain(ctx, matchengine.SubjectOpportunity, opp, "", 50)
	if err != nil || len(rows) != 3 {
		t.Fatalf("every candidate has a verdict row: %d %v", len(rows), err)
	}
	if _, err := pool.Exec(ctx, `UPDATE matching.decisions SET eligible = true WHERE subject_id = $1`, opp); err == nil {
		t.Fatal("the decision ledger is append-only")
	}
}
