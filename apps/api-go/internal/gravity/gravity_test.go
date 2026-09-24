package gravity

import (
	"context"
	"testing"
	"time"
)

// GRAVITY-001：Histogram 引力 —— 规律的人在规律的时间点附近引力高，数据不够就只学习，久不发生就只观察，
// 永远不自动给 ACTIVE_ORCHESTRATE（§12 / §13 还没建）。

func noonChatter(weeks int, now time.Time) []time.Time {
	var out []time.Time
	for d := 1; d <= weeks*7; d++ {
		day := now.In(Market).AddDate(0, 0, -d)
		if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
			continue
		}
		out = append(out, time.Date(day.Year(), day.Month(), day.Day(), 12, 10, 0, 0, Market))
	}
	return out
}

func TestRegularNoonChatterHasHighGravityBeforeNoonAndLowAtNight(t *testing.T) {
	monday1150 := time.Date(2026, 9, 21, 11, 50, 0, 0, Market) // 周一，离中午还有 10 分钟
	st := Compute("xiaomei", EventChatActive, noonChatter(4, monday1150), monday1150)
	if st.P60 < softNudgeP60 || st.ActionState != StateSoftNudge {
		t.Fatalf("a weekday-noon regular at 11:50 on a Monday must be SOFT_NUDGE with high P60: %+v", st)
	}
	if !(st.P30 <= st.P60 && st.P60 <= st.P120) {
		t.Fatalf("probabilities must grow with the window: %+v", st)
	}
	// 每个工作日中午都一样规律，峰值落在哪天取决于最近那次（近期加权），但一定是中午 12 点。
	if st.PeakHourOfWeek%24 != 12 {
		t.Fatalf("peak must be at 12:00 on some weekday, got hour-of-week %d", st.PeakHourOfWeek)
	}
	monday0300 := time.Date(2026, 9, 21, 3, 0, 0, 0, Market)
	night := Compute("xiaomei", EventChatActive, noonChatter(4, monday0300), monday0300)
	if night.P60 >= 0.2 || night.ActionState == StateSoftNudge {
		t.Fatalf("at 03:00 the same person has low gravity: %+v", night)
	}
}

func TestSparseOrStaleEvidenceDoesNotNudge(t *testing.T) {
	now := time.Date(2026, 9, 21, 11, 30, 0, 0, Market)
	once := Compute("u", EventBrowseActive, []time.Time{now.Add(-24 * time.Hour)}, now)
	if once.ActionState != StateLearnOnly {
		t.Fatalf("one event is not enough evidence to act on: %+v", once)
	}
	stale := Compute("u", EventBrowseActive, []time.Time{now.Add(-40 * 24 * time.Hour), now.Add(-41 * 24 * time.Hour)}, now)
	if stale.ActionState != StateObserve {
		t.Fatalf("nothing in 30 days = observe only: %+v", stale)
	}
	none := Compute("u", EventBrowseActive, nil, now)
	if none.ActionState != StateObserve || none.P60 != 0 {
		t.Fatalf("no data = observe, zero gravity: %+v", none)
	}
}

func TestNeverAutoActiveOrchestrate(t *testing.T) {
	now := time.Date(2026, 9, 21, 11, 55, 0, 0, Market)
	for _, st := range ComputeAll([]Occurrence{
		{UserID: "a", EventType: EventChatActive, At: now.Add(-7 * 24 * time.Hour)},
		{UserID: "a", EventType: EventChatActive, At: now.Add(-14 * 24 * time.Hour)},
	}, now) {
		if st.ActionState == StateActive || st.ActionState == StateBlocked {
			t.Fatalf("active orchestration needs guardrails + intervention budget (spec §12-13), not built: %+v", st)
		}
	}
}

func TestRecomputeSkipsNonHumansAndDowngradesPeopleWhoWentQuiet(t *testing.T) {
	now := time.Date(2026, 9, 21, 11, 50, 0, 0, Market)
	store := NewMemory()
	for _, at := range noonChatter(4, now) {
		store.Events = append(store.Events,
			Occurrence{UserID: "user_xiaomei", EventType: EventChatActive, At: at},
			Occurrence{UserID: "ai_account_001", EventType: EventChatActive, At: at},
			Occurrence{UserID: "proxy_ai", EventType: EventChatActive, At: at},
		)
	}
	// 以前算过、但近 60 天什么都没做的人。
	_ = store.Save(context.Background(), []State{{UserID: "user_gone", EventType: EventChatActive, ActionState: StateSoftNudge, P60: 0.9}})
	n, err := Recompute(context.Background(), store, now)
	if err != nil || n != 2 {
		t.Fatalf("recompute = %d, %v (want xiaomei + the quiet user)", n, err)
	}
	top, _ := store.Top(context.Background(), EventChatActive, 10)
	for _, st := range top {
		if !IsHuman(st.UserID) {
			t.Fatalf("AI / platform accounts are not modelled people: %+v", st)
		}
		if st.UserID == "user_gone" && (st.ActionState != StateObserve || st.P60 != 0) {
			t.Fatalf("someone who went quiet must drop back to OBSERVE, not keep an old nudge: %+v", st)
		}
	}
	if top[0].UserID != "user_xiaomei" || top[0].ActionState != StateSoftNudge {
		t.Fatalf("the regular noon chatter leads: %+v", top)
	}
}
