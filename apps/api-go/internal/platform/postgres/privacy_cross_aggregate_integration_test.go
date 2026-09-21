package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/media"
)

// LC-15 cross-aggregate erasure, against the real schema.
//
// The identity-side integration test proves the identity aggregate is
// emptied. This one proves the part that test cannot see: that the
// copies of the user's display identity living in OTHER aggregates are
// scrubbed too, that the authoritative ids survive the scrub, and that
// the pass does not reach one row further than it should.
//
// Every control row below exists to fail if the WHERE clause is
// loosened. Without them a statement like `SET author_display_name=''`
// with no WHERE would pass every assertion in the "erased" half.

// crossAggregateFixture is what the seed wrote, so the assertions can
// name the rows instead of re-deriving the ids.
type crossAggregateFixture struct {
	userID       string
	otherUserID  string
	avatarAsset  string
	postImage    string
	businessID   string
	conversation string
}

// seedCrossAggregateCopies writes one copy of the user's display
// identity into every aggregate the eraser claims to reach, plus a
// control row next to each one that must survive untouched.
func seedCrossAggregateCopies(t *testing.T, ctx context.Context, f crossAggregateFixture) {
	t.Helper()
	pool := testPool(t)
	now := time.Now().UTC()

	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}

	// The account row is not touched by this pass, but the business
	// account below has a foreign key to it.
	mustExec(`INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'ACTIVE')`, f.userID)
	mustExec(`INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, updated_at)
		VALUES ($1, 'Nguyen Van A', 'nguyenvana', 'xin chao', 'Ha Noi', $2, $3)`,
		f.userID, "assets/"+f.avatarAsset, now)

	// Two assets owned by the same user. Only the one the profile
	// points at is the avatar; the other is ordinary post media and
	// must stay PUBLIC. This is the assertion that catches a query
	// which identifies the avatar by owner alone.
	mustExec(`INSERT INTO media.media_assets
		(media_asset_id, owner_principal_type, owner_principal_id, media_type, original_storage_key,
		 playback_storage_key, processing_status, moderation_status, visibility_class,
		 ai_generation_source, ai_generated, created_at, updated_at)
		VALUES ($1, 'INDIVIDUAL', $2, 'IMAGE', $3, $3, 'READY', 'APPROVED', 'PUBLIC', 'USER_UPLOADED', false, $4, $4)`,
		f.avatarAsset, f.userID, f.avatarAsset+"_key", now)
	mustExec(`INSERT INTO media.media_assets
		(media_asset_id, owner_principal_type, owner_principal_id, media_type, original_storage_key,
		 playback_storage_key, processing_status, moderation_status, visibility_class,
		 ai_generation_source, ai_generated, created_at, updated_at)
		VALUES ($1, 'INDIVIDUAL', $2, 'IMAGE', $3, $3, 'READY', 'APPROVED', 'PUBLIC', 'USER_UPLOADED', false, $4, $4)`,
		f.postImage, f.userID, f.postImage+"_key", now)

	// Posts. The AGENT-typed row shares the user's id on purpose: agent
	// ids live in their own namespace, so the author_type guard is what
	// keeps it out of the scrub, and this row is the only thing that
	// can prove the guard is doing anything.
	mustExec(`INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, media_refs, visibility, city_scope, status, created_at)
		VALUES ($1, 'USER', $2, 'Nguyen Van A', 'hello', $3::jsonb, 'PUBLIC', 'hn', 'ACTIVE', $4)`,
		f.userID+"_post", f.userID, `[{"sortOrder":0,"mediaAssetId":"`+f.postImage+`"}]`, now)
	mustExec(`INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, media_refs, visibility, city_scope, status, created_at)
		VALUES ($1, 'AGENT', $2, 'Agent Name', 'hi', '[]'::jsonb, 'PUBLIC', 'hn', 'ACTIVE', $3)`,
		f.userID+"_agentpost", f.userID, now)
	mustExec(`INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, media_refs, visibility, city_scope, status, created_at)
		VALUES ($1, 'USER', $2, 'Other Person', 'other', '[]'::jsonb, 'PUBLIC', 'hn', 'ACTIVE', $3)`,
		f.otherUserID+"_post", f.otherUserID, now)

	// Statuses (expires_at must be after created_at, body 1..140 chars).
	mustExec(`INSERT INTO socialspace.statuses (status_id, author_id, author_display_name, body, location, created_at, expires_at)
		VALUES ($1, $2, 'Nguyen Van A', 'status body', '', $3, $4)`,
		f.userID+"_status", f.userID, now, now.Add(24*time.Hour))
	mustExec(`INSERT INTO socialspace.statuses (status_id, author_id, author_display_name, body, location, created_at, expires_at)
		VALUES ($1, $2, 'Other Person', 'other body', '', $3, $4)`,
		f.otherUserID+"_status", f.otherUserID, now, now.Add(24*time.Hour))

	// Opportunities: authoritative id in owner_id, display copy inside
	// the payload.
	mustExec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, responses, created_at)
		VALUES ($1, $2, $3::jsonb, 0, $4)`,
		f.userID+"_opp", f.userID, `{"owner":"Nguyen Van A","title":"t"}`, now)
	mustExec(`INSERT INTO marketplace.opportunities (id, owner_id, payload, responses, created_at)
		VALUES ($1, $2, $3::jsonb, 0, $4)`,
		f.otherUserID+"_opp", f.otherUserID, `{"owner":"Other Person","title":"t"}`, now)

	// Business directory: the membership is a commercial record, so the
	// row stays and only the name goes.
	mustExec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
		VALUES ($1, $2, 'Test Biz', 'ACTIVE', $3)`, f.businessID, f.userID, now)
	mustExec(`INSERT INTO business.member_directory (business_id, user_id, display_name, role, status, joined_at)
		VALUES ($1, $2, 'Nguyen Van A', 'OWNER', 'ACTIVE', $3)`, f.businessID, f.userID, now)
	mustExec(`INSERT INTO business.member_directory (business_id, user_id, display_name, role, status, joined_at)
		VALUES ($1, $2, 'Other Person', 'MEMBER', 'ACTIVE', $3)`, f.businessID, f.otherUserID, now)

	// Conversation messages. sender_snapshot has no writer today, so the
	// fixture supplies one — otherwise the statement that clears it
	// would be untestable and the counter would always read zero.
	mustExec(`INSERT INTO conversation.conversations (id, type, origin_type, origin_id, state, participants, created_at, last_message_at)
		VALUES ($1, 'AI_ASSIST', 'HOME', 'e2e_home', 'ACTIVE', $2::jsonb, $3, $3)`,
		f.conversation, `["`+f.userID+`"]`, now)
	mustExec(`INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, protection, view_count, sender_snapshot, created_at)
		VALUES ($1, $2, $3, 'TEXT', '{}'::jsonb, 0, $4::jsonb, $5)`,
		f.userID+"_msg", f.conversation, f.userID, `{"name":"Nguyen Van A"}`, now)
	mustExec(`INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, protection, view_count, sender_snapshot, created_at)
		VALUES ($1, $2, $3, 'TEXT', '{}'::jsonb, 0, $4::jsonb, $5)`,
		f.otherUserID+"_msg", f.conversation, f.otherUserID, `{"name":"Other Person"}`, now)

	// Push tokens: the delivery channel's own per-device row.
	mustExec(`INSERT INTO notification.device_tokens (id, user_account_id, device_id, platform, token, status, created_at, updated_at)
		VALUES ($1, $2, 'dev_a', 'IOS', 'tok_a', 'ACTIVE', $3, $3)`, f.userID+"_dt", f.userID, now)
	mustExec(`INSERT INTO notification.device_tokens (id, user_account_id, device_id, platform, token, status, created_at, updated_at)
		VALUES ($1, $2, 'dev_b', 'IOS', 'tok_b', 'ACTIVE', $3, $3)`, f.otherUserID+"_dt", f.otherUserID, now)
}

// cleanupCrossAggregateFixture removes everything the seed wrote.
// Order follows the foreign keys: messages before conversations,
// member_directory before business accounts.
func cleanupCrossAggregateFixture(t *testing.T, f crossAggregateFixture) {
	t.Helper()
	pool := testPool(t)
	bg := context.Background()
	for _, stmt := range []struct {
		query string
		arg   string
	}{
		{`DELETE FROM conversation.messages WHERE conversation_id = $1`, f.conversation},
		{`DELETE FROM conversation.conversations WHERE id = $1`, f.conversation},
		{`DELETE FROM business.member_directory WHERE business_id = $1`, f.businessID},
		{`DELETE FROM business.accounts WHERE id = $1`, f.businessID},
		{`DELETE FROM notification.device_tokens WHERE id = $1`, f.userID + "_dt"},
		{`DELETE FROM notification.device_tokens WHERE id = $1`, f.otherUserID + "_dt"},
		{`DELETE FROM localnet.posts WHERE id = $1`, f.userID + "_post"},
		{`DELETE FROM localnet.posts WHERE id = $1`, f.userID + "_agentpost"},
		{`DELETE FROM localnet.posts WHERE id = $1`, f.otherUserID + "_post"},
		{`DELETE FROM socialspace.statuses WHERE status_id = $1`, f.userID + "_status"},
		{`DELETE FROM socialspace.statuses WHERE status_id = $1`, f.otherUserID + "_status"},
		{`DELETE FROM marketplace.opportunities WHERE id = $1`, f.userID + "_opp"},
		{`DELETE FROM marketplace.opportunities WHERE id = $1`, f.otherUserID + "_opp"},
		{`DELETE FROM media.media_assets WHERE media_asset_id = $1`, f.avatarAsset},
		{`DELETE FROM media.media_assets WHERE media_asset_id = $1`, f.postImage},
		{`DELETE FROM identity.profiles WHERE user_account_id = $1`, f.userID},
		{`DELETE FROM identity.user_accounts WHERE id = $1`, f.userID},
	} {
		_, _ = pool.Exec(bg, stmt.query, stmt.arg)
	}
}

func newCrossAggregateFixture(runID string) crossAggregateFixture {
	return crossAggregateFixture{
		userID:       "xagg_" + runID,
		otherUserID:  "xagg_other_" + runID,
		avatarAsset:  "ma_xagg_avatar_" + runID,
		postImage:    "ma_xagg_post_" + runID,
		businessID:   "biz_xagg_" + runID,
		conversation: "conv_xagg_" + runID,
	}
}

// TestEraseCrossAggregateIdentityScrubsEveryCopy is the main proof.
func TestEraseCrossAggregateIdentityScrubsEveryCopy(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	f := newCrossAggregateFixture(itoa(time.Now().UnixNano()))
	seedCrossAggregateCopies(t, ctx, f)
	t.Cleanup(func() { cleanupCrossAggregateFixture(t, f) })

	receipt, err := repo.EraseCrossAggregateIdentity(ctx, f.userID)
	if err != nil {
		t.Fatalf("EraseCrossAggregateIdentity: %v", err)
	}

	// 1. The receipt must name every aggregate, and name it exactly.
	//    A counter that over-reports is as misleading as one that
	//    under-reports, so each is pinned to the one row seeded.
	want := map[string]struct{ got, want int }{
		"PostDisplayNames":       {receipt.PostDisplayNames, 1},
		"StatusDisplayNames":     {receipt.StatusDisplayNames, 1},
		"OpportunityOwners":      {receipt.OpportunityOwners, 1},
		"BusinessDirectoryNames": {receipt.BusinessDirectoryNames, 1},
		"ConversationSnapshots":  {receipt.ConversationSnapshots, 1},
		"AvatarAssetsUnserved":   {receipt.AvatarAssetsUnserved, 1},
		"PushTokens":             {receipt.PushTokens, 1},
	}
	for name, w := range want {
		if w.got != w.want {
			t.Errorf("receipt.%s = %d, the fixture seeded exactly %d", name, w.got, w.want)
		}
	}
	if receipt.Total() != 7 {
		t.Errorf("receipt.Total() = %d, expected 7", receipt.Total())
	}

	// 2. Each copy is gone from the database, checked independently of
	//    what the receipt claimed.
	gone := []struct {
		name  string
		query string
	}{
		{"posts.author_display_name",
			`SELECT count(*) FROM localnet.posts WHERE author_id = $1 AND author_type = 'USER' AND author_display_name <> ''`},
		{"statuses.author_display_name",
			`SELECT count(*) FROM socialspace.statuses WHERE author_id = $1 AND author_display_name <> ''`},
		{"opportunities payload owner",
			`SELECT count(*) FROM marketplace.opportunities WHERE owner_id = $1 AND payload ->> 'owner' <> ''`},
		{"business.member_directory.display_name",
			`SELECT count(*) FROM business.member_directory WHERE user_id = $1 AND display_name <> ''`},
		{"conversation.messages.sender_snapshot",
			`SELECT count(*) FROM conversation.messages WHERE sender_id = $1 AND sender_snapshot IS NOT NULL`},
		{"notification.device_tokens",
			`SELECT count(*) FROM notification.device_tokens WHERE user_account_id = $1`},
	}
	for _, tc := range gone {
		if n := countForUser(t, ctx, tc.query, f.userID); n != 0 {
			t.Errorf("%s: %d row(s) still carry the identity", tc.name, n)
		}
	}

	// 3. The authoritative references survive. De-attribution is not
	//    deletion: the post is still the user's post, it just no longer
	//    names them. If this half fails the change has become a content
	//    deletion, which is a different product promise.
	var posts, opps int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM localnet.posts WHERE author_id = $1 AND author_type = 'USER'`, f.userID).Scan(&posts); err != nil {
		t.Fatalf("count surviving posts: %v", err)
	}
	if posts != 1 {
		t.Errorf("the authored post must survive de-attributed, found %d", posts)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marketplace.opportunities WHERE owner_id = $1`, f.userID).Scan(&opps); err != nil {
		t.Fatalf("count surviving opportunities: %v", err)
	}
	if opps != 1 {
		t.Errorf("the opportunity must survive with owner_id intact, found %d", opps)
	}
	var displayName string
	if err := pool.QueryRow(ctx, `SELECT author_display_name FROM localnet.posts WHERE id = $1`, f.userID+"_post").Scan(&displayName); err != nil {
		t.Fatalf("read back the post: %v", err)
	}
	if displayName != "" {
		t.Errorf("expected the post's display name to be blanked, got %q", displayName)
	}

	// 4. The controls. Each of these fails if a WHERE clause is
	//    loosened, which is the only way to tell a targeted scrub from
	//    a table-wide one.
	controls := []struct {
		name  string
		query string
		arg   string
	}{
		{"another user's post", `SELECT count(*) FROM localnet.posts WHERE author_id = $1 AND author_display_name = 'Other Person'`, f.otherUserID},
		{"an AGENT post sharing the erased id", `SELECT count(*) FROM localnet.posts WHERE author_id = $1 AND author_type = 'AGENT' AND author_display_name = 'Agent Name'`, f.userID},
		{"another user's status", `SELECT count(*) FROM socialspace.statuses WHERE author_id = $1 AND author_display_name = 'Other Person'`, f.otherUserID},
		{"another user's opportunity", `SELECT count(*) FROM marketplace.opportunities WHERE owner_id = $1 AND payload ->> 'owner' = 'Other Person'`, f.otherUserID},
		{"another user's directory entry", `SELECT count(*) FROM business.member_directory WHERE user_id = $1 AND display_name = 'Other Person'`, f.otherUserID},
		{"another user's message snapshot", `SELECT count(*) FROM conversation.messages WHERE sender_id = $1 AND sender_snapshot IS NOT NULL`, f.otherUserID},
		{"another user's push token", `SELECT count(*) FROM notification.device_tokens WHERE user_account_id = $1`, f.otherUserID},
	}
	for _, tc := range controls {
		if n := countForUser(t, ctx, tc.query, tc.arg); n != 1 {
			t.Errorf("%s: expected 1 untouched row, found %d", tc.name, n)
		}
	}

	// 5. Idempotent. The executor erases before it bookkeeps, so a
	//    crash between the two replays this pass; a second pass that
	//    still reports work would mean the first pass had not finished.
	second, err := repo.EraseCrossAggregateIdentity(ctx, f.userID)
	if err != nil {
		t.Fatalf("second EraseCrossAggregateIdentity: %v", err)
	}
	if second.Total() != 0 {
		t.Errorf("a second cross-aggregate pass must be a no-op, got %+v", second)
	}
}

// TestEraseCrossAggregateIdentityUnservesTheAvatar checks the media
// half through the real serving path rather than by reading the column
// back: what matters is not that visibility_class changed, it is that
// /v1/media/play/<id> stops resolving.
func TestEraseCrossAggregateIdentityUnservesTheAvatar(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	f := newCrossAggregateFixture(itoa(time.Now().UnixNano()))
	seedCrossAggregateCopies(t, ctx, f)
	t.Cleanup(func() { cleanupCrossAggregateFixture(t, f) })

	// Positive control: before the erasure the avatar is deliverable.
	svc := media.NewWithDependencies(NewMediaRepository(pool), nil)
	if _, err := svc.ResolveServingPath(ctx, f.avatarAsset, "play"); err != nil {
		t.Fatalf("precondition: the avatar should be deliverable before the erasure, got %v", err)
	}

	if _, err := repo.EraseCrossAggregateIdentity(ctx, f.userID); err != nil {
		t.Fatalf("EraseCrossAggregateIdentity: %v", err)
	}

	if _, err := svc.ResolveServingPath(ctx, f.avatarAsset, "play"); err == nil {
		t.Errorf("the avatar must stop resolving after the erasure")
	}

	// The row survives — the audit trail and any existing reference
	// still resolve — with the value that means "not publicly
	// deliverable".
	var visibility string
	if err := pool.QueryRow(ctx, `SELECT visibility_class FROM media.media_assets WHERE media_asset_id = $1`, f.avatarAsset).Scan(&visibility); err != nil {
		t.Fatalf("the avatar asset row must survive the erasure: %v", err)
	}
	if visibility != "OWNER_ONLY" {
		t.Errorf("expected visibility_class=OWNER_ONLY, got %q", visibility)
	}

	// Anti-overreach: the user's ordinary post media belongs to the
	// same owner and must remain deliverable. media_assets has no
	// purpose column, so an implementation that found the avatar by
	// owner_principal_id would fail exactly here.
	if _, err := svc.ResolveServingPath(ctx, f.postImage, "play"); err != nil {
		t.Errorf("ordinary post media must stay deliverable, got %v", err)
	}
}

// TestAvatarUnservingRequiresTheProfileRowToStillExist pins the
// ordering the service enforces. This is not a style preference: the
// avatar is identifiable only through identity.profiles.avatar_path, so
// running the identity eraser first destroys the only reference and
// leaves the photo publicly servable forever. The test performs the
// two passes in the wrong order and shows the avatar surviving — which
// is what makes the correct order in advancePrivacyDeletion
// load-bearing rather than incidental.
func TestAvatarUnservingRequiresTheProfileRowToStillExist(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	f := newCrossAggregateFixture(itoa(time.Now().UnixNano()))
	seedCrossAggregateCopies(t, ctx, f)
	t.Cleanup(func() { cleanupCrossAggregateFixture(t, f) })

	// Wrong order, on purpose.
	if _, err := repo.ErasePersonalData(ctx, f.userID); err != nil {
		t.Fatalf("ErasePersonalData: %v", err)
	}
	receipt, err := repo.EraseCrossAggregateIdentity(ctx, f.userID)
	if err != nil {
		t.Fatalf("EraseCrossAggregateIdentity: %v", err)
	}
	if receipt.AvatarAssetsUnserved != 0 {
		t.Errorf("expected the avatar to be unreachable once the profile row is gone, got %d un-served", receipt.AvatarAssetsUnserved)
	}
	svc := media.NewWithDependencies(NewMediaRepository(pool), nil)
	if _, err := svc.ResolveServingPath(ctx, f.avatarAsset, "play"); err != nil {
		t.Errorf("this test documents the wrong order, so the avatar is expected to stay servable — ResolveServingPath said %v", err)
	}
	// The name scrub still works in this order: it does not depend on
	// the profile row, which is why only the avatar is order-sensitive.
	if receipt.PostDisplayNames != 1 {
		t.Errorf("the name scrub must not depend on the profile row, got PostDisplayNames=%d", receipt.PostDisplayNames)
	}
}

// TestEraseCrossAggregateIdentityRejectsEmptyUserID mirrors the guard
// on the identity-side eraser: an empty parameter would turn the
// DELETE on push tokens into a table-wide wipe.
func TestEraseCrossAggregateIdentityRejectsEmptyUserID(t *testing.T) {
	pool := testPool(t)
	repo := NewIdentityRepository(pool)
	for _, id := range []string{"", "   "} {
		if _, err := repo.EraseCrossAggregateIdentity(context.Background(), id); err == nil {
			t.Errorf("user id %q must be rejected, not treated as a table-wide delete", id)
		}
	}
	if !strings.Contains(identity.CrossAggregateErasureBoundary, "LIMITATION") {
		t.Errorf("the audit boundary must disclose the un-purged blob, not only the statutory retentions")
	}
}
