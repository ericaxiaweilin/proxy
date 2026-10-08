package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/incentive"
)

// INCENTIVE-001 对真库：候选人只来自规则创建之后达成的、够老且资料完善的人；发放对 (规则,用户) 幂等；
// 现金类奖励连库里都写不进去。
func TestIncentiveCandidatesGrantsAreIdempotentAndCashIsImpossibleInTheDatabase(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	rule := "inc_t_" + stamp
	eligible, tooNew, early, noProfile := "u_in_e_"+stamp, "u_in_n_"+stamp, "u_in_p_"+stamp, "u_in_x_"+stamp
	users := []string{eligible, tooNew, early, noProfile}
	posts := []string{"p_in1_" + stamp, "p_in2_" + stamp, "p_in3_" + stamp, "p_in4_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM incentive.grants WHERE rule_id = $1`, rule)
		_, _ = pool.Exec(bg, `DELETE FROM incentive.rules WHERE id = $1`, rule)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = ANY($1)`, posts)
		_, _ = pool.Exec(bg, `DELETE FROM identity.profiles WHERE user_account_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id = ANY($1)`, users)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	ruleAt := now.Add(-time.Hour)
	mkUser := func(id string, age time.Duration, profile bool) {
		exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',$2,$2)`, id, now.Add(-age))
		if profile {
			exec(`INSERT INTO identity.profiles (user_account_id, name, handle, city, avatar_path, updated_at) VALUES ($1,'N','h_`+id+`','HN','assets/x',$2)`, id, now)
		}
	}
	mkUser(eligible, 72*time.Hour, true)
	mkUser(tooNew, 2*time.Hour, true)
	mkUser(early, 72*time.Hour, true)
	mkUser(noProfile, 72*time.Hour, false)
	post := func(id, author string, at time.Time) {
		exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status) VALUES ($1,'USER',$2,'x',$3,'PUBLISHED')`, id, author, at)
	}
	post(posts[0], eligible, now.Add(-10*time.Minute))
	post(posts[1], tooNew, now.Add(-10*time.Minute))
	post(posts[2], early, ruleAt.Add(-5*time.Hour)) // 规则创建之前就发过：不追溯
	post(posts[3], noProfile, now.Add(-10*time.Minute))

	st := incentive.NewPostgres(pool)
	r := incentive.Rule{ID: rule, Label: "首帖成长值", Trigger: incentive.TriggerFirstPost, RewardKind: incentive.RewardGrowthPoints, Points: 10, MinAccountAgeHours: 24, CreatedBy: "op", CreatedAt: ruleAt, UpdatedAt: ruleAt}
	if err := st.UpsertRule(ctx, r); err != nil {
		t.Fatal(err)
	}
	has := func(ids []string, id string) bool {
		for _, x := range ids {
			if x == id {
				return true
			}
		}
		return false
	}
	ids, err := st.Candidates(ctx, r, now, 500)
	if err != nil {
		t.Fatal(err)
	}
	if !has(ids, eligible) || has(ids, tooNew) || has(ids, early) || has(ids, noProfile) {
		t.Fatalf("only the eligible one: eligible=%v tooNew=%v early=%v noProfile=%v", has(ids, eligible), has(ids, tooNew), has(ids, early), has(ids, noProfile))
	}
	g := incentive.Grant{ID: "g1_" + stamp, RuleID: rule, UserID: eligible, RewardKind: incentive.RewardGrowthPoints, Points: 10, Status: incentive.StatusGranted, GrantedAt: now}
	if ins, err := st.RecordGrant(ctx, g); err != nil || !ins {
		t.Fatalf("first grant inserts: %v %v", ins, err)
	}
	g.ID = "g2_" + stamp
	if ins, err := st.RecordGrant(ctx, g); err != nil || ins {
		t.Fatalf("a second grant for the same (rule,user) is a no-op: %v %v", ins, err)
	}
	if ids, _ := st.Candidates(ctx, r, now, 500); has(ids, eligible) {
		t.Fatal("a rewarded person is no longer a candidate")
	}
	grants, _ := st.GrantsOf(ctx, eligible)
	if len(grants) != 1 || grants[0].Points != 10 {
		t.Fatalf("the user sees their reward: %+v", grants)
	}
	// 现金：库里的 CHECK 直接挡。
	if _, err := pool.Exec(ctx, `INSERT INTO incentive.rules (id,label,trigger,reward_kind,points,created_by,created_at,updated_at) VALUES ($1,'x','FIRST_POST','CASH',50,'op',now(),now())`, "bad_"+stamp); err == nil {
		t.Fatal("the database must refuse a cash reward")
	}
	// 生效中的规则不能被 upsert 改内容。
	if ok, err := st.SetActive(ctx, rule, true, now); err != nil || !ok {
		t.Fatal("activate")
	}
	r2 := r
	r2.Points = 999
	_ = st.UpsertRule(ctx, r2)
	rules, _ := st.ListRules(ctx)
	for _, x := range rules {
		if x.ID == rule && x.Points != 10 {
			t.Fatalf("an active rule's reward must not change under it: %d", x.Points)
		}
	}
}
