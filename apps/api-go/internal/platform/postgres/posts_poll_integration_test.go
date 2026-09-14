package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/localnet"
)

// TestSavePostPollJoinsAmbientTransaction pins POLL-VOTE-001's write path.
//
// The bug this catches, found against a real database and reproduced by
// nothing in `go test ./...` at the time: command handling runs inside a
// transaction carried on the context. CreatePost writes the post row there,
// but SavePostPoll originally called r.pool.Begin(ctx) — a *second*, separate
// connection. That connection cannot see the uncommitted post, so the
// post_id -> posts(id) foreign key blew up:
//
//	insert or update on table "post_polls" violates foreign key
//	constraint "post_polls_post_id_fkey"
//
// The in-memory repository has no foreign keys at all, so every service-level
// unit test stayed green while creating a poll failed 100% of the time against
// Postgres. Any repository method that writes a *child* row in the same
// command as its parent must use runInTransaction (which joins the ambient
// transaction) rather than pool.Begin.
func TestSavePostPollJoinsAmbientTransaction(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)

	runID := itoa(time.Now().UnixNano())
	postID := "post_poll_tx_" + runID
	expires := time.Now().UTC().Add(time.Hour)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM localnet.posts WHERE id = $1`, postID)
	})

	// Mirror the real command: post + poll written inside ONE ambient
	// transaction, committed only after both statements succeed.
	err := runInTransaction(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		post := localnet.Post{
			ID:         postID,
			AuthorType: "USER",
			AuthorID:   "poll_tx_author_" + runID,
			Body:       "POLL-VOTE-001 事务探针",
			Visibility: "PUBLIC",
			// The service defaults this to UNKNOWN before it ever reaches the
			// repository (scene_type is NOT NULL); mirror that here.
			SceneType: "UNKNOWN",
			Status:    "PUBLISHED",
			CreatedAt: time.Now().UTC(),
		}
		if err := repo.CreatePost(ctx, post); err != nil {
			return err
		}
		return repo.SavePostPoll(ctx, localnet.PostPoll{
			PostID:    postID,
			ExpiresAt: &expires,
			Options: []localnet.PostPollOption{
				{OptionID: "poll_tx_a_" + runID, Label: "A", SortOrder: 0},
				{OptionID: "poll_tx_b_" + runID, Label: "B", SortOrder: 1},
			},
		})
	})
	if err != nil {
		t.Fatalf("post + poll in one ambient transaction: %v", err)
	}

	// And the vote path, also inside a transaction (VotePostPoll records the
	// vote and immediately re-reads the tally in the same command).
	voter := "poll_tx_voter_" + runID
	if err := runInTransaction(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		if err := repo.RecordPollVote(ctx, postID, "poll_tx_b_"+runID, voter); err != nil {
			return err
		}
		tallies, err := repo.ListPollsForPosts(ctx, []string{postID}, voter)
		if err != nil {
			return err
		}
		tally, ok := tallies[postID]
		if !ok {
			t.Fatalf("poll missing from tally after voting")
		}
		if tally.Counts["poll_tx_b_"+runID] != 1 {
			t.Fatalf("vote not visible inside the same transaction: %+v", tally.Counts)
		}
		if tally.VotedOptionID != "poll_tx_b_"+runID {
			t.Fatalf("VotedOptionID = %q", tally.VotedOptionID)
		}
		return nil
	}); err != nil {
		t.Fatalf("vote inside a transaction: %v", err)
	}

	// After commit the poll must be readable with zero-vote options intact.
	tallies, err := repo.ListPollsForPosts(ctx, []string{postID}, "someone_else_"+runID)
	if err != nil {
		t.Fatalf("ListPollsForPosts after commit: %v", err)
	}
	tally := tallies[postID]
	if len(tally.Poll.Options) != 2 {
		t.Fatalf("want 2 options, got %+v", tally.Poll.Options)
	}
	if tally.Counts["poll_tx_b_"+runID] != 1 || tally.Counts["poll_tx_a_"+runID] != 0 {
		t.Fatalf("counts = %+v, want a=0 b=1", tally.Counts)
	}
	// votedOptionId is per-viewer: a different viewer must NOT inherit the vote.
	if tally.VotedOptionID != "" {
		t.Fatalf("another viewer must not see someone else's vote, got %q", tally.VotedOptionID)
	}
}

// TestPollOptionsAreScopedToTheirPost pins POLL-OPTION-SCOPE-001.
//
// The bug: post_poll_options originally had option_id alone as its PRIMARY
// KEY. Option ids are chosen by the client (`opt_<ts>_<idx>`), so two posts
// can legitimately carry the same ids — republishing a draft, retrying a
// failed publish, or any client that hardcodes ids. With a global PK, the
// second post's INSERT hit `ON CONFLICT (option_id) DO UPDATE`, which
// rewrites label/sort_order but NOT post_id. Result: the second post silently
// ended up with **zero** options (the poll rendered empty / not at all), and
// the first post's options were quietly relabelled.
//
// The identity of an option is (post_id, option_id). Nothing more global than
// that may be assumed, because nothing global is actually guaranteed.
func TestPollOptionsAreScopedToTheirPost(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)

	runID := itoa(time.Now().UnixNano())
	postA := "post_pollscope_a_" + runID
	postB := "post_pollscope_b_" + runID
	expires := time.Now().UTC().Add(time.Hour)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM localnet.posts WHERE id = ANY($1)`, []string{postA, postB})
	})

	// Deliberately IDENTICAL option ids on both posts — that is the whole point.
	shared := []localnet.PostPollOption{
		{OptionID: "shared_opt_1", Label: "A1", SortOrder: 0},
		{OptionID: "shared_opt_2", Label: "A2", SortOrder: 1},
	}
	other := []localnet.PostPollOption{
		{OptionID: "shared_opt_1", Label: "B1", SortOrder: 0},
		{OptionID: "shared_opt_2", Label: "B2", SortOrder: 1},
	}
	seed := func(id string, opts []localnet.PostPollOption) {
		t.Helper()
		if err := runInTransaction(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
			post := localnet.Post{
				ID: id, AuthorType: "USER", AuthorID: "pollscope_" + runID,
				Body: "POLL-OPTION-SCOPE-001", Visibility: "PUBLIC",
				SceneType: "UNKNOWN", Status: "PUBLISHED", CreatedAt: time.Now().UTC(),
			}
			if err := repo.CreatePost(ctx, post); err != nil {
				return err
			}
			return repo.SavePostPoll(ctx, localnet.PostPoll{PostID: id, ExpiresAt: &expires, Options: opts})
		}); err != nil {
			t.Fatalf("seed %s: %v", id, err)
		}
	}
	seed(postA, shared)
	seed(postB, other)

	tallies, err := repo.ListPollsForPosts(ctx, []string{postA, postB}, "nobody_"+runID)
	if err != nil {
		t.Fatalf("ListPollsForPosts: %v", err)
	}
	a, okA := tallies[postA]
	b, okB := tallies[postB]
	if !okA || !okB {
		t.Fatalf("both polls must exist, got %+v", tallies)
	}
	if len(a.Poll.Options) != 2 {
		t.Fatalf("post A lost its options (got %d): %+v", len(a.Poll.Options), a.Poll.Options)
	}
	if len(b.Poll.Options) != 2 {
		t.Fatalf("post B never got options (got %d): %+v", len(b.Poll.Options), b.Poll.Options)
	}
	// And each post must keep its OWN labels, not the other post's.
	labels := map[string]map[string]string{postA: {}, postB: {}}
	for _, o := range a.Poll.Options {
		labels[postA][o.OptionID] = o.Label
	}
	for _, o := range b.Poll.Options {
		labels[postB][o.OptionID] = o.Label
	}
	if labels[postA]["shared_opt_1"] != "A1" || labels[postA]["shared_opt_2"] != "A2" {
		t.Fatalf("post A options were clobbered: %+v", labels[postA])
	}
	if labels[postB]["shared_opt_1"] != "B1" || labels[postB]["shared_opt_2"] != "B2" {
		t.Fatalf("post B options were clobbered: %+v", labels[postB])
	}

	// A vote on A's option must not land on B's identically-named option.
	if err := repo.RecordPollVote(ctx, postA, "shared_opt_1", "pollscope_voter_"+runID); err != nil {
		t.Fatalf("RecordPollVote: %v", err)
	}
	after, err := repo.ListPollsForPosts(ctx, []string{postA, postB}, "pollscope_voter_"+runID)
	if err != nil {
		t.Fatalf("ListPollsForPosts after vote: %v", err)
	}
	if after[postA].Counts["shared_opt_1"] != 1 {
		t.Fatalf("vote missing on post A: %+v", after[postA].Counts)
	}
	if n := after[postB].Counts["shared_opt_1"]; n != 0 {
		t.Fatalf("vote leaked into post B (same option id): %+v", after[postB].Counts)
	}
}
