package postgres

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
)

// HOME-FORYOU-ORDER-007：换一个同行人 = 换一单，不能被报成「已经下过了」。
//
// 逃逸经过：判重只看 (activity_id, actor_id) 有没有未取消的记录，界面上就出现
// 「这个新用户是灰的 + 这一单你已经下过了（订单号 …）」—— 而那个新用户根本没
// 下过单。对 For You 来说，下单语义是「人 + 时间 + 场景 + 地点」一整套，
// 同行人是订单的一部分，不是附注。
func TestCompanionChangedDecidesDuplicate(t *testing.T) {
	withCompanion := func(id string) *activity.OrderSnapshot {
		return &activity.OrderSnapshot{Companion: &activity.RecipeCompanion{ID: id, Name: "n"}}
	}
	withRecipe := func(id string) activity.JoinRecipe {
		r := activity.JoinRecipe{}
		if id != "" {
			r.Companion = &activity.RecipeCompanion{ID: id, Name: "n"}
		}
		return r
	}

	cases := []struct {
		name     string
		existing *activity.OrderSnapshot
		recipe   activity.JoinRecipe
		changed  bool
		why      string
	}{
		{"different companion is a new order", withCompanion("alice"), withRecipe("bob"), true,
			"换了人就是换单 —— 界面上必须能下单，否则新用户永远是灰的"},
		{"same companion is still a duplicate", withCompanion("alice"), withRecipe("alice"), false,
			"同一个人再下一单，仍然如实报重复（ORDER-NO-001 的既有行为不变）"},
		{"first order has no companion, this one has", nil, withRecipe("bob"), false,
			"拿不到旧快照 ⇒ 无法证明换了人 ⇒ 保守判重。宁可误报，不能让重复下单靠清数据溜过去"},
		{"old snapshot exists but had no companion, now there is one", &activity.OrderSnapshot{}, withRecipe("bob"), false,
			"旧快照存在但没有同行人字段，仍按判重处理"},
		{"both have no companion", &activity.OrderSnapshot{}, withRecipe(""), false,
			"两单都没同行人 ⇒ 同一单"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := companionChanged(tc.existing, tc.recipe); got != tc.changed {
				t.Fatalf("companionChanged = %v, want %v (%s)", got, tc.changed, tc.why)
			}
		})
	}
}

// 身份只能看 id —— 名字和照片是会变的，拿显示名当身份等于判重形同虚设：
// 用户改个昵称就能对同一场活动再下一单。
func TestCompanionIdentityIsTheIDNotTheName(t *testing.T) {
	renamed := &activity.OrderSnapshot{Companion: &activity.RecipeCompanion{ID: "bob", Name: "Bobby"}}
	sameIDOtherName := activity.JoinRecipe{Companion: &activity.RecipeCompanion{ID: "bob", Name: "Robert"}}
	if companionChanged(renamed, sameIDOtherName) {
		t.Fatal("same id with a different display name must count as the SAME companion — otherwise renaming defeats the duplicate check")
	}
}

// HOME-FORYOU-ORDER-007（Postgres 集成）：换了同行人之后，同一场活动**必须能再下一单**。
//
// 上一版测试只测了 companionChanged 这个纯函数 —— 证伪时我把判重里的
// `&& !companionChanged(...)` 去掉，测试照样 PASS。也就是说"函数对了但没接上去"
// 这种最常见的错误是查不出来的。这里走真实仓储：真下单、再换人下单。
func TestJoinWithDifferentCompanionIsNotADuplicatePostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := strconv.FormatInt(time.Now().UnixNano(), 10)

	// 一个真实存在的活动，容量够两人。
	activityID := "act_companion_" + run
	repo := NewActivityRepository(pool)
	seed := activity.Activity{
		ID: activityID, Title: "同行人换单测试 " + run, Time: "周六 15:00",
		People: "2", Capacity: 5, MoneyFlow: "FREE", PriceLabel: "Free",
		VenueName: "西湖", VenueType: "PARK", Status: "PUBLISHED",
	}
	if err := repo.Seed(ctx, []activity.Activity{seed}); err != nil {
		t.Fatalf("seed activity: %v", err)
	}
	actor := "user_companion_" + run

	// 第一单：同行人 alice。
	first := activity.JoinRecipe{Companion: &activity.RecipeCompanion{ID: "alice_" + run, Name: "Alice"}}
	if _, _, err := repo.Join(ctx, activityID, actor, first); err != nil {
		t.Fatalf("first order must succeed: %v", err)
	}

	// 同一个同行人再下单 —— 仍然报重复（既有 ORDER-NO-001 行为不变）。
	if _, _, err := repo.Join(ctx, activityID, actor, first); err == nil {
		t.Fatal("the SAME companion must still be a duplicate — the duplicate check must not be lost")
	}

	// 换同行人 bob —— 必须能下单成功。这正是界面上那个 P0：换了人却被告「已经下过了」。
	second := activity.JoinRecipe{Companion: &activity.RecipeCompanion{ID: "bob_" + run, Name: "Bob"}}
	_, part, err := repo.Join(ctx, activityID, actor, second)
	if err != nil {
		t.Fatalf("a DIFFERENT companion must be a new order, got %v — this is the greyed-out 新用户 bug", err)
	}
	if part.OrderNo == "" {
		t.Fatal("the new order must carry an order number")
	}
}
