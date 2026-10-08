package postgres

// OPS-INSIGHT-001：需求缺口与标签分群的 SQL 对真库跑。

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/guidance"
	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

func TestDemandGapCountsFunnelThemesAndAreasHonestly(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	ids := []string{"opp_ig1_" + stamp, "opp_ig2_" + stamp, "opp_ig3_" + stamp, "opp_ig4_" + stamp}
	agent := "agent_ig_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.opportunities WHERE id = ANY($1)`, ids)
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id = $1`, agent)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	old := now.Add(-30 * time.Hour)
	// 咖啡搭子：河内(21.03,105.85)，2 小时后有人报名并被选中。
	exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,'o1',$2::jsonb,$3)`, ids[0],
		`{"theme":"咖啡搭子","title":"a","priceLabel":"x","lat":21.03,"lng":105.85}`, old)
	exec(`INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at) VALUES ($1,$2,'a1',$3::jsonb,$4)`, "app_ig1_"+stamp, ids[0], `{"status":"SELECTED"}`, old.Add(2*time.Hour))
	// 咖啡搭子：同一片区，30 小时没人理 → 没人接。
	exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,'o2',$2::jsonb,$3)`, ids[1], `{"theme":"咖啡搭子","title":"b","lat":21.04,"lng":105.86}`, old)
	// 徒步：北宁(21.18,106.07)，没有供给，没带人理，刚发（不到 24 小时，不算 unfilled）。
	exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,'o3',$2::jsonb,$3)`, ids[2], `{"theme":"徒步","title":"c","lat":21.18,"lng":106.07}`, now.Add(-time.Hour))
	// 点名私单：不算「没人接」。
	exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,'o4',$2::jsonb,$3)`, ids[3], `{"theme":"咖啡搭子","title":"d","targetAccountId":"someone"}`, old)
	// 河内片区有 1 个供给。
	exec(`INSERT INTO supply.agent_profiles (agent_id, name, status, created_at, updated_at, lat, lng) VALUES ($1,'t','ACTIVE',$2,$2,21.05,105.87)`, agent, now)

	gap, err := insight.NewPostgres(pool).DemandGap(ctx, now, 3)
	if err != nil {
		t.Fatalf("DemandGap: %v", err)
	}
	// 窗口里可能有别的测试 / 种子数据：只断言我这几张单带来的**增量**与结构。
	theme := map[string]insight.ThemeRow{}
	for _, r := range gap.Themes {
		theme[r.Theme] = r
	}
	if theme["咖啡搭子"].Published < 2 || theme["咖啡搭子"].WithApplicant < 1 || theme["咖啡搭子"].Confirmed < 1 {
		t.Errorf("coffee theme funnel: %+v", theme["咖啡搭子"])
	}
	if m := theme["咖啡搭子"].MedianMinutes; m == nil || *m <= 0 {
		t.Errorf("a median time to first applicant must exist where someone applied: %v", m)
	}
	if gap.Directed < 1 {
		t.Error("the directed (private) opportunity must be counted apart, not as unfilled")
	}
	var seenUnfilled, seenPrivate bool
	for _, u := range gap.Unfilled {
		if u.ID == ids[1] {
			seenUnfilled = true
		}
		if u.ID == ids[3] {
			seenPrivate = true
		}
		if u.ID == ids[2] {
			t.Error("a 1-hour-old opportunity is not unfilled yet")
		}
	}
	if !seenUnfilled || seenPrivate {
		t.Errorf("the 30h untouched public opportunity is unfilled and the private one is not: unfilled=%v private=%v", seenUnfilled, seenPrivate)
	}
	cells := map[string]insight.AreaRow{}
	for _, a := range gap.Areas {
		cells[a.Cell] = a
	}
	if c := cells["21.0,105.8"]; c.Demand < 2 || c.Supply < 1 || c.NoSupply {
		t.Errorf("hanoi cell has demand and a supplier: %+v", c)
	}
	if c := cells["21.1,106.0"]; c.Demand < 1 || c.Supply != 0 || !c.NoSupply {
		t.Errorf("the hiking demand cell has no supplier: %+v", c)
	}
}

func TestSegmentsSuppressSmallCohortsAndShowCoOccurrenceOnlyForBigOnes(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	big := make([]string, 0, 6)
	for i := 0; i < 6; i++ {
		big = append(big, fmt.Sprintf("u_sg_big_%d_%s", i, stamp))
	}
	small := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		small = append(small, fmt.Sprintf("u_sg_small_%d_%s", i, stamp))
	}
	all := append(append([]string{}, big...), small...)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, all) })
	now := time.Now().UTC()
	store := tagging.NewPostgres(pool)
	mk := func(axis, value string) tagging.Tag {
		return tagging.Tag{Axis: axis, Value: value, Strength: .5, Confidence: .5, Source: tagging.SourceBehavior, EvidenceCount: 3, SourceDiversity: 1,
			FirstSeen: now, LastSeen: now, ExpiresAt: now.Add(time.Hour), ComputedAt: now, RuleVersion: tagging.RuleVersion}
	}
	for _, u := range big { // 6 人：都爱摄影，其中都去咖啡
		_ = store.ReplaceUserTags(ctx, u, []tagging.Tag{mk(tagging.AxisInterestTopic, "测试摄影"), mk(tagging.AxisVenueKind, "测试咖啡")})
	}
	for _, u := range small { // 2 人：爱手作，也去咖啡
		_ = store.ReplaceUserTags(ctx, u, []tagging.Tag{mk(tagging.AxisInterestTopic, "测试手作"), mk(tagging.AxisVenueKind, "测试咖啡")})
	}
	src := insight.NewPostgres(pool)

	seg, err := src.Segments(ctx, now, tagging.AxisInterestTopic, tagging.AxisInterestTopic, "测试摄影")
	if err != nil {
		t.Fatalf("Segments: %v", err)
	}
	topic := map[string]insight.Cell{}
	for _, c := range seg.Top {
		topic[c.Value] = c
	}
	if c := topic["测试摄影"]; c.Suppressed || c.Users == nil || *c.Users < 6 {
		t.Errorf("a 6-person tag may show its count: %+v", c)
	}
	if c := topic["测试手作"]; !c.Suppressed || c.Users != nil {
		t.Errorf("a 2-person tag must be suppressed with no number: %+v", c)
	}
	if seg.CohortSize == nil || seg.CohortSize.Suppressed {
		t.Fatalf("the photography cohort (6) is large enough: %+v", seg.CohortSize)
	}
	found := false
	for _, c := range seg.AlsoHave {
		if c.Value == tagging.AxisVenueKind+":测试咖啡" && !c.Suppressed {
			found = true
		}
	}
	if !found {
		t.Errorf("the big cohort's co-occurring tags must be visible: %+v", seg.AlsoHave)
	}

	tiny, err := src.Segments(ctx, now, "", tagging.AxisInterestTopic, "测试手作")
	if err != nil {
		t.Fatal(err)
	}
	if tiny.CohortSize == nil || !tiny.CohortSize.Suppressed || len(tiny.AlsoHave) != 0 {
		t.Errorf("a 2-person cohort must neither show its size nor what else its members have: %+v", tiny)
	}
	top, err := src.TopInterests(ctx, now, 50)
	if err != nil {
		t.Fatalf("TopInterests: %v", err)
	}
	var sawBig, sawSmall bool
	for _, r := range top {
		if r.Value == "测试摄影" && r.Users >= 6 && r.Tag == "话题·测试摄影" {
			sawBig = true
		}
		if r.Value == "测试手作" {
			sawSmall = true
		}
	}
	if !sawBig || sawSmall {
		t.Errorf("TopInterests must list the 6-person tag and drop the 2-person one entirely: big=%v small=%v", sawBig, sawSmall)
	}
	if seg.Coverage.ActiveUsers < 0 || len(seg.Coverage.Buckets) != 5 {
		t.Errorf("coverage buckets: %+v", seg.Coverage)
	}
}

// 引导：下一步状态和推送候选对真库——真实计数，窗口按注册时间，非 ACTIVE 不在候选里。
func TestGuidanceStateCountsRealThingsAndCandidatesFollowTheWindow(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	fresh, mid, old, suspended := "u_gd_f_"+stamp, "u_gd_m_"+stamp, "u_gd_o_"+stamp, "u_gd_s_"+stamp
	users := []string{fresh, mid, old, suspended}
	post := "p_gd_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = $1`, post)
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
	mk := func(id, status string, age time.Duration) {
		exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,$2,$3,$3)`, id, status, now.Add(-age))
	}
	mk(fresh, "ACTIVE", 2*time.Hour)
	mk(mid, "ACTIVE", 30*time.Hour)
	mk(old, "ACTIVE", 20*24*time.Hour)
	mk(suspended, "SUSPENDED", 30*time.Hour)
	exec(`INSERT INTO identity.profiles (user_account_id, name, handle, city, avatar_path, updated_at) VALUES ($1,'M','m_`+stamp+`','HN','assets/x',$2)`, mid, now)
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status) VALUES ($1,'USER',$2,'x',$3,'PUBLISHED')`, post, old, now)

	src := guidance.NewPostgres(pool)
	st, err := src.LoadState(ctx, mid)
	if err != nil || !st.ProfileComplete || st.Posts != 0 {
		t.Fatalf("mid has a complete profile and no posts: %+v %v", st, err)
	}
	if st, _ := src.LoadState(ctx, old); st.ProfileComplete || st.Posts != 1 {
		t.Fatalf("old has a post but no profile: %+v", st)
	}
	has := func(ids []string, want string) bool {
		for _, id := range ids {
			if id == want {
				return true
			}
		}
		return false
	}
	ids, err := src.Candidates(ctx, now, 24*time.Hour, 7*24*time.Hour, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !has(ids, mid) || has(ids, fresh) || has(ids, old) || has(ids, suspended) {
		t.Fatalf("window 1-7 days, ACTIVE only: mid yes; fresh (2h), old (20d), suspended no")
	}
}

// 撮合评估的案例查询对真库：只取多人报名且恰好选定一人的公开单。
func TestMatchEvalCasesQueryReturnsOnlyMultiApplicantSelectedPublicOpportunities(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	ids := []string{"opp_ev1_" + stamp, "opp_ev2_" + stamp, "opp_ev3_" + stamp}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM marketplace.opportunities WHERE id = ANY($1)`, ids) })
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	for _, id := range ids {
		exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,'o',$2::jsonb,$3)`, id, `{"theme":"x","lat":21.0,"lng":105.8}`, now.Add(-time.Hour))
	}
	app := func(opp, who, status string, off time.Duration) {
		exec(`INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
			"ap_"+opp+who, opp, who, `{"status":"`+status+`"}`, now.Add(-time.Hour+off))
	}
	app(ids[0], "x1", "SUBMITTED", time.Minute)
	app(ids[0], "x2", "SELECTED", 2*time.Minute) // 两人报名，选定 x2 ✔
	app(ids[1], "y1", "SELECTED", time.Minute)   // 只有一人报名 ✘
	app(ids[2], "z1", "SUBMITTED", time.Minute)  // 两人报名但没选 ✘
	app(ids[2], "z2", "SUBMITTED", 2*time.Minute)

	cases, err := insight.NewPostgres(pool).EvalCases(ctx, now.Add(-24*time.Hour), 500)
	if err != nil {
		t.Fatal(err)
	}
	var got *struct{ chosen string }
	for _, c := range cases {
		switch c.OpportunityID {
		case ids[0]:
			got = &struct{ chosen string }{c.Chosen}
			if len(c.Applicants) != 2 {
				t.Errorf("both live applicants are listed: %v", c.Applicants)
			}
		case ids[1], ids[2]:
			t.Errorf("%s must not be an evaluation case", c.OpportunityID)
		}
	}
	if got == nil || got.chosen != "x2" {
		t.Fatalf("the multi-applicant selected opportunity is a case with the chosen applicant: %+v", got)
	}
}
