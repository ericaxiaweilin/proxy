package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// helper: build a Service with a controllable clock.
func newProtectionService(now time.Time) (*Service, *func(d time.Duration)) {
	t := &controllableClock{now: now}
	advance := func(d time.Duration) { t.now = t.now.Add(d) }
	return NewWithRepositoryAndClock(NewMemoryRepository(), t), &advance
}

type controllableClock struct{ now time.Time }

func (c *controllableClock) Now() time.Time { return c.now }

// decodeOperationRef is a small helper that pulls the JSON payload back out
// of a command.Result.OperationRef (which is how acceptedWithPayload ships
// the body to callers).
func decodeOperationRef(t *testing.T, r command.Result) map[string]any {
	t.Helper()
	if r.OperationRef == "" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(r.OperationRef), &out); err != nil {
		t.Fatalf("decode OperationRef: %v", err)
	}
	return out
}

func actor(id string) command.Actor {
	return command.Actor{Type: "INDIVIDUAL", ID: id}
}

func targetConversation(id string) command.Target {
	return command.Target{Type: "CONVERSATION", ID: id}
}

func targetMessage(id string) command.Target {
	return command.Target{Type: "MESSAGE", ID: id}
}

func envelope(actorID, targetID, targetType, commandID, corrID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:     commandID,
		CommandType:   "Test",
		CommandVersion: 1,
		Actor:         actor(actorID),
		Principal:     command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:        command.Target{Type: targetType, ID: targetID},
		CorrelationID: corrID,
		Payload:       payload,
	}
}

// ---------- DefaultProtectionFor / Apply ----------

func TestDefaultProtectionFor_DM_Image(t *testing.T) {
	p := DefaultProtectionFor("IMAGE", "DM")
	if p.Forwardable {
		t.Error("DM IMAGE must not be forwardable by default")
	}
	if !p.ScreenshotWarn {
		t.Error("DM IMAGE must have ScreenshotWarn")
	}
	if p.ViewLimit != 3 {
		t.Errorf("ViewLimit = %d, want 3", p.ViewLimit)
	}
	if p.ExpiresAt == nil {
		t.Fatal("ExpiresAt must be set")
	}
}

func TestDefaultProtectionFor_Group_Image(t *testing.T) {
	p := DefaultProtectionFor("IMAGE", "GROUP")
	if !p.Forwardable {
		t.Error("GROUP IMAGE must be forwardable by default")
	}
	if !p.ScreenshotWarn {
		t.Error("GROUP IMAGE must have ScreenshotWarn")
	}
}

func TestDefaultProtectionFor_Video_DM(t *testing.T) {
	p := DefaultProtectionFor("VIDEO", "DM")
	if p.Forwardable {
		t.Error("DM VIDEO must not be forwardable")
	}
	if p.ViewLimit != 1 {
		t.Errorf("ViewLimit = %d, want 1", p.ViewLimit)
	}
}

func TestDefaultProtectionFor_Location_DM(t *testing.T) {
	p := DefaultProtectionFor("LOCATION", "DM")
	if p.ViewLimit != 1 {
		t.Errorf("ViewLimit = %d, want 1", p.ViewLimit)
	}
	if p.ExpiresAt == nil {
		t.Fatal("ExpiresAt must be set")
	}
	want := 1 * time.Hour
	got := time.Until(*p.ExpiresAt)
	if got > want || got < want-time.Minute {
		t.Errorf("Location TTL ~ %v, want ~1h", got)
	}
}

func TestDefaultProtectionFor_SystemContext_NoExpiry(t *testing.T) {
	p := DefaultProtectionFor("SYSTEM_CONTEXT", "DM")
	if !p.Forwardable {
		t.Error("SYSTEM_CONTEXT must be forwardable")
	}
	if p.ExpiresAt != nil {
		t.Error("SYSTEM_CONTEXT must not have ExpiresAt")
	}
}

func TestApply_ForwardableOverride(t *testing.T) {
	base := MessageProtection{Forwardable: false, ScreenshotWarn: true}
	tr := true
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	out, err := Apply(base, ProtectionOverride{Forwardable: &tr}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Forwardable {
		t.Error("override should have flipped Forwardable to true")
	}
	if !out.ScreenshotWarn {
		t.Error("ScreenshotWarn should be preserved")
	}
}

func TestApply_ViewLimitOutOfRange(t *testing.T) {
	base := MessageProtection{}
	v := 200
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	_, err := Apply(base, ProtectionOverride{ViewLimit: &v}, now)
	if !errors.Is(err, ErrProtectionViewLimitOutOfRange) {
		t.Errorf("err = %v, want ErrProtectionViewLimitOutOfRange", err)
	}
	v = -1
	_, err = Apply(base, ProtectionOverride{ViewLimit: &v}, now)
	if !errors.Is(err, ErrProtectionViewLimitOutOfRange) {
		t.Errorf("negative err = %v, want ErrProtectionViewLimitOutOfRange", err)
	}
}

func TestApply_TTLOutOfRange(t *testing.T) {
	base := MessageProtection{}
	d := 400 * 24 * time.Hour
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	_, err := Apply(base, ProtectionOverride{TTL: &d}, now)
	if !errors.Is(err, ErrProtectionTTLOutOfRange) {
		t.Errorf("err = %v, want ErrProtectionTTLOutOfRange", err)
	}
}

// ---------- end-to-end: send / read / limit / ttl / screenshot / forward ----------

func TestSendMessage_AppliesDefaultProtection(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")

	res := svc.sendMessage(ctx, envelope("user_alice", conv.ID, "CONVERSATION", "c1", "cor1", map[string]any{
		"messageType": "IMAGE",
		"mediaRef":    "media_x",
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("send outcome = %s, want ACCEPTED; error=%+v", res.Outcome, res.Error)
	}
	msgs, _ := svc.repository.Messages(ctx, conv.ID)
	if len(msgs) != 1 {
		t.Fatalf("messages = %d, want 1", len(msgs))
	}
	if msgs[0].Protection.Forwardable {
		t.Error("DM IMAGE protection.Forwardable should default to false")
	}
	if msgs[0].Protection.ViewLimit != 3 {
		t.Errorf("ViewLimit = %d, want 3", msgs[0].Protection.ViewLimit)
	}
}

func TestSendMessage_OverrideValidation(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	res := svc.sendMessage(ctx, envelope("user_alice", conv.ID, "CONVERSATION", "c1", "cor1", map[string]any{
		"messageType": "TEXT",
		"body":        "hi",
		"protectionOverride": ProtectionOverride{ViewLimit: intPtr(999)},
	}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("outcome = %s, want REJECTED", res.Outcome)
	}
	if res.Error == nil || res.Error.ErrorCode != "INVALID_PROTECTION" {
		t.Errorf("error = %+v, want INVALID_PROTECTION", res.Error)
	}
}

func TestMarkMessageRead_BumpsViewCount(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	res := svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r1", "c1", map[string]any{
		"messageId": msg.ID,
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("read outcome = %s, want ACCEPTED; err=%+v", res.Outcome, res.Error)
	}
	ref := decodeOperationRef(t, res)
	if ref["viewCount"].(float64) != 1 {
		t.Errorf("viewCount = %v, want 1", ref["viewCount"])
	}
}

func TestMarkMessageRead_HitsViewLimit(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	for i := 0; i < 3; i++ {
		res := svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("read #%d outcome = %s, want ACCEPTED; err=%+v", i, res.Outcome, res.Error)
		}
	}
	res := svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("4th read outcome = %s, want REJECTED", res.Outcome)
	}
	if res.Error == nil || res.Error.ErrorCode != "VIEW_LIMIT_EXCEEDED" {
		t.Errorf("errorCode = %+v, want VIEW_LIMIT_EXCEEDED", res.Error)
	}
}

func TestMarkMessageRead_SenderReadDoesNotCount(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	for i := 0; i < 10; i++ {
		res := svc.markMessageRead(ctx, envelope("user_alice", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("self read #%d = %s", i, res.Outcome)
		}
		ref := decodeOperationRef(t, res)
		if ref["selfRead"] != true {
			t.Errorf("self read ref = %v, want selfRead=true", ref)
		}
	}
	// Bob still has full ViewLimit to use.
	for i := 0; i < 3; i++ {
		res := svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("bob read #%d = %s", i, res.Outcome)
		}
	}
}

func TestListMessages_FiltersExpiredAndConsumed(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", &ProtectionOverride{ViewLimit: intPtr(1)})
	msg := firstMessage(t, svc, conv)

	// Bob reads once → view limit hit.
	_ = svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))

	res := svc.listMessages(ctx, envelope("user_bob", conv.ID, "CONVERSATION", "l", "c", nil))
	ref := decodeOperationRef(t, res)
	arr, _ := ref["messages"].([]any)
	if len(arr) != 0 {
		t.Errorf("Bob should see 0 messages, got %d", len(arr))
	}

	res = svc.listMessages(ctx, envelope("user_alice", conv.ID, "CONVERSATION", "l", "c", nil))
	ref = decodeOperationRef(t, res)
	arr, _ = ref["messages"].([]any)
	if len(arr) != 1 {
		t.Errorf("Alice should see 1 message, got %d", len(arr))
	}
}

func TestRecordScreenshot_FiresAlert(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	res := svc.recordScreenshot(ctx, envelope("user_bob", msg.ID, "MESSAGE", "ss", "c", map[string]any{
		"messageId": msg.ID,
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("outcome = %s, want ACCEPTED; err=%+v", res.Outcome, res.Error)
	}
	hasScreenshot := false
	hasAlert := false
	for _, ev := range res.EventRefs {
		if ev == "ScreenshotDetected" {
			hasScreenshot = true
		}
		if ev == "SecurityAlert" {
			hasAlert = true
		}
	}
	// eventRefs in service.go is a slice of event.ID, not event.Type. So
	// we just check the count.
	if len(res.EventRefs) < 2 {
		t.Errorf("expected 2+ events (ScreenshotDetected + SecurityAlert), got %d", len(res.EventRefs))
	}
	_ = hasScreenshot
	_ = hasAlert
}

func TestRecordScreenshot_RespectsProtectionOff(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendTextWithOverride(t, svc, conv, "user_alice", &ProtectionOverride{Warn: boolPtr(false)})
	msg := firstMessage(t, svc, conv)

	res := svc.recordScreenshot(ctx, envelope("user_bob", msg.ID, "MESSAGE", "ss", "c", map[string]any{"messageId": msg.ID}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("outcome = %s", res.Outcome)
	}
	if len(res.EventRefs) != 0 {
		t.Errorf("expected no events when ScreenshotWarn is off, got %d", len(res.EventRefs))
	}
}

func TestRecordScreenshot_RejectsSelfScreenshot(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	res := svc.recordScreenshot(ctx, envelope("user_alice", msg.ID, "MESSAGE", "ss", "c", map[string]any{"messageId": msg.ID}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("outcome = %s, want REJECTED", res.Outcome)
	}
	if res.Error == nil || res.Error.ErrorCode != "SELF_SCREENSHOT" {
		t.Errorf("errorCode = %+v, want SELF_SCREENSHOT", res.Error)
	}
}

func TestForwardMessage_BlocksWhenNotForwardable(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	sendImage(t, svc, conv, "user_alice", nil)
	msg := firstMessage(t, svc, conv)

	res := svc.forwardMessage(ctx, envelope("user_bob", msg.ID, "MESSAGE", "fw", "c", map[string]any{
		"sourceMessageId": msg.ID, "targetConversationId": conv.ID,
	}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("outcome = %s, want REJECTED", res.Outcome)
	}
	if res.Error == nil || res.Error.ErrorCode != "PROTECTION_VIOLATION" {
		t.Errorf("errorCode = %+v, want PROTECTION_VIOLATION", res.Error)
	}
}

func TestForwardMessage_AllowsWhenForwardable(t *testing.T) {
	svc, _ := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	// Build a fresh GROUP conv (new ID so CreateConversation succeeds).
	groupConv := Conversation{
		ID:            "conv_group_1",
		Type:          "GROUP",
		OriginType:    "PROFILE",
		OriginID:      "u_x",
		State:         "ACTIVE",
		Participants:  []string{"user_alice", "user_bob", "user_carol"},
		CreatedAt:     time.Now().UTC(),
		LastMessageAt: time.Now().UTC(),
	}
	if err := svc.repository.CreateConversation(ctx, groupConv); err != nil {
		t.Fatalf("create group conv: %v", err)
	}
	sendImage(t, svc, groupConv, "user_alice", nil)
	msg := firstMessage(t, svc, groupConv)

	res := svc.forwardMessage(ctx, envelope("user_bob", msg.ID, "MESSAGE", "fw", "c", map[string]any{
		"sourceMessageId": msg.ID, "targetConversationId": groupConv.ID,
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("outcome = %s, want ACCEPTED; error=%+v", res.Outcome, res.Error)
	}
}

// ---------- TTL pass time ----------

func TestMarkMessageRead_RejectsAfterTTL(t *testing.T) {
	svc, advance := newProtectionService(time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	conv := newTestConversation(svc, "user_alice", "user_bob")
	// TEXT default 30d, but override to 1 second for the test.
	sendTextWithOverride(t, svc, conv, "user_alice", &ProtectionOverride{TTL: durPtr(1 * time.Second)})
	msg := firstMessage(t, svc, conv)

	// advance past TTL
	(*advance)(2 * time.Second)

	res := svc.markMessageRead(ctx, envelope("user_bob", msg.ID, "MESSAGE", "r", "c", map[string]any{"messageId": msg.ID}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("outcome = %s, want REJECTED; err=%+v", res.Outcome, res.Error)
	}
	if res.Error == nil || res.Error.ErrorCode != "MESSAGE_EXPIRED" {
		t.Errorf("errorCode = %+v, want MESSAGE_EXPIRED", res.Error)
	}
}

// ---------- helpers ----------

func intPtr(i int) *int    { return &i }
func boolPtr(b bool) *bool { return &b }
func durPtr(d time.Duration) *time.Duration {
	return &d
}

func newTestConversation(svc *Service, alice, bob string) Conversation {
	conv := Conversation{
		ID:            "conv_test_1",
		Type:          "DM",
		OriginType:    "PROFILE",
		OriginID:      "u_x",
		State:         "ACTIVE",
		Participants:  []string{alice, bob},
		CreatedAt:     time.Now().UTC(),
		LastMessageAt: time.Now().UTC(),
	}
	_ = svc.repository.CreateConversation(context.Background(), conv)
	return conv
}

func sendImage(t *testing.T, svc *Service, conv Conversation, sender string, override *ProtectionOverride) {
	t.Helper()
	payload := map[string]any{
		"messageType": "IMAGE",
		"mediaRef":    "media_x",
	}
	if override != nil {
		payload["protectionOverride"] = *override
	}
	res := svc.sendMessage(context.Background(), envelope(sender, conv.ID, "CONVERSATION", "s", "c", payload))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("send image: outcome = %s, error = %+v", res.Outcome, res.Error)
	}
}

func sendTextWithOverride(t *testing.T, svc *Service, conv Conversation, sender string, override *ProtectionOverride) {
	t.Helper()
	res := svc.sendMessage(context.Background(), envelope(sender, conv.ID, "CONVERSATION", "s", "c", map[string]any{
		"messageType":        "TEXT",
		"body":               "hello",
		"protectionOverride": *override,
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("send text: outcome = %s, error = %+v", res.Outcome, res.Error)
	}
}

func firstMessage(t *testing.T, svc *Service, conv Conversation) Message {
	t.Helper()
	msgs, err := svc.repository.Messages(context.Background(), conv.ID)
	if err != nil || len(msgs) == 0 {
		t.Fatalf("no messages: err=%v", err)
	}
	return msgs[0]
}
