package postgres

// TAG-SYSTEM-001：标签层对真库跑——证据只来自「有同意的事实」，撤回之后标签被清掉，
// 粗粒度位置要两道同意都在。纯规则（强度 / 置信度 / 门槛）在 internal/tagging 里测。

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/tagging"
)

func TestTagLayerOnlyBuildsFromConsentedFactsAndClearsOnWithdrawal(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	granted, never, withdrawn, explicit, located, noLoc := "u_tag_g_"+stamp, "u_tag_n_"+stamp, "u_tag_w_"+stamp, "u_tag_e_"+stamp, "u_tag_l_"+stamp, "u_tag_nl_"+stamp
	users := []string{granted, never, withdrawn, explicit, located, noLoc}
	posts := []string{"p_tag_c_" + stamp}
	activity := "a_tag_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM tag.coarse_locations WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM location.location_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM activity.interests WHERE activity_id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = ANY($1)`, posts)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, scene_type) VALUES ($1,'USER','someone','新发现一家咖啡店',$2,'UNKNOWN')`, posts[0], now)
	exec(`INSERT INTO activity.activities (id, payload) VALUES ($1, '{"category":"HIKING"}'::jsonb)`, activity)

	consent := func(user, action string, at time.Time) {
		exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source)
			VALUES ($1,$2,'RECOMMENDATION','2026-10-08',$3,$4,'TEST')`, fmt.Sprintf("pc_%s_%s_%d", user, action, at.UnixNano()), user, action, at)
	}
	impressions := func(user string, n int) {
		for i := 0; i < n; i++ {
			exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms)
				VALUES ($1,'POST_IMPRESSION',$2,'POST',$3,$4,20000)`, fmt.Sprintf("evt_%s_%d", user, i), user, posts[0], now.Add(-time.Duration(i+1)*time.Hour))
		}
	}
	consent(granted, "GRANT", now.Add(-72*time.Hour))
	impressions(granted, 6)
	impressions(never, 6) // 从没同意过
	consent(withdrawn, "GRANT", now.Add(-72*time.Hour))
	impressions(withdrawn, 6)

	// 主动表态：不需要浏览同意。
	exec(`INSERT INTO activity.interests (activity_id, actor_id, created_at) VALUES ($1,$2,$3)`, activity, explicit, now.Add(-time.Hour))

	// 位置：located 两道同意都在；noLoc 只有采集同意。
	consent(located, "GRANT", now.Add(-72*time.Hour))
	consent(noLoc, "GRANT", now.Add(-72*time.Hour))
	exec(`INSERT INTO location.location_consents (id, user_id, kind, status, granted_at, expires_at, duration_seconds)
		VALUES ($1,$2,'FUZZY_REGION','GRANTED',$3,$4,86400)`, "lc_"+stamp, located, now.Add(-2*time.Hour), now.Add(24*time.Hour))
	for _, u := range []string{located, noLoc} {
		for d := 0; d < 4; d++ {
			exec(`INSERT INTO tag.coarse_locations (user_id, cell, observed_at) VALUES ($1,'21.03,105.85',$2)`, u, now.Add(-time.Duration(d)*24*time.Hour-time.Hour))
		}
	}

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	has := func(user, axis, value string) bool {
		tags, err := store.TagsOf(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		for _, tg := range tags {
			if tg.Axis == axis && tg.Value == value {
				return true
			}
		}
		return false
	}
	if !has(granted, tagging.AxisInterestTopic, "drink/coffee") {
		t.Fatal("six consented, long-dwell impressions on COFFEE posts must give an interest tag")
	}
	if has(never, tagging.AxisInterestTopic, "drink/coffee") {
		t.Fatal("events without any consent must never become a tag")
	}
	if !has(withdrawn, tagging.AxisInterestTopic, "drink/coffee") {
		t.Fatal("before withdrawal she has the tag")
	}
	if !has(explicit, tagging.AxisInterestActivity, "HIKING") {
		t.Fatal("an explicit 'interested' needs no browsing consent and gives an activity tag")
	}
	if !has(located, tagging.AxisArea, "21.03,105.85") {
		t.Fatal("4 distinct days under both consents is an area tag")
	}
	if has(noLoc, tagging.AxisArea, "21.03,105.85") {
		t.Fatal("without a live location consent the coarse cells must not become a tag")
	}

	// 撤回：下一轮重算必须把她已有的标签清掉（她不在「最近有证据的人」里，但在「有标签的人」里）。
	consent(withdrawn, "WITHDRAW", now.Add(time.Second))
	if _, err := tagging.Recompute(ctx, store, now.Add(2*time.Second)); err != nil {
		t.Fatalf("Recompute after withdrawal: %v", err)
	}
	if has(withdrawn, tagging.AxisInterestTopic, "drink/coffee") {
		t.Fatal("withdrawn consent must clear the tag on the next recompute")
	}
	if !has(granted, tagging.AxisInterestTopic, "drink/coffee") {
		t.Fatal("the other user's tag must survive")
	}
	stats, err := store.Stats(ctx, now.Add(2*time.Second))
	if err != nil || stats.UsersWithTags < 3 {
		t.Fatalf("stats: %+v err=%v", stats, err)
	}
}

// 账户删除要把派生出来的「这个人」一起删掉：用户标签 + 粗粒度位置观测。
func TestAccountErasureDeletesTagsAndCoarseLocations(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	user := "u_tag_erase_" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM tag.user_tags WHERE user_id = $1`, user)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tag.coarse_locations WHERE user_id = $1`, user)
	})
	now := time.Now().UTC()
	store := tagging.NewPostgres(pool)
	if err := store.ReplaceUserTags(ctx, user, []tagging.Tag{{Axis: tagging.AxisInterestTopic, Value: "COFFEE", Strength: .5, Confidence: .5, Source: tagging.SourceBehavior,
		EvidenceCount: 5, SourceDiversity: 1, FirstSeen: now, LastSeen: now, ExpiresAt: now.Add(time.Hour), ComputedAt: now, RuleVersion: tagging.RuleVersion}}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordCoarseCell(ctx, user, "21.03,105.85", now); err != nil {
		t.Fatal(err)
	}
	receipt, err := NewIdentityRepository(pool).EraseCrossAggregateIdentity(ctx, user)
	if err != nil {
		t.Fatalf("erase: %v", err)
	}
	if receipt.UserTags != 1 || receipt.CoarseLocations != 1 {
		t.Fatalf("receipt must count what it deleted: %+v", receipt)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM tag.user_tags WHERE user_id=$1) + (SELECT count(*) FROM tag.coarse_locations WHERE user_id=$1)`, user).Scan(&n)
	if n != 0 {
		t.Fatalf("%d derived rows survived the erasure", n)
	}
}

// TAG-SYSTEM-002：细粒度标签对真库。显式场所行为（不需要浏览同意）一条就出 店 / 类型 / 风格 / 区；
// 创作者偏好是被动的，要同意；声明的服务能力 / 语种来自接单资料。
func TestFineGrainedTagsFromVenuesCreatorsAndDeclaredProfile(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	saver, watcher, noConsentWatcher, provider, dwellOnly := "u_ft_s_"+stamp, "u_ft_w_"+stamp, "u_ft_n_"+stamp, "u_ft_p_"+stamp, "u_ft_d_"+stamp
	users := []string{saver, watcher, noConsentWatcher, provider, dwellOnly}
	author := "u_ft_author_" + stamp
	post := "p_ft_" + stamp
	agent := "agent_ft_" + stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM reality.user_scene_states WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = $1`, post)
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_services WHERE agent_id = $1`, agent)
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id = $1`, agent)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()

	// 两家咖啡店 + 一家餐厅，saver 都收藏了；餐厅只有一条。
	exec(`INSERT INTO reality.user_scene_states (actor_id, scene_id, saved, planned, created_at, updated_at) VALUES ($1,'cafe_giang',true,false,$2,$2),($1,'cafe_dinh',true,true,$2,$2),($1,'buncha_ta',true,false,$2,$2)`, saver, now.Add(-time.Hour))

	// 创作者偏好：被动，要同意。watcher 同意了，noConsentWatcher 没有。
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, scene_type) VALUES ($1,'USER',$2,'x',$3,'COFFEE')`, post, author, now)
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_ft_"+stamp, watcher, now.Add(-72*time.Hour))
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_ftd_"+stamp, dwellOnly, now.Add(-72*time.Hour))
	// TAG-DWELL-001：创作者偏好只认主动点进主页；信息流里停得久（dwellOnly）不给创作者加分。
	for _, u := range []string{watcher, noConsentWatcher} {
		for i := 0; i < 6; i++ {
			exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'PROFILE_OPEN',$2,'PROFILE',$3,$4,0)`,
				fmt.Sprintf("evt_ftpo_%s_%d", u, i), u, author, now.Add(-time.Duration(i+1)*time.Hour))
		}
	}
	for _, u := range []string{watcher, noConsentWatcher, dwellOnly} {
		for i := 0; i < 4; i++ {
			exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'POST_IMPRESSION',$2,'POST',$3,$4,40000)`,
				fmt.Sprintf("evt_ft_%s_%d", u, i), u, post, now.Add(-time.Duration(i+1)*time.Hour))
		}
	}

	// 声明：接单资料。
	exec(`INSERT INTO supply.agent_profiles (agent_id, name, languages, status, created_at, updated_at, user_account_id) VALUES ($1,'t','["ZH","vi"]'::jsonb,'ACTIVE',$2,$2,$3)`, agent, now, provider)
	exec(`INSERT INTO supply.agent_services (agent_id, service_type, status, updated_at, vertical_tags) VALUES ($1,'CITY_COMPANION','ACTIVE',$2,'["RESTAURANT"]'::jsonb)`, agent, now)

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	has := func(user, axis, value string) bool {
		tags, err := store.TagsOf(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		for _, tg := range tags {
			if tg.Axis == axis && tg.Value == value {
				return true
			}
		}
		return false
	}
	for _, want := range [][2]string{
		{tagging.AxisVenueFavorite, "cafe_giang"}, {tagging.AxisVenueFavorite, "cafe_dinh"}, {tagging.AxisVenueFavorite, "buncha_ta"},
		{tagging.AxisVenueKind, "咖啡"}, {tagging.AxisVenueStyle, "店招"}, {tagging.AxisDistrict, "Hoàn_Kiếm"},
	} {
		if !has(saver, want[0], want[1]) {
			t.Errorf("saver should have %s:%s", want[0], want[1])
		}
	}
	if !has(saver, tagging.AxisVenueKind, "餐厅") {
		t.Error("even a single saved restaurant gives a (low-confidence) kind tag")
	}
	if !has(watcher, tagging.AxisCreatorAffinity, author) {
		t.Error("a consenting viewer who opened one creator's profile several times has a creator-affinity tag")
	}
	if has(dwellOnly, tagging.AxisCreatorAffinity, author) {
		t.Error("passive dwell on a person's posts must not become a taste tag")
	}
	if has(noConsentWatcher, tagging.AxisCreatorAffinity, author) {
		t.Error("without consent, passive viewing must not become a tag")
	}
	for _, want := range [][2]string{{tagging.AxisSkill, "CITY_COMPANION"}, {tagging.AxisSkill, "RESTAURANT"}, {tagging.AxisLanguage, "zh"}, {tagging.AxisLanguage, "vi"}} {
		if !has(provider, want[0], want[1]) {
			t.Errorf("declared profile should give %s:%s", want[0], want[1])
		}
	}
}

// TAG-SYSTEM-003：内容话题（看过 + 自己发过）与交易侧标签对真库；画像按轴汇总、余弦相似度能区分近远。
func TestTopicAndOrderTagsBuildAFinePictureAndCosineSeparatesPeople(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	poster, viewer, buyer, stranger := "u_tp_a_"+stamp, "u_tp_v_"+stamp, "u_tp_b_"+stamp, "u_tp_x_"+stamp
	agent := "u_tp_agent_" + stamp
	users := []string{poster, viewer, buyer, stranger, agent}
	posts := []string{"p_tp1_" + stamp, "p_tp2_" + stamp}
	orders := []string{"o_tp1_" + stamp, "o_tp2_" + stamp}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = ANY($1)`, posts)
		_, _ = pool.Exec(bg, `DELETE FROM fulfillment.orders WHERE id = ANY($1)`, orders)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()

	// poster 发了两篇带话题的帖子（主动）：摄影 + 徒步 / 咖啡 + 摄影。
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status) VALUES ($1,'USER',$2,'周末去爬山，路上拍了好多照片 #摄影',$3,'PUBLISHED'),($4,'USER',$2,'新发现一家咖啡店，出片很好看',$3,'PUBLISHED')`, posts[0], poster, now.Add(-2*time.Hour), posts[1])
	// viewer 同意后各看了两篇 40 秒。
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_tp_"+stamp, viewer, now.Add(-72*time.Hour))
	for i, pid := range []string{posts[0], posts[1], posts[0], posts[1]} {
		exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'POST_IMPRESSION',$2,'POST',$3,$4,40000)`,
			fmt.Sprintf("evt_tp_%s_%d", stamp, i), viewer, pid, now.Add(-time.Duration(i+1)*time.Hour))
	}
	// buyer 下了两单（150K / 周六晚），agent 完成了其中一单。
	snap := func(sku string, amount int64) string {
		return fmt.Sprintf(`{"serviceSku":%q,"agreedCompensation":%d,"scenario":"ordinary","startTime":"2026-10-10T13:00:00Z"}`, sku, amount)
	}
	exec(`INSERT INTO fulfillment.orders (id, requester_id, agent_id, need_id, lifecycle, snapshot, created_at, updated_at) VALUES ($1,$2,$3,'n1','CONFIRMED',$4::jsonb,$5,$5),($6,$2,$3,'n2','CONFIRMED',$7::jsonb,$5,$5)`,
		orders[0], buyer, agent, snap("CITY_COMPANION", 150000), now.Add(-time.Hour), orders[1], snap("CITY_COMPANION", 200000))
	// 订单只能以 OFFERED / CONFIRMED 开头（库里有 guard）；完成要走状态转移。
	exec(`UPDATE fulfillment.orders SET lifecycle = 'EXECUTING', version = version + 1, updated_at = $2 WHERE id = $1`, orders[0], now.Add(-45*time.Minute))
	exec(`UPDATE fulfillment.orders SET lifecycle = 'COMPLETED', version = version + 1, updated_at = $2 WHERE id = $1`, orders[0], now.Add(-30*time.Minute))

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	tagsOf := func(u string) []tagging.Tag {
		tags, err := store.TagsOf(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		return tags
	}
	has := func(u, axis, value string) bool {
		for _, tg := range tagsOf(u) {
			if tg.Axis == axis && tg.Value == value {
				return true
			}
		}
		return false
	}
	for _, topic := range []string{"photography", "outdoor/mountain", "drink/coffee"} {
		if !has(viewer, tagging.AxisInterestTopic, topic) {
			t.Errorf("viewer dwelt on posts about %s: should have the topic tag", topic)
		}
	}
	if !has(poster, tagging.AxisInterestTopic, "photography") {
		t.Error("poster wrote two posts touching 摄影 (explicit)")
	}
	if has(stranger, tagging.AxisInterestTopic, "photography") {
		t.Error("someone who never saw or wrote anything has no topic tags")
	}
	for _, want := range [][2]string{{tagging.AxisOrderService, "CITY_COMPANION"}, {tagging.AxisPriceBand, "100K_300K"}, {tagging.AxisOrderScenario, "ordinary"}, {tagging.AxisTimeSlot, "WEEKEND_EVENING"}} {
		if !has(buyer, want[0], want[1]) {
			t.Errorf("buyer should have %s:%s", want[0], want[1])
		}
	}
	if !has(agent, tagging.AxisExpertiseService, "CITY_COMPANION") {
		t.Error("the agent completed an order: expertise tag")
	}

	now = time.Now().UTC()
	close, far := tagging.Affinity(tagsOf(poster), tagsOf(viewer), now), tagging.Affinity(tagsOf(poster), tagsOf(buyer), now)
	if close <= far {
		t.Errorf("poster and viewer share topics; poster and buyer share nothing: close=%v far=%v", close, far)
	}
	if p := tagging.BuildProfile(viewer, tagsOf(viewer), 5); p.AxisCount == 0 || p.Summary == "" {
		t.Errorf("viewer should have a non-empty profile: %+v", p)
	}
}

// 行为体系：互动（赞/评/转/藏）、活动（感兴趣/报名/看）、市场需求（发/报名）都按条目正文归主题，
// 主动行为不需要浏览同意；每个主动行为都带主题标签。
func TestEveryBehaviourSourceFeedsTopicTags(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	liker, joiner, publisher, applicant, author := "u_bs_l_"+stamp, "u_bs_j_"+stamp, "u_bs_p_"+stamp, "u_bs_a_"+stamp, "u_bs_au_"+stamp
	users := []string{liker, joiner, publisher, applicant, author}
	post, activity, opp := "p_bs_"+stamp, "a_bs_"+stamp, "opp_bs_"+stamp
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM engagement.reactions WHERE post_id = $1`, post)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.posts WHERE id = $1`, post)
		_, _ = pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM activity.activities WHERE id = $1`, activity)
		_, _ = pool.Exec(bg, `DELETE FROM marketplace.opportunities WHERE id = $1`, opp)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, created_at, status) VALUES ($1,'USER',$2,'周末去爬山',$3,'PUBLISHED')`, post, author, now)
	exec(`INSERT INTO engagement.reactions (id, post_id, actor_id, kind, created_at) VALUES ($1,$2,$3,'LIKE',$4)`, "rx_"+stamp, post, liker, now)
	exec(`INSERT INTO activity.activities (id, payload) VALUES ($1,$2::jsonb)`, activity, `{"title":"咖啡拉花体验课","category":"WORKSHOP"}`)
	exec(`INSERT INTO activity.participants (activity_id, actor_id, joined_at) VALUES ($1,$2,$3)`, activity, joiner, now)
	exec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, created_at) VALUES ($1,$2,$3::jsonb,$4)`, opp, publisher, `{"title":"找人一起摄影","theme":"摄影搭子"}`, now)
	exec(`INSERT INTO marketplace.applications (id, opportunity_id, applicant_id, payload, created_at) VALUES ($1,$2,$3,'{"status":"SUBMITTED"}'::jsonb,$4)`, "app_bs_"+stamp, opp, applicant, now)

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	hasTopic := func(user, label string) bool {
		tags, _ := store.TagsOf(ctx, user)
		for _, tg := range tags {
			if tg.Axis == tagging.AxisInterestTopic && tg.Value == label {
				return true
			}
		}
		return false
	}
	for who, label := range map[string]string{liker: "outdoor/mountain", joiner: "drink/coffee", publisher: "photography", applicant: "photography"} {
		if !hasTopic(who, label) {
			t.Errorf("%s should have the topic %q from an active behaviour", who, label)
		}
	}
}

// 应用使用与聊天风格：被动行为过同意；聊天只用元数据，插入的消息正文是空的也能出标签。
func TestUsageAndChatPatternsFromConsentedEventsAndMessageMetadata(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	heavy, nobody, peer := "u_up_h_"+stamp, "u_up_n_"+stamp, "u_up_p_"+stamp
	users := []string{heavy, nobody, peer}
	conv := make([]string, 0, 4)
	for i := 0; i < 4; i++ {
		conv = append(conv, fmt.Sprintf("conv_up_%d_%s", i, stamp))
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM conversation.messages WHERE conversation_id = ANY($1)`, conv)
		_, _ = pool.Exec(bg, `DELETE FROM conversation.conversations WHERE id = ANY($1)`, conv)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_up_"+stamp, heavy, now.Add(-72*time.Hour))
	// 5 个活跃日，每天一个 40 分钟会话；市场屏停留 8 分钟，首页 1 分钟。
	for d := 0; d < 5; d++ {
		exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'APP_SESSION',$2,'APP','app',$3,2400000)`,
			fmt.Sprintf("evt_up_s%d_%s", d, stamp), heavy, now.Add(-time.Duration(d)*24*time.Hour-time.Hour))
	}
	exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'SCREEN_VIEW',$2,'SCREEN','market',$3,480000),($4,'SCREEN_VIEW',$2,'SCREEN','home',$3,60000)`,
		"evt_up_m_"+stamp, heavy, now.Add(-time.Hour), "evt_up_h_"+stamp)
	// 没同意的人：同样的事件不产生标签。
	for d := 0; d < 5; d++ {
		exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'APP_SESSION',$2,'APP','app',$3,2400000)`,
			fmt.Sprintf("evt_up_n%d_%s", d, stamp), nobody, now.Add(-time.Duration(d)*24*time.Hour-time.Hour))
	}
	// 聊天：4 个会话都是 heavy 先开口，之后双方来回；正文留空（只测元数据）。
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_up2_"+stamp, peer, now.Add(-72*time.Hour))
	n := 0
	for ci, c := range conv {
		exec(`INSERT INTO conversation.conversations (id, type, origin_type, origin_id, participants, created_at, last_message_at) VALUES ($1,'DIRECT','TEST','t','[]'::jsonb,$2,$2)`, c, now.Add(-48*time.Hour))
		base := now.Add(-time.Duration(40-ci) * time.Hour)
		for k := 0; k < 8; k++ {
			sender := heavy
			if k%2 == 1 {
				sender = peer
			}
			n++
			exec(`INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, body, created_at) VALUES ($1,$2,$3,'TEXT','',$4)`,
				fmt.Sprintf("msg_up_%d_%s", n, stamp), c, sender, base.Add(time.Duration(k)*2*time.Minute))
		}
	}
	// 凑够 30 条：heavy 再发 2 条/会话以上不必——4*4=16 条；加一轮。
	for ci, c := range conv {
		for k := 0; k < 4; k++ {
			n++
			exec(`INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, body, created_at) VALUES ($1,$2,$3,'TEXT','',$4)`,
				fmt.Sprintf("msg_up_%d_%s", n, stamp), c, heavy, now.Add(-time.Duration(30-ci)*time.Hour).Add(time.Duration(k)*time.Minute))
		}
	}
	exec(`UPDATE conversation.messages SET sender_id = $1 WHERE id LIKE 'msg_up_%' || $2 AND sender_id = $3 AND false`, heavy, stamp, peer)

	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	has := func(u, v string) bool {
		tags, _ := store.TagsOf(ctx, u)
		for _, tg := range tags {
			if tg.Axis == tagging.AxisPattern && tg.Value == v {
				return true
			}
		}
		return false
	}
	for _, want := range []string{"usage/intensity/heavy", "usage/focus/market", "chat/initiator"} {
		if !has(heavy, want) {
			t.Errorf("heavy user should have %s", want)
		}
	}
	if has(heavy, "usage/focus/home") {
		t.Error("home is under a quarter of the dwell")
	}
	if has(nobody, "usage/intensity/heavy") {
		t.Error("without consent app usage must not become a tag")
	}
}

// TAG-DWELL-001：场景详情页的停留（被动，过同意）按场景类型归主题；没同意不出标签。
func TestSceneDetailDwellFeedsTopicTagsOnlyWithConsent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	consenting, silent := "u_sd_c_"+stamp, "u_sd_n_"+stamp
	users := []string{consenting, silent}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM tag.user_tags WHERE user_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM localnet.interaction_events WHERE actor_id = ANY($1)`, users)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.purpose_consents WHERE user_id = ANY($1)`, users)
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	now := time.Now().UTC()
	var sceneID string
	if err := pool.QueryRow(ctx, `SELECT id FROM reality.scenes WHERE status = 'ACTIVE' AND type LIKE '咖啡%' LIMIT 1`).Scan(&sceneID); err != nil {
		t.Skip("no coffee scene in this database")
	}
	exec(`INSERT INTO privacy.purpose_consents (id, user_id, purpose, policy_version, action, acted_at, source) VALUES ($1,$2,'RECOMMENDATION','2026-10-08','GRANT',$3,'TEST')`, "pc_sd_"+stamp, consenting, now.Add(-72*time.Hour))
	for _, u := range users {
		for i := 0; i < 5; i++ {
			exec(`INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at, watch_ms) VALUES ($1,'SCENE_VIEW',$2,'SCENE',$3,$4,20000)`,
				fmt.Sprintf("evt_sd_%s_%d", u, i), u, sceneID, now.Add(-time.Duration(i+1)*time.Hour))
		}
	}
	store := tagging.NewPostgres(pool)
	if _, err := tagging.Recompute(ctx, store, now); err != nil {
		t.Fatal(err)
	}
	topics := func(user string) int {
		tags, err := store.TagsOf(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, tg := range tags {
			if tg.Axis == tagging.AxisInterestTopic {
				n++
			}
		}
		return n
	}
	if topics(consenting) == 0 {
		t.Error("a consenting user who dwelt on a coffee scene gets topic tags")
	}
	if topics(silent) != 0 {
		t.Error("without consent, scene dwell must not become a tag")
	}
}
