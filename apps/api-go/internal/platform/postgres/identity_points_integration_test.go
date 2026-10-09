package postgres

// IDENTITY-POINTS-001 对真库：固定规则把用户做过的事折成积分（幂等、发帖每天最多 3 条）；
// 账本不能改；按分数开的奖励活动只发给到线的人，成长值奖励进账本。

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/guidance"
	"github.com/proxy-app/proxy-api/internal/identitytier"
	"github.com/proxy-app/proxy-api/internal/incentive"
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
