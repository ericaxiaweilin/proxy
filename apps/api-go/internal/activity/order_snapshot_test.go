package activity

import (
	"encoding/json"
	"strings"
	"testing"
)

// ORDER-RECIPE-001：下单时存票面快照（活动当时的样子 + For You 的选择），
// 成功页和「我的订单」读的是同一份，重复下单也把原票面带回去。
func TestJoinStoresOrderSnapshotWithRecipe(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy"

	env := activityEnvelope("JoinActivity", "user_recipe", id)
	env.Payload = map[string]any{
		"activityId": id,
		"recipe": map[string]any{
			"source":    "FOR_YOU",
			"time":      "周日 10:00–11:30",
			"place":     map[string]any{"name": "Three Beans · Cầu Giấy", "area": "Cầu Giấy"},
			"companion": map[string]any{"id": "u_nam", "name": "Nam", "bio": "周末喜欢拍照", "photoUrl": "https://example.test/nam.jpg"},
		},
	}
	out := s.HandleContext(t.Context(), env)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", out)
	}
	var body struct {
		OrderNo  string         `json:"orderNo"`
		Snapshot *OrderSnapshot `json:"snapshot"`
	}
	if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	snap := body.Snapshot
	if snap == nil {
		t.Fatalf("accepted join must return the stored snapshot: %s", out.OperationRef)
	}
	if snap.OrderNo != body.OrderNo || snap.OrderNo == "" || snap.OrderedAt.IsZero() {
		t.Fatalf("snapshot must carry the same order number and time: %+v", snap)
	}
	if snap.Source != "FOR_YOU" || snap.Time != "周日 10:00–11:30" {
		t.Fatalf("recipe source/time lost: %+v", snap)
	}
	if snap.Place == nil || snap.Place.Name != "Three Beans · Cầu Giấy" || snap.Place.Area != "Cầu Giấy" {
		t.Fatalf("recipe place lost: %+v", snap.Place)
	}
	if snap.Companion == nil || snap.Companion.Name != "Nam" || snap.Companion.PhotoURL != "https://example.test/nam.jpg" {
		t.Fatalf("recipe companion lost: %+v", snap.Companion)
	}
	if snap.Activity.ActivityID != id || snap.Activity.Title == "" || snap.Activity.Joined != 1 || snap.Activity.PriceLabel == "" {
		t.Fatalf("activity part must come from the server's activity row, after this join: %+v", snap.Activity)
	}

	// 我的订单读到的是同一份。
	list := s.HandleContext(t.Context(), activityEnvelope("ListMyActivities", "user_recipe", "mine"))
	var mine struct {
		JoinOrders []JoinOrder `json:"joinOrders"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &mine); err != nil {
		t.Fatal(err)
	}
	if len(mine.JoinOrders) != 1 || mine.JoinOrders[0].Snapshot == nil || mine.JoinOrders[0].Snapshot.Companion == nil || mine.JoinOrders[0].Snapshot.Companion.Name != "Nam" {
		t.Fatalf("my orders must return the stored snapshot: %+v", mine.JoinOrders)
	}

	// 重复下单：拒绝，但带回原来的编号和票面。
	again := s.HandleContext(t.Context(), env)
	if again.Outcome != "REJECTED" || again.Error == nil || again.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" {
		t.Fatalf("repeat join: %+v", again)
	}
	if again.Error.SafeDetails["orderNo"] != body.OrderNo || again.Error.SafeDetails["snapshot"] == nil {
		t.Fatalf("repeat join must return the original order: %+v", again.Error.SafeDetails)
	}
}

func TestSanitizeRecipeDropsUntrustedOrOversizedInput(t *testing.T) {
	r := sanitizeRecipe(JoinRecipe{
		Source:    "ADMIN",
		Time:      strings.Repeat("时", 200),
		Place:     &RecipePlace{Name: "  "},
		Companion: &RecipeCompanion{Name: "Nam", PhotoURL: "file:///etc/passwd", Bio: strings.Repeat("b", 500)},
	})
	if r.Source != "" {
		t.Fatalf("unknown source must be dropped, got %q", r.Source)
	}
	if n := len([]rune(r.Time)); n != 80 {
		t.Fatalf("time must be clipped to 80 runes, got %d", n)
	}
	if r.Place != nil {
		t.Fatalf("blank place must be dropped, got %+v", r.Place)
	}
	if r.Companion == nil || r.Companion.PhotoURL != "" || len([]rune(r.Companion.Bio)) != 200 {
		t.Fatalf("companion must keep name, drop non-http photo, clip bio: %+v", r.Companion)
	}
}

// HOME-FORYOU-PERSON-001：For You 下单没有同行人一律拒，也不落报名。
func TestForYouJoinRequiresCompanion(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy"
	for _, recipe := range []map[string]any{
		{"source": "FOR_YOU"},
		{"source": "FOR_YOU", "companion": map[string]any{"name": "   "}},
	} {
		env := activityEnvelope("JoinActivity", "user_no_companion", id)
		env.Payload = map[string]any{"activityId": id, "recipe": recipe}
		out := s.HandleContext(t.Context(), env)
		if out.Outcome != "REJECTED" || out.Error == nil || out.Error.ErrorCode != "FOR_YOU_COMPANION_REQUIRED" {
			t.Fatalf("For You join without companion must be rejected, got %+v", out)
		}
	}
	list := s.HandleContext(t.Context(), activityEnvelope("ListMyActivities", "user_no_companion", "mine"))
	var mine struct {
		JoinOrders []JoinOrder `json:"joinOrders"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &mine); err != nil {
		t.Fatal(err)
	}
	if len(mine.JoinOrders) != 0 {
		t.Fatalf("rejected For You join must not create an order: %+v", mine.JoinOrders)
	}
	// 不带 FOR_YOU 的直接报名不受影响。
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_direct", id)); out.Outcome != "ACCEPTED" {
		t.Fatalf("direct join without recipe must still work: %+v", out)
	}
}

// HOME-FORYOU-ORDER-GUARD-001：同一时间段只能有一单；换时间或取消后可以。
func TestJoinRejectsSecondOrderInSameTimeSlot(t *testing.T) {
	s := NewWithRepository(&MemoryRepository{activities: make(map[string]*Activity)})
	_ = s.repository.Seed(t.Context(), []Activity{
		{ID: "cup", Title: "周日杯测小聚", Time: "周日 10:00–11:30", Capacity: 8, Status: "PUBLISHED"},
		{ID: "latte", Title: "拉花体验", Time: " 周日 10:00–11:30 ", Capacity: 8, Status: "PUBLISHED"},
		{ID: "night", Title: "抹茶夜", Time: "周五 19:00", Capacity: 8, Status: "PUBLISHED"},
	})
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "u", "cup")); out.Outcome != "ACCEPTED" {
		t.Fatalf("first join: %+v", out)
	}
	clash := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "u", "latte"))
	if clash.Outcome != "REJECTED" || clash.Error == nil || clash.Error.ErrorCode != "ACTIVITY_TIME_CONFLICT" {
		t.Fatalf("same time slot must be rejected, got %+v", clash)
	}
	if clash.Error.SafeDetails["activityId"] != "cup" || clash.Error.SafeDetails["title"] != "周日杯测小聚" {
		t.Fatalf("conflict must name the order that holds the slot: %+v", clash.Error.SafeDetails)
	}
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "u", "night")); out.Outcome != "ACCEPTED" {
		t.Fatalf("different time must be fine: %+v", out)
	}
	// 另一个人不受我的时间段影响。
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "someone_else", "latte")); out.Outcome != "ACCEPTED" {
		t.Fatalf("other users are not blocked by my slot: %+v", out)
	}
	// 取消那单之后同时间段可以再下。
	if out := s.HandleContext(t.Context(), activityEnvelope("CancelActivity", "u", "cup")); out.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", out)
	}
	if out := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "u", "latte")); out.Outcome != "ACCEPTED" {
		t.Fatalf("after cancelling, the slot is free again: %+v", out)
	}
}
