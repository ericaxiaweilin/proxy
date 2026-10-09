package postgres

// IDENTITY-POINTS-001 对真库：固定规则把用户做过的事折成积分（幂等、发帖每天最多 3 条）；
// 账本不能改；按分数开的奖励活动只发给到线的人，成长值奖励进账本。

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/guidance"
	"github.com/proxy-app/proxy-api/internal/identitytier"
	"github.com/proxy-app/proxy-api/internal/incentive"
	"github.com/proxy-app/proxy-api/internal/treasure"
	"github.com/proxy-app/proxy-api/internal/weatherwatch"
)

func TestIdentityPointsCollectIdempotentlyAndScoreCampaignsGrantOnlyThoseWhoReachedTheLine(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	rich, poor := "u_ip_r_"+stamp, "u_ip_p_"+stamp
	rule := "inc_ip_" + stamp
	users := []string{rich, poor}
	posts := []string{}
	for i := 0; i < 5; i++ {
		posts = append(posts, fmt.Sprintf("p_ip_%s_%d", stamp, i))
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM incentive.grants WHERE rule_id = $1`, rule)
		_, _ = pool.Exec(bg, `DELETE FROM incentive.rules WHERE id = $1`, rule)
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = ANY($1)`, users)
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
	for _, u := range users {
		exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',$2,$2)`, u, now.Add(-72*time.Hour))
		exec(`INSERT INTO identity.profiles (user_account_id, name, handle, city, avatar_path, updated_at) VALUES ($1,'N','h_`+u+`','HN','assets/x',$2)`, u, now)
	}
	// rich 同一天发了 5 条帖：只算 3 条。
	for i, id := range posts {
		exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status) VALUES ($1,'USER',$2,'x',$3,'PUBLISHED')`, id, rich, now.Add(-time.Duration(i+1)*time.Minute))
	}
	st := identitytier.NewPostgres(pool)
	if _, err := st.CollectUser(ctx, now); err != nil {
		t.Fatal(err)
	}
	richPts, _ := st.Points(ctx, identitytier.User, rich)
	poorPts, _ := st.Points(ctx, identitytier.User, poor)
	if richPts != 30+3*5 || poorPts != 30 {
		t.Fatalf("profile 30 + at most 3 posts/day x 5: rich=%d poor=%d", richPts, poorPts)
	}
	if _, err := st.CollectUser(ctx, now); err != nil {
		t.Fatal(err)
	}
	if again, _ := st.Points(ctx, identitytier.User, rich); again != richPts {
		t.Fatalf("collecting twice must not double count: %d -> %d", richPts, again)
	}
	if _, err := pool.Exec(ctx, `UPDATE growth.point_ledger SET delta = 9999 WHERE subject_id = $1`, rich); err == nil {
		t.Fatal("the ledger cannot be edited")
	}

	// 按分数开的奖励活动：门槛 40 分 —— rich(45) 到线，poor(30) 没到；成长值奖励进账本。
	ruleAt := now.Add(-time.Hour)
	inc := incentive.NewPostgres(pool)
	r := incentive.Rule{ID: rule, Label: "分数奖励", Trigger: incentive.TriggerScoreReached, RewardKind: incentive.RewardGrowthPoints, Points: 20, MinAccountAgeHours: 24, MinPoints: 40, Audience: "USER", CreatedBy: "op", CreatedAt: ruleAt, UpdatedAt: ruleAt}
	if err := inc.UpsertRule(ctx, r); err != nil {
		t.Fatal(err)
	}
	ids, err := inc.Candidates(ctx, r, now, 500)
	if err != nil {
		t.Fatal(err)
	}
	hasID := func(id string) bool {
		for _, x := range ids {
			if x == id {
				return true
			}
		}
		return false
	}
	if !hasID(rich) || hasID(poor) {
		t.Fatalf("only those who reached the line: rich=%v poor=%v", hasID(rich), hasID(poor))
	}
	g := incentive.Grant{ID: "g_ip_" + stamp, RuleID: rule, UserID: rich, Audience: "USER", RewardKind: incentive.RewardGrowthPoints, Points: 20, Status: incentive.StatusGranted, GrantedAt: now}
	if ins, err := inc.RecordGrant(ctx, g); err != nil || !ins {
		t.Fatalf("grant: %v %v", ins, err)
	}
	if after, _ := st.Points(ctx, identitytier.User, rich); after != richPts+20 {
		t.Fatalf("growth-points rewards land in the ledger: %d", after)
	}
}

// 商家每接待一单（履约完成且归因到本店）+1 分；重跑不重复；没归因的单不算。
func TestMerchantPointsCountHostedOrdersOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	biz, store := "biz_ip_"+stamp, "store_ip_"+stamp
	orders := []string{"o_ip1_" + stamp, "o_ip2_" + stamp, "o_ip3_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM fulfillment.orders WHERE id = ANY($1)`, orders)
		_, _ = pool.Exec(bg, `DELETE FROM business.stores WHERE id = $1`, store)
		_, _ = pool.Exec(bg, `DELETE FROM business.accounts WHERE id = $1`, biz)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id = $1`, "owner_"+biz)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',$2,$2)`, "owner_"+biz, now)
	exec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$3,'t','ACTIVE',$2)`, biz, now, "owner_"+biz)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at) VALUES ($1,$2,'s','a','ACTIVE',$3)`, store, biz, now)
	order := func(id, lifecycle, storeID string) {
		exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, snapshot, created_at, updated_at, store_id) VALUES ($1,'r','a','n','CONFIRMED','{}'::jsonb,$2,$2,$3)`, id, now, storeID)
		// 订单生命周期守卫：只能一步步走，且每步 version+1。
		exec(`UPDATE fulfillment.orders SET lifecycle = 'EXECUTING', version = version + 1 WHERE id = $1`, id)
		exec(`UPDATE fulfillment.orders SET lifecycle = $2, version = version + 1 WHERE id = $1`, id, lifecycle)
	}
	order(orders[0], "COMPLETED", store)
	order(orders[1], "COMPLETED", store)
	order(orders[2], "COMPLETED", "") // 没归因到店：不算
	st := identitytier.NewPostgres(pool)
	for i := 0; i < 2; i++ {
		if _, err := st.CollectMerchant(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	if pts, _ := st.Points(ctx, identitytier.Merchant, biz); pts != 2 {
		t.Fatalf("two attributed completed orders = 2 points, once each: %d", pts)
	}
}

// NUDGE-OPTOUT-001：退订的人不再出现在引导推送的候选里，恢复后回来。
func TestNudgeOptOutRemovesTheUserFromCandidates(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	user := "u_no_" + stamp
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM identity.user_accounts WHERE id = $1`, user)
	})
	now := time.Now().UTC()
	if _, err := pool.Exec(ctx, `INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'ACTIVE',$2,$2)`, user, now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	src := guidance.NewPostgres(pool)
	has := func() bool {
		ids, err := src.Candidates(ctx, now, 24*time.Hour, 7*24*time.Hour, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range ids {
			if id == user {
				return true
			}
		}
		return false
	}
	if on, _ := src.NudgesEnabled(ctx, user); !on || !has() {
		t.Fatal("by default the user is a candidate")
	}
	if err := src.SetNudgesEnabled(ctx, user, false, now); err != nil {
		t.Fatal(err)
	}
	if on, _ := src.NudgesEnabled(ctx, user); on || has() {
		t.Fatal("opted out = not a candidate")
	}
	if err := src.SetNudgesEnabled(ctx, user, true, now); err != nil {
		t.Fatal(err)
	}
	if !has() {
		t.Fatal("opting back in restores the nudges")
	}
}

// WEATHER-001：天气提醒的活动来源 —— 只取已发布、有结构化开始时间、场地有坐标、在时间窗口内的活动，带上发起人和报名的人。
func TestWeatherWatchUpcomingFindsOnlyStructuredPublishedActivities(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	scene := "sc_ww_" + stamp
	inWin, noStart, outWin := "act_ww1_"+stamp, "act_ww2_"+stamp, "act_ww3_"+stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id = ANY($1)`, []string{inWin, noStart, outWin})
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = ANY($1)`, []string{inWin, noStart, outWin})
		_, _ = pool.Exec(bg, `DELETE FROM reality.scenes WHERE id = $1`, scene)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO reality.scenes (id, name, area, type, latitude, longitude, best) VALUES ($1,'s','a','咖啡',21.0,105.8,'')`, scene)
	mk := func(id string, starts *time.Time) {
		payload := fmt.Sprintf(`{"activityId":"%s","title":"t","ownerId":"host_%s","status":"PUBLISHED","realitySceneId":"%s"`, id, stamp, scene)
		if starts != nil {
			payload += fmt.Sprintf(`,"startsAt":"%s","durationMinutes":120`, starts.Format(time.RFC3339))
		}
		exec(`INSERT INTO activity.activities (id, payload) VALUES ($1, $2::jsonb)`, id, payload+"}")
	}
	soon, far := now.Add(24*time.Hour), now.Add(72*time.Hour)
	mk(inWin, &soon)
	mk(noStart, nil)
	mk(outWin, &far)
	exec(`INSERT INTO activity.participants (activity_id, actor_id) VALUES ($1, $2)`, inWin, "guest_"+stamp)
	got, err := weatherwatch.NewPostgres(pool).Upcoming(ctx, now.Add(18*time.Hour), now.Add(30*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	var found *weatherwatch.Meeting
	for i := range got {
		switch got[i].ID {
		case inWin:
			found = &got[i]
		case noStart, outWin:
			t.Fatalf("%s must not be picked", got[i].ID)
		}
	}
	if found == nil || len(found.People) != 2 || found.Lat != 21.0 || found.DurationMin != 120 {
		t.Fatalf("the structured, in-window activity with host + guest: %+v", found)
	}
}

// 小美订单积分写进账本，口径与「我的权益」原来的实时算法一致：完成 50 / 完全满意 30 / 回头客 100（每位客户一次）。
func TestProviderOrderPointsMatchTheLiveFormulaAndCountOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	agent, c1, c2 := "ag_pp_"+stamp, "cl1_pp_"+stamp, "cl2_pp_"+stamp
	orders := []string{"o_pp1_" + stamp, "o_pp2_" + stamp, "o_pp3_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = $1`, agent)
		_, _ = pool.Exec(bg, `DELETE FROM fulfillment.orders WHERE id = ANY($1)`, orders)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	order := func(id, client, outcome string) {
		exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, snapshot, created_at, updated_at) VALUES ($1,$2,$3,'n','CONFIRMED','{}'::jsonb,$4,$4)`, id, client, agent, now)
		exec(`UPDATE fulfillment.orders SET lifecycle = 'EXECUTING', version = version + 1 WHERE id = $1`, id)
		exec(`UPDATE fulfillment.orders SET lifecycle = 'COMPLETED', version = version + 1, outcome = $2::jsonb WHERE id = $1`, id, outcome)
	}
	order(orders[0], c1, `{"satisfaction":{"resolved":"FULL"}}`)
	order(orders[1], c1, `{"satisfaction":{"resolved":"PARTIAL"}}`)
	order(orders[2], c2, `{}`)
	st := identitytier.NewPostgres(pool)
	for i := 0; i < 2; i++ {
		if _, err := st.CollectProvider(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	// 3 单 ×50 + 1 个完全满意 ×30 + 1 位回头客 ×100 = 280
	if pts, _ := st.Points(ctx, identitytier.Provider, agent); pts != 280 {
		t.Fatalf("3*50 + 1*30 + 1*100 = 280, once each: %d", pts)
	}
}

// WEATHER-001：需求的天气提醒来源 —— 只取已确认合作、带坐标和结构化开始时间、在窗口内的需求，发布人 + 确认的那位。
func TestWeatherWatchUpcomingIncludesConfirmedDemands(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	confirmed, open, noCoord := "opp_ww1_"+stamp, "opp_ww2_"+stamp, "opp_ww3_"+stamp
	all := []string{confirmed, open, noCoord}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.applications WHERE opportunity_id = ANY($1)`, all)
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.opportunities WHERE id = ANY($1)`, all)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	starts := now.Add(24 * time.Hour).Format(time.RFC3339)
	opp := func(id string, withCoord bool) {
		payload := fmt.Sprintf(`{"id":"%s","title":"周六同行","startsAt":"%s","durationMinutes":180`, id, starts)
		if withCoord {
			payload += `,"lat":21.05,"lng":105.82`
		}
		exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload) VALUES ($1,$2,$3::jsonb)`, id, "owner_"+stamp, payload+"}")
	}
	opp(confirmed, true)
	opp(open, true)
	opp(noCoord, false)
	app := func(oppID, applicant, status string) {
		exec(`INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
			"app_"+oppID+applicant, oppID, applicant, fmt.Sprintf(`{"status":"%s"}`, status), now)
	}
	app(confirmed, "xiaomei_"+stamp, "CONFIRMED")
	app(confirmed, "other_"+stamp, "PENDING")
	app(open, "xiaomei_"+stamp, "PENDING")
	app(noCoord, "xiaomei_"+stamp, "CONFIRMED")
	got, err := weatherwatch.NewPostgres(pool).Upcoming(ctx, now.Add(18*time.Hour), now.Add(30*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	var found *weatherwatch.Meeting
	for i := range got {
		switch got[i].ID {
		case "opp:" + confirmed:
			found = &got[i]
		case "opp:" + open, "opp:" + noCoord:
			t.Fatalf("%s must not be picked", got[i].ID)
		}
	}
	if found == nil || len(found.People) != 2 || found.DurationMin != 180 {
		t.Fatalf("confirmed demand with owner + the confirmed applicant only: %+v", found)
	}
}

// FOLLOW-LIST-001：关注列表落库、读得回来；「关注」tab 按作者取帖不依赖最近 25 条。
func TestFollowListPersistsAndFeedCanBeScopedToFollowedAuthors(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	viewer, followed, stranger := "u_fl_v_"+stamp, "u_fl_f_"+stamp, "u_fl_s_"+stamp
	posts := []string{"p_fl1_" + stamp, "p_fl2_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM engagement.follows WHERE follower_id = $1`, viewer)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = ANY($1)`, posts)
	})
	now := time.Now().UTC()
	for i, author := range []string{followed, stranger} {
		if _, err := pool.Exec(ctx, `INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status, visibility) VALUES ($1,'USER',$2,'x',$3,'PUBLISHED','PUBLIC')`, posts[i], author, now.Add(-time.Duration(i)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	eng := NewEngagementRepository(pool)
	if err := eng.AddFollow(ctx, engagement.Follow{FollowerID: viewer, FolloweeID: followed, CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	ids, err := eng.ListFollowing(ctx, viewer, 100)
	if err != nil || len(ids) != 1 || ids[0] != followed {
		t.Fatalf("the follow is in the database and reads back: %v %v", ids, err)
	}
	feed := NewLocalNetRepository(pool)
	got, err := feed.ListFeedPageByAuthors(ctx, "", []string{followed}, time.Time{}, "", 26)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range got {
		if p.AuthorID != followed {
			t.Fatalf("only the followed author's posts: %s", p.AuthorID)
		}
	}
	found := false
	for _, p := range got {
		found = found || p.ID == posts[0]
	}
	if !found {
		t.Fatal("the followed author's post is there")
	}
}

// 读自己的成长值时可以只补算自己（CollectUserFor），且和全量收集互不重复。
func TestCollectUserForOnlyCreditsThatUserAndNeverDoubleCounts(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	mine, other := "u_cf_m_"+stamp, "u_cf_o_"+stamp
	users := []string{mine, other}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM identity.profiles WHERE user_account_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id = ANY($1)`, users)
	})
	now := time.Now().UTC()
	for _, u := range users {
		// 真实注册出来的账号状态是 REGISTERED（不是 ACTIVE）：收集器必须认它，否则真实用户永远 0 分。
		if _, err := pool.Exec(ctx, `INSERT INTO identity.user_accounts (id, status, created_at, updated_at) VALUES ($1,'REGISTERED',$2,$2)`, u, now.Add(-72*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO identity.profiles (user_account_id, name, handle, city, avatar_path, updated_at) VALUES ($1,'N','h_`+u+`','HN','assets/x',$2)`, u, now); err != nil {
			t.Fatal(err)
		}
	}
	st := identitytier.NewPostgres(pool)
	if _, err := st.CollectUserFor(ctx, mine, now); err != nil {
		t.Fatal(err)
	}
	if a, _ := st.Points(ctx, identitytier.User, mine); a != 30 {
		t.Fatalf("my profile points: %d", a)
	}
	if b, _ := st.Points(ctx, identitytier.User, other); b != 0 {
		t.Fatalf("someone else is not touched: %d", b)
	}
	if _, err := st.CollectUser(ctx, now); err != nil {
		t.Fatal(err)
	}
	if a, _ := st.Points(ctx, identitytier.User, mine); a != 30 {
		t.Fatalf("collecting everyone afterwards does not double count: %d", a)
	}
	if _, err := st.CollectProviderFor(ctx, mine, now); err != nil {
		t.Fatal(err)
	}
}

// TREASURE-001：寻宝落库流程 —— 投放一个场景一个箱子；到店才能开；每人每箱一次；容量；成长值进账本；
// 「下单小美」才有的同行加成：必须是已确认、带小美的报名，每单一次。
func TestTreasureSoloAndCompanionOpensOnRealDB(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	scene := "sc_tr_" + stamp
	user, other := "u_tr_a_"+stamp, "u_tr_b_"+stamp
	act := "act_tr_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = ANY($1)`, []string{user, other})
		_, _ = pool.Exec(bg, `DELETE FROM treasure.opens WHERE user_id = ANY($1)`, []string{user, other})
		_, _ = pool.Exec(bg, `DELETE FROM treasure.chests WHERE scene_id = $1`, scene)
		_, _ = pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id = $1`, act)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = $1`, act)
		_, _ = pool.Exec(bg, `DELETE FROM reality.scenes WHERE id = $1`, scene)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	const lat, lng = 21.2, 106.05
	exec(`INSERT INTO reality.scenes (id, name, area, type, latitude, longitude, best) VALUES ($1,'Tr Cafe','a','咖啡 · 店招',$2,$3,'')`, scene, lat, lng)
	tr := treasure.NewPostgres(pool)
	if _, err := tr.Spawn(ctx, now); err != nil {
		t.Fatal(err)
	}
	var chestID string
	if err := pool.QueryRow(ctx, `SELECT id FROM treasure.chests WHERE scene_id = $1 AND status = 'ACTIVE'`, scene).Scan(&chestID); err != nil {
		t.Fatalf("a coffee scene gets a live chest: %v", err)
	}
	if n, _ := tr.Spawn(ctx, now); n != 0 {
		var c int
		_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.chests WHERE scene_id = $1 AND status = 'ACTIVE'`, scene).Scan(&c)
		if c != 1 {
			t.Fatalf("one live chest per scene: %d", c)
		}
	}
	here := treasure.Location{Lat: lat, Lng: lng, AccuracyM: 10}
	far := treasure.Location{Lat: lat + 0.01, Lng: lng, AccuracyM: 10}
	if _, err := tr.OpenSolo(ctx, user, chestID, far, now); err != treasure.ErrTooFar {
		t.Fatalf("1km away cannot open: %v", err)
	}
	res, err := tr.OpenSolo(ctx, user, chestID, here, now)
	if err != nil || res.Points != treasure.SoloPoints || res.Total != treasure.SoloPoints {
		t.Fatalf("open at the store: %+v %v", res, err)
	}
	if _, err := tr.OpenSolo(ctx, user, chestID, here, now); err != treasure.ErrAlreadyOpened {
		t.Fatalf("one open per chest per person: %v", err)
	}
	if _, err := tr.OpenSolo(ctx, other, chestID, here, now); err != nil {
		t.Fatalf("someone else can still open it: %v", err)
	}

	// 同行加成：没有带小美的确认报名 → 不行；有 → 行一次。
	if _, err := tr.OpenCompanion(ctx, user, act, "xiaomei_1", here, now); err != treasure.ErrNotEligible {
		t.Fatalf("no booking, no bonus: %v", err)
	}
	exec(`INSERT INTO activity.activities (id, payload) VALUES ($1, $2::jsonb)`, act, fmt.Sprintf(`{"activityId":"%s","title":"周六咖啡","status":"PUBLISHED","realitySceneId":"%s","startsAt":"%s"}`, act, scene, now.Add(30*time.Minute).Format(time.RFC3339)))
	exec(`INSERT INTO activity.participants (activity_id, actor_id, state, companion_id) VALUES ($1,$2,'CONFIRMED','xiaomei_1')`, act, user)
	nb, err := tr.Nearby(ctx, user, lat, lng, now)
	if err != nil || len(nb.Bookings) != 1 || nb.Bookings[0].Points != treasure.CompanionPts {
		t.Fatalf("the booking shows up as a bonus chest: %+v %v", nb.Bookings, err)
	}
	res, err = tr.OpenCompanion(ctx, user, act, "xiaomei_1", here, now)
	if err != nil || res.Points != treasure.CompanionPts || res.Total != treasure.SoloPoints+treasure.CompanionPts {
		t.Fatalf("companion open: %+v %v", res, err)
	}
	if _, err := tr.OpenCompanion(ctx, user, act, "xiaomei_1", here, now); err != treasure.ErrAlreadyOpened {
		t.Fatalf("one bonus per booking: %v", err)
	}
	// 别人拿不到这一单的加成。
	if _, err := tr.OpenCompanion(ctx, other, act, "xiaomei_1", here, now); err != treasure.ErrNotEligible {
		t.Fatalf("someone else's booking is not mine: %v", err)
	}
}

type fakeClaimer struct {
	n    int
	fail bool
}

func (f *fakeClaimer) Claim(_ context.Context, userID, campaignID, benefitID string) (string, error) {
	if f.fail {
		return "", fmt.Errorf("capacity")
	}
	f.n++
	return fmt.Sprintf("clm_%d_%s", f.n, userID), nil
}

// TREASURE-002：有奖品的场景，箱子带券位，开箱抽中咖啡券；同行加成必出券；领券失败要把名额退回。
func TestTreasurePrizesDropCoffeeVouchers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	scene := "sc_tp_" + stamp
	users := []string{"u_tp_a_" + stamp, "u_tp_b_" + stamp, "u_tp_c_" + stamp}
	act := "act_tp_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM growth.point_ledger WHERE subject_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM treasure.opens WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM treasure.chests WHERE scene_id = $1`, scene)
		_, _ = pool.Exec(bg, `DELETE FROM treasure.prizes WHERE scene_id = $1`, scene)
		_, _ = pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id = $1`, act)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = $1`, act)
		_, _ = pool.Exec(bg, `DELETE FROM reality.scenes WHERE id = $1`, scene)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	const lat, lng = 21.3, 106.1
	exec(`INSERT INTO reality.scenes (id, name, area, type, latitude, longitude, best) VALUES ($1,'Tp Cafe','a','咖啡 · 店招',$2,$3,'')`, scene, lat, lng)
	tr := treasure.NewPostgres(pool)
	claimer := &fakeClaimer{}
	tr.Claimer = claimer
	here := treasure.Location{Lat: lat, Lng: lng, AccuracyM: 8}

	// 没有奖品：箱子只给成长值。
	if _, err := tr.Spawn(ctx, now); err != nil {
		t.Fatal(err)
	}
	var slots int
	_ = pool.QueryRow(ctx, `SELECT prize_slots FROM treasure.chests WHERE scene_id = $1 AND status = 'ACTIVE'`, scene).Scan(&slots)
	if slots != 0 {
		t.Fatalf("no prize, no voucher slots: %d", slots)
	}
	exec(`UPDATE treasure.chests SET status = 'EXPIRED' WHERE scene_id = $1`, scene)

	// 有奖品（总量 3）：新箱子带 2 个券位、分数更高；容量改成 2，开两个人必出两张。
	if _, err := tr.CreatePrize(ctx, scene, "camp_x", "ben_x", "免费美式一杯", 3, "op", now); err != nil {
		t.Fatal(err)
	}
	if _, err := tr.CreatePrize(ctx, scene, "camp_y", "ben_y", "第二个", 3, "op", now); err != treasure.ErrPrizeExists {
		t.Fatalf("one live prize per scene: %v", err)
	}
	if _, err := tr.Spawn(ctx, now); err != nil {
		t.Fatal(err)
	}
	var chestID string
	var pts int
	if err := pool.QueryRow(ctx, `SELECT id, prize_slots, points FROM treasure.chests WHERE scene_id = $1 AND status = 'ACTIVE'`, scene).Scan(&chestID, &slots, &pts); err != nil {
		t.Fatal(err)
	}
	if slots != treasure.PrizeSlotsPerChest || pts != treasure.PrizePoints {
		t.Fatalf("a prize chest is gold: slots=%d points=%d", slots, pts)
	}
	exec(`UPDATE treasure.chests SET capacity = 2 WHERE id = $1`, chestID)
	nb, _ := tr.Nearby(ctx, users[0], lat, lng, now)
	if len(nb.Chests) == 0 || nb.Chests[0].PrizeLabel != "免费美式一杯" || nb.Chests[0].PrizeSlots != 2 {
		t.Fatalf("the chest advertises its prize: %+v", nb.Chests)
	}
	r1, err := tr.OpenSolo(ctx, users[0], chestID, here, now)
	if err != nil || r1.ClaimID == "" || r1.PrizeLabel != "免费美式一杯" || r1.Points != treasure.PrizePoints {
		t.Fatalf("first opener gets the coffee voucher (slots>=remaining): %+v %v", r1, err)
	}
	r2, err := tr.OpenSolo(ctx, users[1], chestID, here, now)
	if err != nil || r2.ClaimID == "" {
		t.Fatalf("second opener too: %+v %v", r2, err)
	}
	var awarded int
	_ = pool.QueryRow(ctx, `SELECT awarded FROM treasure.prizes WHERE scene_id = $1`, scene).Scan(&awarded)
	if awarded != 2 {
		t.Fatalf("the prize pool counts what was handed out: %d", awarded)
	}

	// 同行加成：奖品还剩 1 个 → 必出；再来一次领券失败 → 名额退回、成长值照给。
	exec(`INSERT INTO activity.activities (id, payload) VALUES ($1, $2::jsonb)`, act, fmt.Sprintf(`{"activityId":"%s","title":"周六咖啡","status":"PUBLISHED","realitySceneId":"%s","startsAt":"%s"}`, act, scene, now.Add(20*time.Minute).Format(time.RFC3339)))
	exec(`INSERT INTO activity.participants (activity_id, actor_id, state, companion_id) VALUES ($1,$2,'CONFIRMED','xm_1'),($1,$3,'CONFIRMED','xm_2')`, act, users[2], users[0])
	c1, err := tr.OpenCompanion(ctx, users[2], act, "xm_1", here, now)
	if err != nil || c1.ClaimID == "" || c1.PrizeLabel != "免费美式一杯" {
		t.Fatalf("a booking with a 小美 always gets the voucher while stock lasts: %+v %v", c1, err)
	}
	tr.Claimer = &fakeClaimer{fail: true}
	exec(`UPDATE treasure.prizes SET quota = quota + 2 WHERE scene_id = $1`, scene)
	before := awarded + 1
	c2, err := tr.OpenCompanion(ctx, users[0], act, "xm_2", here, now.Add(time.Minute))
	if err != nil || c2.ClaimID != "" || c2.Points != treasure.CompanionPts {
		t.Fatalf("a failed claim still pays the points and hands out no voucher: %+v %v", c2, err)
	}
	_ = pool.QueryRow(ctx, `SELECT awarded FROM treasure.prizes WHERE scene_id = $1`, scene).Scan(&awarded)
	if awarded != before {
		t.Fatalf("the reserved prize was given back: awarded=%d want %d", awarded, before)
	}
}
