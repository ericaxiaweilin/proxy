package postgres

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
)

// FOR-YOU-SLOT-001（2026-10-04，用户：「for you 是 4 个自由资源槽，核心服务于小美真人……
// 20 个真人 × 3 个时段 = 60 个可用，现在只有 9 个」）。资源单位是「小美 × 时段」：
//   - 约不同的小美是不同的单：各自一行、各自编号、各自票面，旧票不被改写；
//   - 同一组 (活动, 我, 小美) 再下 ⇒ ErrAlreadyJoined，带回原编号；
//   - 小美的一个时段被任何人约走 ⇒ 别人（任何一场同时段活动）都约不到她；
//   - 下单人自己同一时段可以约多个小美；
//   - For You 单不受活动名额限制（店是场景载体，承载上限后期再做）。
func TestForYouCompanionTimeSlotOrdersPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := strconv.FormatInt(time.Now().UnixNano(), 10)
	repo := NewActivityRepository(pool)

	// Origin TEST：这个仓储测试可能连着共享开发库（DATABASE_URL 优先），TEST 不进
	// ListActivities，不会污染首页 / 市场。Capacity 1：验证 For You 单不扣名额。
	slot := "周六 15:00–17:00 #" + run
	seed := func(id, venue string) activity.Activity {
		return activity.Activity{
			ID: id, Origin: "TEST", Title: "小美时段测试 " + run, Time: slot,
			People: "1", Capacity: 1, MoneyFlow: "FREE", PriceLabel: "Free",
			VenueName: venue, VenueType: "CAFE", Status: "PUBLISHED",
		}
	}
	shopA, shopB := "act_slot_a_"+run, "act_slot_b_"+run
	if err := repo.Seed(ctx, []activity.Activity{seed(shopA, "店A"), seed(shopB, "店B")}); err != nil {
		t.Fatalf("seed activities: %v", err)
	}
	me, other := "user_slot_me_"+run, "user_slot_other_"+run
	recipe := func(id, name string) activity.JoinRecipe {
		return activity.JoinRecipe{Source: "FOR_YOU", Companion: &activity.RecipeCompanion{ID: id + "_" + run, Name: name}}
	}

	_, alice, err := repo.Join(ctx, shopA, me, recipe("alice", "Alice"))
	if err != nil {
		t.Fatalf("first order must succeed: %v", err)
	}
	_, bob, err := repo.Join(ctx, shopA, me, recipe("bob", "Bob"))
	if err != nil {
		t.Fatalf("same activity, same time, a different companion is a new order (and ignores capacity): %v", err)
	}
	if bob.OrderNo == "" || bob.OrderNo == alice.OrderNo {
		t.Fatalf("each companion order needs its own number: alice=%q bob=%q", alice.OrderNo, bob.OrderNo)
	}

	_, again, err := repo.Join(ctx, shopA, me, recipe("alice", "Alice"))
	if !errors.Is(err, activity.ErrAlreadyJoined) || again.OrderNo != alice.OrderNo {
		t.Fatalf("same (activity, me, companion) must be the same order: err=%v no=%q", err, again.OrderNo)
	}
	order, ok, err := repo.GetJoinOrder(ctx, shopA, me, "alice_"+run)
	if err != nil || !ok || order.Snapshot == nil || order.Snapshot.Companion == nil || order.Snapshot.Companion.ID != "alice_"+run {
		t.Fatalf("alice's ticket must stay alice's: ok=%v err=%v order=%+v", ok, err, order)
	}

	if _, _, err := repo.Join(ctx, shopB, other, recipe("alice", "Alice")); !errors.Is(err, activity.ErrCompanionSlotTaken) {
		t.Fatalf("alice is booked at this time slot, nobody else can book her then (any shop): err=%v", err)
	}
	slots, err := repo.ListBookedCompanionSlots(ctx, []string{"alice_" + run, "carol_" + run})
	if err != nil || len(slots) != 1 || slots[0].CompanionID != "alice_"+run || slots[0].Time != slot {
		t.Fatalf("booked slots must list exactly alice@slot: err=%v slots=%+v", err, slots)
	}

	if _, _, err := repo.TransitionParticipation(ctx, shopA, me, "alice_"+run,
		[]activity.ParticipationState{activity.PartConfirmed}, activity.PartCancelled); err != nil {
		t.Fatalf("cancel alice order: %v", err)
	}
	if _, _, err := repo.Join(ctx, shopB, other, recipe("alice", "Alice")); err != nil {
		t.Fatalf("after the cancel alice's slot is free again: %v", err)
	}
	if bobOrder, ok, _ := repo.GetJoinOrder(ctx, shopA, me, "bob_"+run); !ok || bobOrder.State != "CONFIRMED" {
		t.Fatalf("cancelling the alice order must not touch the bob order: %+v", bobOrder)
	}
}
