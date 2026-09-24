package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// EraseCrossAggregateIdentity carries out the second half of LC-15
// (Vietnam PDP 91/2025/QH15 Art. 32): the copies of the user's
// display identity that other aggregates snapshotted, plus the two
// per-user channels that stop making sense once the account is
// anonymised.
//
// This deliberately lives in its own file rather than in identity.go.
// It is the only place in the codebase where the erasure executor
// writes outside the identity schema, and a reader asking "how far
// does the erasure reach?" should be able to answer it by reading one
// file. Every statement below was chosen after checking the actual
// column semantics against the live schema; none of them is inferred:
//
//   - localnet.posts.author_id and socialspace.statuses.author_id hold
//     the *account* id for a user-authored row (localnet/service.go
//     sets AuthorID from envelope.Actor.ID), so matching on the
//     erased user id is exact. posts also carries author_type, and
//     the 'USER' guard matters: AGENT / MERCHANT / AI_NATIVE authors
//     live in their own id namespace and must not be caught by an id
//     that happens to coincide.
//   - socialspace.statuses has NO author_type column, so it cannot be
//     scoped that way. It is safe without one because agent ids are
//     prefixed "agent_" while accounts are "user_", and statuses are
//     written with the raw actor id.
//   - marketplace.opportunities stores the authoritative id in
//     owner_id and the display name inside payload->>'owner'. The
//     authoritative column is untouched.
//   - identity.profiles.avatar_path is the string 'assets/' ||
//     media_asset_id. That join is the ONLY way to identify the
//     avatar: media.media_assets has no purpose/kind column, so a
//     query by owner_principal_id alone would sweep in the user's
//     ordinary post media. This is why the service runs this method
//     before ErasePersonalData deletes the profile row.
//
// Everything runs in ONE transaction, so a partial pass is not a
// reachable state. What is left behind on purpose — and the one thing
// this build cannot do — is spelled out in
// identity.CrossAggregateErasureBoundary.
func (r *IdentityRepository) EraseCrossAggregateIdentity(ctx context.Context, userID string) (identity.ErasedCrossAggregate, error) {
	var receipt identity.ErasedCrossAggregate
	if strings.TrimSpace(userID) == "" {
		return receipt, errors.New("erase cross-aggregate identity: empty user id")
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return receipt, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Each statement is its own count, so the receipt can answer
	// "which aggregate did you actually touch?".
	step := func(dest *int, query string, args ...any) error {
		tag, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		*dest += int(tag.RowsAffected())
		return nil
	}

	// 1. The avatar. This MUST be the first statement that depends on
	//    identity.profiles, because the profile row is what makes the
	//    avatar identifiable at all.
	//
	//    Demote rather than delete. /v1/media/play/<id> is public and
	//    unauthenticated, and ResolveServingPath refuses anything whose
	//    visibility_class is not PUBLIC — so OWNER_ONLY is what turns
	//    the URL into a 404. The row stays so that the audit trail and
	//    any existing reference keep resolving. OWNER_ONLY is the
	//    honest value from the existing closed set
	//    (OWNER_ONLY | PUBLIC | FOLLOWERS | AGENT_ONLY); no new value
	//    is invented for "erased", because a value that means something
	//    else is how a closed set rots.
	//
	//    Only PUBLIC rows are counted: a row that was already
	//    unreachable is not something this pass achieved.
	if err := step(&receipt.AvatarAssetsUnserved, `
		UPDATE media.media_assets AS asset
		SET visibility_class = 'OWNER_ONLY', updated_at = now()
		FROM identity.profiles AS profile
		WHERE profile.user_account_id = $1
		  AND profile.avatar_path = 'assets/' || asset.media_asset_id
		  AND asset.visibility_class = 'PUBLIC'
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}

	// 2. The display-name snapshots on authored content. The rows
	//    survive: other users' replies, bookmarks and reposts point at
	//    them, and blanking the name is what migration 079 already
	//    established as the remedy (readers resolve the author by id
	//    and fall back to a neutral label when the name is empty).
	if err := step(&receipt.PostDisplayNames, `
		UPDATE localnet.posts
		SET author_display_name = ''
		WHERE author_id = $1 AND author_type = 'USER' AND author_display_name <> ''
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}
	if err := step(&receipt.StatusDisplayNames, `
		UPDATE socialspace.statuses
		SET author_display_name = ''
		WHERE author_id = $1 AND author_display_name <> ''
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}
	if err := step(&receipt.OpportunityOwners, `
		UPDATE marketplace.opportunities
		SET payload = jsonb_set(payload, '{owner}', '""')
		WHERE owner_id = $1 AND payload ->> 'owner' <> ''
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}

	// 3. The same name, kept in a business-scoped directory. The
	//    membership row itself is a commercial record and stays; only
	//    the display name goes.
	if err := step(&receipt.BusinessDirectoryNames, `
		UPDATE business.member_directory
		SET display_name = ''
		WHERE user_id = $1 AND display_name <> ''
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}

	// 4. A sender-identity snapshot on conversation messages. Migration
	//    039 defines the column and nothing writes it yet; the
	//    statement is here so the first writer to land cannot open a
	//    leak the erasure does not cover. Reads zero until then, which
	//    the integration test demonstrates by seeding a row itself.
	if err := step(&receipt.ConversationSnapshots, `
		UPDATE conversation.messages
		SET sender_snapshot = NULL
		WHERE sender_id = $1 AND sender_snapshot IS NOT NULL
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}

	// 5. Push tokens. identity.device_registrations is deleted by the
	//    identity-side eraser, but the delivery channel keeps its own
	//    per-device row. Leaving it means the platform keeps pushing to
	//    a device belonging to an account that can no longer log in —
	//    a residue of exactly the "设备" the shipped copy promises to
	//    delete. There is no ledger semantics here, so this is a real
	//    DELETE.
	if err := step(&receipt.PushTokens, `
		DELETE FROM notification.device_tokens WHERE user_account_id = $1
	`, userID); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return identity.ErasedCrossAggregate{}, err
	}
	return receipt, nil
}

var _ identity.CrossAggregateEraser = (*IdentityRepository)(nil)
