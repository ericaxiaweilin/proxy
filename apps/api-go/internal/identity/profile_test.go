package identity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func profileEnvelope(commandType, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:   "cmd_profile_" + commandType,
		CommandType: commandType,
		Actor:       command.Actor{Type: "USER", ID: actor},
		Principal:   command.Principal{Type: "PERSON", ID: actor},
		Target:      command.Target{Type: "Profile", ID: actor},
		CorrelationID: "corr_profile_" + commandType,
		Payload:     payload,
	}
}

// R18.x: PROFILE-001 tripwire
//
// The mobile '编辑主页' modal in me.tsx was a local-only write
// (profileStore.write to Keychain/Keystore). No server command
// existed; the new name/handle/bio/city/avatar never reached
// feeds, opportunity applicants, or any cross-device read.
// This tripwire asserts the wire is complete: actor-scoped
// upsert + read round-trip, anonymous actor rejected, external
// URL avatar rejected, version increments on second upsert.
func TestProfileRoundTripUsesActorAsOwner(t *testing.T) {
	svc := New(nil)

	first := svc.Handle(profileEnvelope("UpdateProfile", "user_alice", map[string]any{
		"name":       "Alice",
		"handle":     "@alice",
		"bio":        "河内",
		"city":       "Hanoi",
		"avatarPath": "assets/avatar-alice.jpg",
	}))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first upsert failed: %#v", first)
	}
	if first.Aggregate == nil || first.Aggregate.ID != "user_alice" || first.Aggregate.Version != 1 {
		t.Fatalf("first upsert aggregate wrong: %#v", first.Aggregate)
	}

	read := svc.Handle(profileEnvelope("GetProfile", "user_alice", nil))
	if read.Outcome != "ACCEPTED" {
		t.Fatalf("get failed: %#v", read)
	}
	var body struct {
		Profile Profile `json:"profile"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Profile.Name != "Alice" || body.Profile.Handle != "@alice" || body.Profile.City != "Hanoi" || body.Profile.AvatarPath != "assets/avatar-alice.jpg" {
		t.Fatalf("unexpected profile: %#v", body.Profile)
	}

	second := svc.Handle(profileEnvelope("UpdateProfile", "user_alice", map[string]any{
		"name":       "Alice Liddell",
		"handle":     "@alice",
		"bio":        "河内 · 周六",
		"city":       "Hanoi",
		"avatarPath": "assets/avatar-alice-2.jpg",
	}))
	if second.Outcome != "ACCEPTED" || second.Aggregate == nil || second.Aggregate.Version != 2 {
		t.Fatalf("second upsert should increment version: %#v", second)
	}

	missing := svc.Handle(profileEnvelope("GetProfile", "user_bob", nil))
	if missing.Outcome != "REJECTED" || missing.Error == nil || missing.Error.ErrorCode != "PROFILE_NOT_FOUND" {
		t.Fatalf("missing profile should return PROFILE_NOT_FOUND, got %#v", missing)
	}
}

func TestUpdateProfileRejectsAnonymousActorAndBadAvatar(t *testing.T) {
	svc := New(nil)

	anon := profileEnvelope("UpdateProfile", "", map[string]any{
		"name": "Bob", "handle": "@bob", "city": "Hanoi",
	})
	anon.Actor.Type = "ANONYMOUS"
	if got := svc.Handle(anon); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "PROFILE_FORBIDDEN" {
		t.Fatalf("anonymous should be rejected, got %#v", got)
	}

	externalAvatar := svc.Handle(profileEnvelope("UpdateProfile", "user_bob", map[string]any{
		"name": "Bob", "handle": "@bob", "city": "Hanoi", "avatarPath": "https://attacker.example.com/me.jpg",
	}))
	if externalAvatar.Outcome != "REJECTED" || externalAvatar.Error == nil || externalAvatar.Error.ErrorCode != "PROFILE_INVALID_AVATAR" {
		t.Fatalf("external URL avatar should be rejected, got %#v", externalAvatar)
	}

	emptyName := svc.Handle(profileEnvelope("UpdateProfile", "user_bob", map[string]any{
		"name": "", "handle": "@bob", "city": "Hanoi",
	}))
	if emptyName.Outcome != "REJECTED" || emptyName.Error == nil || emptyName.Error.ErrorCode != "INVALID_PROFILE" {
		t.Fatalf("empty name should be rejected, got %#v", emptyName)
	}
}

func TestInitialProfileDerivesFromVerifiedIdentifier(t *testing.T) {
	email := initialProfileFor("user_1", "EMAIL", "NguyenThanhHuyen@Example.com")
	if email.Name != "NguyenThanhHuyen" || email.Handle != "@nguyenthanhhuyen" {
		t.Fatalf("email profile wrong: %#v", email)
	}
	phone := initialProfileFor("user_2", "SMS", "+84912345678")
	if phone.Name != "用户" || phone.Handle != "@user5678" {
		t.Fatalf("phone identifier must stay out of the public name: %#v", phone)
	}
	if len(phone.Handle) >= len("+84912345678") {
		t.Fatalf("full phone number leaked into handle: %#v", phone)
	}
	empty := initialProfileFor("user_3", "EMAIL", "")
	if empty.Name != "用户" || empty.Handle != "@user" {
		t.Fatalf("empty identifier must fall back to neutral: %#v", empty)
	}
}
