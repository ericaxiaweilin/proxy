package identity

import (
	"context"
	"encoding/json"
	"errors"
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

// HANDLE-UNIQUE-001: two accounts must never share a handle.
//
// The invariant used to exist only as a comment in profile.go ("uniqueness is
// per-tenant, enforced by repository on create") while nothing enforced it:
// 039_profile.sql created a PLAIN index, and neither repository checked for a
// conflict. initialProfileFor derives the handle from the email local-part, so
// linh@gmail.com and linh@outlook.com reliably both got @linh. A profile QR /
// invite link is proxy.app/@linh and the client matches it case-insensitively,
// so an ambiguous handle means scanning one person's code can add a different
// person.
//
// This is the in-memory half. The Postgres half — the real unique index and a
// raw INSERT being rejected — is TestProfileHandleUniquenessIsEnforced, because
// a Go-level check alone stops protecting anything the moment a row is written
// outside the repository.
func TestProfileHandleIsUniqueCaseInsensitively(t *testing.T) {
	svc := NewProfileService(NewMemoryProfileRepository(), nil)
	ctx := context.Background()

	mk := func(accountID, handle string) Profile {
		return Profile{UserAccountID: accountID, Name: "Dup", Handle: handle, City: "Hanoi"}
	}

	if _, err := svc.UpsertProfile(ctx, mk("user_a", "@linh")); err != nil {
		t.Fatalf("first profile must save: %v", err)
	}

	// Case and the leading @ are not part of the identity: the QR parser
	// matches proxy.app/@<handle> case-insensitively.
	for _, variant := range []string{"@linh", "@LINH", "linh", "@Linh"} {
		if _, err := svc.UpsertProfile(ctx, mk("user_b", variant)); !errors.Is(err, ErrProfileHandleTaken) {
			t.Fatalf("variant %q must collide with @linh, got %v", variant, err)
		}
	}

	// A free handle still saves — the check must not make profiles uneditable.
	if _, err := svc.UpsertProfile(ctx, mk("user_b", "@linh2")); err != nil {
		t.Fatalf("free handle must save: %v", err)
	}
	// An account re-saving its own handle is not a collision.
	if _, err := svc.UpsertProfile(ctx, mk("user_a", "@LINH")); err != nil {
		t.Fatalf("an account re-saving its own handle must not collide: %v", err)
	}

	for _, lookup := range []string{"@linh", "LINH", "  @Linh  "} {
		got, err := svc.GetProfileByHandle(ctx, lookup)
		if err != nil {
			t.Fatalf("GetProfileByHandle(%q): %v", lookup, err)
		}
		if got.UserAccountID != "user_a" {
			t.Fatalf("GetProfileByHandle(%q) resolved to %s, want user_a", lookup, got.UserAccountID)
		}
	}
	if _, err := svc.GetProfileByHandle(ctx, "@nobody"); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("unknown handle must be ErrProfileNotFound, got %v", err)
	}
}

// HANDLE-UNIQUE-001: a taken handle must arrive as its OWN outcome.
//
// The old error switch had a `default` that mapped everything to
// identity.invalid_profile, so a handle conflict would have been reported as
// "your profile is invalid" — naming neither the field nor the reason, and
// hiding the only thing the user could act on.
func TestUpdateProfileRejectsTakenHandleWithItsOwnCode(t *testing.T) {
	svc := New(nil)
	env := func(actor, handle string) command.Envelope {
		e := profileEnvelope("UpdateProfile", actor, map[string]any{
			"name": "Linh", "handle": handle, "bio": "", "city": "Hanoi", "avatarPath": "",
		})
		e.CommandID = "cmd_" + actor + "_" + handle
		return e
	}

	if got := svc.Handle(env("user_linh_gmail", "@linh")); got.Outcome != "ACCEPTED" {
		t.Fatalf("first account must be able to take @linh: %#v", got)
	}

	got := svc.Handle(env("user_linh_outlook", "@linh"))
	if got.Outcome != "REJECTED" || got.Error == nil {
		t.Fatalf("second account taking @linh must be rejected: %#v", got)
	}
	if got.Error.ErrorCode != "PROFILE_HANDLE_TAKEN" {
		t.Fatalf("a taken handle needs its own error code, got %q", got.Error.ErrorCode)
	}
	if got.Error.MessageKey != "identity.profile_handle_taken" {
		t.Fatalf("message key must name the conflict, got %q", got.Error.MessageKey)
	}
}

// HANDLE-UNIQUE-001: registration must not silently produce an account with no
// profile. The call site used to discard the upsert error (`_, _ =`), so once
// handles became unique the second linh@... would "register successfully" and
// then have nothing — a half-state the client cannot tell apart from "profile
// not loaded yet". Provisioning now resolves a free handle instead.
func TestProvisionInitialProfileAvoidsTakenHandle(t *testing.T) {
	svc := NewProfileService(NewMemoryProfileRepository(), nil)
	ctx := context.Background()

	if _, err := svc.UpsertProfile(ctx, Profile{UserAccountID: "user_first", Name: "Linh", Handle: "@linh", City: "Hanoi"}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := svc.ProvisionInitialProfile(ctx, "user_second", "EMAIL", "linh@outlook.com")
	if err != nil {
		t.Fatalf("the second registration must still end up with a profile: %v", err)
	}
	if got.Handle != "@linh2" {
		t.Fatalf("expected the first free suffix (@linh2), got %q", got.Handle)
	}

	// And it must be reachable under the handle it was actually given.
	back, err := svc.GetProfileByHandle(ctx, got.Handle)
	if err != nil {
		t.Fatalf("provisioned handle must resolve: %v", err)
	}
	if back.UserAccountID != "user_second" {
		t.Fatalf("provisioned handle resolved to %s, want user_second", back.UserAccountID)
	}
}

// HANDLE-LOOKUP-001: the landing point of a scanned code.
//
// A profile QR / invite link is proxy.app/@linh. The client parses the handle
// out of it and needs the server to resolve it to exactly ONE person — that is
// what makes "扫码添加好友" reach the person whose code was scanned.
//
// This command could only be exposed after HANDLE-UNIQUE-001: while @linh
// could name two accounts, a lookup would have resolved the scanned code to an
// arbitrary one of them, i.e. scanning person A's code could add person B.
func TestGetProfileByHandleResolvesExactlyOnePerson(t *testing.T) {
	svc := New(nil)
	lookup := func(actor, handle string) command.Envelope {
		e := profileEnvelope("GetProfileByHandle", actor, map[string]any{"handle": handle})
		e.CommandID = "cmd_lookup_" + actor + "_" + handle
		return e
	}

	if got := svc.Handle(profileEnvelope("UpdateProfile", "user_linh", map[string]any{
		"name": "Linh", "handle": "@linh", "bio": "", "city": "Hanoi", "avatarPath": "",
	})); got.Outcome != "ACCEPTED" {
		t.Fatalf("seed profile: %#v", got)
	}

	// Every spelling the QR parser can hand us must land on the same person.
	for _, spelling := range []string{"@linh", "linh", "@LINH"} {
		got := svc.Handle(lookup("user_scanner", spelling))
		if got.Outcome != "ACCEPTED" {
			t.Fatalf("lookup %q must resolve: %#v", spelling, got)
		}
		var body struct {
			Profile struct {
				UserAccountID string `json:"userAccountId"`
				Handle        string `json:"handle"`
			} `json:"profile"`
		}
		if err := json.Unmarshal([]byte(got.OperationRef), &body); err != nil {
			t.Fatalf("lookup %q returned an unreadable profile: %v", spelling, err)
		}
		if body.Profile.UserAccountID != "user_linh" {
			t.Fatalf("lookup %q resolved to %q, want user_linh", spelling, body.Profile.UserAccountID)
		}
	}

	// A dead code must say "no such person" — not an empty profile, which a
	// caller would happily render as a blank card.
	missing := svc.Handle(lookup("user_scanner", "@nobody"))
	if missing.Outcome != "REJECTED" || missing.Error == nil || missing.Error.ErrorCode != "PROFILE_NOT_FOUND" {
		t.Fatalf("unknown handle must be PROFILE_NOT_FOUND, got %#v", missing)
	}

	// Malformed input is a DIFFERENT truth from "no such person" and must not
	// render the same way.
	for _, bad := range []string{"", "   ", "@"} {
		got := svc.Handle(lookup("user_scanner", bad))
		if got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "INVALID_PROFILE_READ" {
			t.Fatalf("malformed handle %q must be INVALID_PROFILE_READ, got %#v", bad, got)
		}
	}
}

// searchProfiles is the test driver for the PROFILE-SEARCH-001 tripwires.
//
// It reads operationRef, not Body, on purpose: parseCommandResult on the mobile
// side drops `body`, so anything that only sets Body is invisible to the app.
// A test that read Body would stay green while the feature was unreadable.
func searchProfiles(t *testing.T, svc *Service, query string, limit int) ([]Profile, map[string]any) {
	t.Helper()
	payload := map[string]any{"query": query}
	if limit != 0 {
		payload["limit"] = limit
	}
	got := svc.Handle(profileEnvelope("SearchProfiles", "user_searcher", payload))
	if got.Outcome != "ACCEPTED" {
		t.Fatalf("search %q (limit %d) must succeed: %#v", query, limit, got)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(got.OperationRef), &body); err != nil {
		t.Fatalf("search %q returned an unreadable operationRef: %v", query, err)
	}
	rawProfiles, ok := body["profiles"].([]any)
	if !ok {
		t.Fatalf("search %q body.profiles is %T, want an array", query, body["profiles"])
	}
	profiles := make([]Profile, 0, len(rawProfiles))
	for _, item := range rawProfiles {
		record, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("search %q returned a non-object profile: %T", query, item)
		}
		profiles = append(profiles, Profile{
			UserAccountID: stringField(record, "userAccountId"),
			Name:          stringField(record, "name"),
			Handle:        stringField(record, "handle"),
		})
	}
	return profiles, body
}

func stringField(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func seedSearchProfiles(t *testing.T, svc *Service, rows ...[2]string) {
	t.Helper()
	for i, row := range rows {
		actor := row[0]
		if got := svc.Handle(profileEnvelope("UpdateProfile", actor, map[string]any{
			"name": row[1], "handle": "@" + actor, "bio": "", "city": "Hanoi", "avatarPath": "",
		})); got.Outcome != "ACCEPTED" {
			t.Fatalf("seed #%d %s: %#v", i, actor, got)
		}
	}
}

func profileIDs(profiles []Profile) []string {
	out := make([]string, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, p.UserAccountID)
	}
	return out
}

// PROFILE-SEARCH-001 tripwire.
//
// The add-friend sheet's 「搜索 Proxy」 box rendered SEARCH_RESULTS — a
// hardcoded array — so every query returned the same people and the input was
// decoration. There was no server-side search at all: a Profile could be read
// only by userAccountID (yourself) or by an exact handle. Anyone you could not
// name exactly was unfindable, which is most of the point of a people search.
//
// These tests pin the three things that make a real search safe to ship: the
// matching rule, the limit/ordering, and — the one that matters most — that
// "nobody matches" is an ANSWER and not an error.
func TestSearchProfilesFindsByHandleAndNameCaseInsensitively(t *testing.T) {
	svc := New(nil)
	seedSearchProfiles(t, svc,
		[2]string{"linh", "Linh Nguyen"},
		[2]string{"lan", "Lan Pham"},
		[2]string{"mainguyen", "Mai"},
	)

	// The @ the UI puts in front of every handle must not have to be stripped
	// by the user before the search works.
	for _, query := range []string{"linh", "@linh", "@LINH", "Linh", "LINH"} {
		profiles, _ := searchProfiles(t, svc, query, 0)
		if got := profileIDs(profiles); len(got) != 1 || got[0] != "linh" {
			t.Fatalf("search %q = %v, want [linh]", query, got)
		}
	}

	// Substring, not prefix — "nguyen" is inside one handle AND one name.
	profiles, _ := searchProfiles(t, svc, "nguyen", 0)
	if got := profileIDs(profiles); len(got) != 2 {
		t.Fatalf("search \"nguyen\" = %v, want 2 hits", got)
	}

	// The display name is searched too, not only the handle: a user who knows
	// someone as "Lan Pham" has no idea what their handle is.
	profiles, _ = searchProfiles(t, svc, "Pham", 0)
	if got := profileIDs(profiles); len(got) != 1 || got[0] != "lan" {
		t.Fatalf("search \"Pham\" = %v, want [lan]", got)
	}
}

func TestSearchProfilesEmptyResultIsAnAnswerNotAnError(t *testing.T) {
	svc := New(nil)
	seedSearchProfiles(t, svc, [2]string{"linh", "Linh Nguyen"})

	profiles, body := searchProfiles(t, svc, "zzznobody", 0)

	// The whole point of this test. If a no-match search ever becomes a
	// rejection, the sheet tells the user 「搜索失败，请重试」 about a person who
	// simply does not exist — and they will keep tapping retry on a search that
	// already succeeded.
	// count crosses the wire as a JSON number, so it comes back as float64 —
	// comparing the interface against an untyped 0 would box an int and never
	// be equal, which reads as a baffling "count = 0, want 0".
	if count, ok := body["count"].(float64); !ok || count != 0 {
		t.Fatalf("count = %v (%T), want 0", body["count"], body["count"])
	}
	if len(profiles) != 0 {
		t.Fatalf("profiles = %v, want empty", profiles)
	}
	// A nil slice would JSON-encode to `null`; the client does
	// `profiles.length` and would crash on a *successful* search that found
	// nobody. Pin the concrete empty slice, not just its length.
	if body["profiles"] == nil {
		t.Fatalf("body.profiles is nil — it will serialize to null")
	}
}

func TestSearchProfilesRejectsQueriesTooShortToBeUseful(t *testing.T) {
	svc := New(nil)
	seedSearchProfiles(t, svc, [2]string{"linh", "Linh Nguyen"})

	// "林" is ONE character but THREE bytes. A byte-length gate would let it
	// through and hand back most of the user table — which is precisely what
	// MinProfileSearchQuery exists to prevent, and the app is Chinese-first, so
	// this is the common case rather than an edge case.
	for _, bad := range []string{"", " ", "a", "林", "@", "  a  "} {
		got := svc.Handle(profileEnvelope("SearchProfiles", "user_searcher", map[string]any{"query": bad}))
		if got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "INVALID_PROFILE_SEARCH" {
			t.Fatalf("query %q must be INVALID_PROFILE_SEARCH, got %#v", bad, got)
		}
	}

	// Two characters is enough — the boundary must not be off by one in the
	// other direction either.
	if got, _ := searchProfiles(t, svc, "li", 0); len(got) != 1 {
		t.Fatalf("a 2-character query must be accepted, got %d hits", len(got))
	}
}

func TestSearchProfilesIsAuthenticatedOnly(t *testing.T) {
	svc := New(nil)
	seedSearchProfiles(t, svc, [2]string{"linh", "Linh Nguyen"})

	// Site-wide search lets a caller enumerate accounts, so an anonymous
	// request must not be answered. The dispatcher also keeps this command off
	// the public allowlist; this pins the domain-level half.
	e := profileEnvelope("SearchProfiles", "", map[string]any{"query": "linh"})
	e.Actor = command.Actor{}
	got := svc.Handle(e)
	if got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "PROFILE_SEARCH_FORBIDDEN" {
		t.Fatalf("anonymous search must be PROFILE_SEARCH_FORBIDDEN, got %#v", got)
	}
}

func TestSearchProfilesHonoursLimitAndOrdersByHandle(t *testing.T) {
	svc := New(nil)
	seedSearchProfiles(t, svc,
		[2]string{"teamc", "Team C"},
		[2]string{"teama", "Team A"},
		[2]string{"teamb", "Team B"},
	)

	// Deterministic ordering by normalized handle. Without it the sheet would
	// reshuffle between two identical queries, and the in-memory order would
	// stop matching Postgres.
	profiles, _ := searchProfiles(t, svc, "team", 0)
	var handles []string
	for _, p := range profiles {
		handles = append(handles, p.Handle)
	}
	want := []string{"@teama", "@teamb", "@teamc"}
	if len(handles) != len(want) {
		t.Fatalf("handles = %v, want %v", handles, want)
	}
	for i := range want {
		if handles[i] != want[i] {
			t.Fatalf("handles = %v, want %v", handles, want)
		}
	}

	// The limit comes from the payload and is therefore untrusted: it is
	// clamped, not obeyed.
	if got, _ := searchProfiles(t, svc, "team", 2); len(got) != 2 {
		t.Fatalf("limit 2 returned %d rows, want 2", len(got))
	}
	// A nonsense limit falls back to the default rather than erroring.
	if got, _ := searchProfiles(t, svc, "team", -5); len(got) != 3 {
		t.Fatalf("limit -5 returned %d rows, want all 3", len(got))
	}
	if got, _ := searchProfiles(t, svc, "team", 10000); len(got) != 3 {
		t.Fatalf("limit 10000 returned %d rows, want all 3", len(got))
	}
}
