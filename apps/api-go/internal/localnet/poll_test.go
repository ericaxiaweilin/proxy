package localnet

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// POLL-VOTE-001 — 投票必须真的能投、真的能数票。
//
// 这些用例存在的理由：投票的 UI（ComposerV2Screen「添加投票」）和客户端 payload
// 早就写完了，而服务端一个 poll 字段都没有 —— Go 静默忽略未知字段，于是用户
// 建出一个**谁都投不了、也永远没有票数**的投票。那是「UI 承诺、服务端没有」
// 这种缺陷里最难看的一种：它连装饰都算不上，"投票"两个字本身就在承诺能投。
//
// 与 GHOST-24H-001 同源，注入验证的 pin 见 scripts/check-regression-contracts.sh。

func pollCreatePayload(body string, expiresAt time.Time, options ...[2]string) map[string]any {
	opts := make([]any, 0, len(options))
	for i, o := range options {
		opts = append(opts, map[string]any{"optionId": o[0], "label": o[1], "sortOrder": i})
	}
	return map[string]any{
		"authorType": "USER",
		"body":       body,
		"visibility": "PUBLIC",
		"poll": map[string]any{
			"expiresAt": expiresAt.UTC().Format(time.RFC3339),
			"options":   opts,
		},
	}
}

func createPostWithPoll(t *testing.T, s *Service, actorID, body string, expiresAt time.Time, options ...[2]string) string {
	t.Helper()
	res := s.Handle(actorEnvelope(actorID, "CreatePost", pollCreatePayload(body, expiresAt, options...)))
	if res.Outcome != "ACCEPTED" || res.Aggregate == nil {
		t.Fatalf("CreatePost with poll: outcome=%s err=%+v", res.Outcome, res.Error)
	}
	return res.Aggregate.ID
}

// pollViewFor 以 viewerID 的视角读回这条帖子的投票。
func pollViewFor(t *testing.T, s *Service, postID, viewerID string) *PostPollView {
	t.Helper()
	res := s.Handle(actorEnvelope(viewerID, "ListPostsByIds", map[string]any{"postIds": []string{postID}}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("ListPostsByIds: outcome=%s err=%+v", res.Outcome, res.Error)
	}
	var payload struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &payload); err != nil {
		t.Fatalf("decode posts: %v", err)
	}
	if len(payload.Posts) == 0 {
		t.Fatalf("post %s is not visible to %s", postID, viewerID)
	}
	return payload.Posts[0].Poll
}

func votePoll(t *testing.T, s *Service, actorID, postID, optionID string) command.Result {
	t.Helper()
	return s.Handle(actorEnvelope(actorID, "VotePostPoll", map[string]any{
		"postId":   postID,
		"optionId": optionID,
	}))
}

func TestCreatePostWithPollExposesOptionsWithZeroVotes(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	expiry := now.Add(24 * time.Hour)

	postID := createPostWithPoll(t, s, "user_001", "投个票", expiry,
		[2]string{"opt_a", "河内"}, [2]string{"opt_b", "西贡"})

	poll := pollViewFor(t, s, postID, "user_002")
	if poll == nil {
		t.Fatal("the post has no poll — the poll was silently dropped, which is the exact bug")
	}
	if len(poll.Options) != 2 {
		t.Fatalf("want 2 options, got %d", len(poll.Options))
	}
	if poll.Options[0].Label != "河内" || poll.Options[1].Label != "西贡" {
		t.Fatalf("options came back in the wrong order: %+v", poll.Options)
	}
	if poll.TotalVotes != 0 || poll.Options[0].VoteCount != 0 {
		t.Fatalf("a brand new poll must have 0 votes, got total=%d", poll.TotalVotes)
	}
	if poll.Closed {
		t.Fatal("a poll that expires in 24h must not be closed")
	}
	if poll.VotedOptionID != "" {
		t.Fatalf("viewer has not voted, votedOptionId must be empty, got %q", poll.VotedOptionID)
	}
}

func TestCreatePostWithoutPollHasNoPoll(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	id := createPostAs(t, s, "user_001", "普通帖子", "PUBLIC")
	if poll := pollViewFor(t, s, id, "user_002"); poll != nil {
		t.Fatalf("a post without a poll must not grow one: %+v", poll)
	}
}

func TestVotePostPollCountsVotes(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	postID := createPostWithPoll(t, s, "user_001", "投个票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})

	if res := votePoll(t, s, "user_002", postID, "opt_a"); res.Outcome != "ACCEPTED" {
		t.Fatalf("vote: outcome=%s err=%+v", res.Outcome, res.Error)
	}
	if res := votePoll(t, s, "user_003", postID, "opt_b"); res.Outcome != "ACCEPTED" {
		t.Fatalf("vote: outcome=%s err=%+v", res.Outcome, res.Error)
	}

	poll := pollViewFor(t, s, postID, "user_002")
	if poll.TotalVotes != 2 {
		t.Fatalf("want 2 votes, got %d", poll.TotalVotes)
	}
	if poll.Options[0].VoteCount != 1 || poll.Options[1].VoteCount != 1 {
		t.Fatalf("want 1/1, got %d/%d", poll.Options[0].VoteCount, poll.Options[1].VoteCount)
	}
	// 「我投了哪个」是 per-viewer 的：同一次投票，两个看到的一定是自己的选择。
	if poll.VotedOptionID != "opt_a" {
		t.Fatalf("viewer voted opt_a, got %q", poll.VotedOptionID)
	}
	other := pollViewFor(t, s, postID, "user_003")
	if other.VotedOptionID != "opt_b" {
		t.Fatalf("other viewer voted opt_b, got %q", other.VotedOptionID)
	}
}

func TestVotePostPollIsOneVotePerUserAndSwitchable(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	postID := createPostWithPoll(t, s, "user_001", "投个票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})

	// 同一人投两次：先 a，改投 b —— 总数必须还是 1，不能变成 2。
	if res := votePoll(t, s, "user_002", postID, "opt_a"); res.Outcome != "ACCEPTED" {
		t.Fatalf("first vote: %s", res.Outcome)
	}
	if res := votePoll(t, s, "user_002", postID, "opt_b"); res.Outcome != "ACCEPTED" {
		t.Fatalf("switch vote: %s", res.Outcome)
	}
	poll := pollViewFor(t, s, postID, "user_002")
	if poll.TotalVotes != 1 {
		t.Fatalf("switching a vote must not add a vote: total=%d", poll.TotalVotes)
	}
	if poll.VotedOptionID != "opt_b" {
		t.Fatalf("want votedOptionId=opt_b, got %q", poll.VotedOptionID)
	}
	if poll.Options[0].VoteCount != 0 || poll.Options[1].VoteCount != 1 {
		t.Fatalf("want 0/1 after switching, got %d/%d", poll.Options[0].VoteCount, poll.Options[1].VoteCount)
	}
}

func TestVotePostPollRejectsUnknownOption(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	postID := createPostWithPoll(t, s, "user_001", "投个票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})

	res := votePoll(t, s, "user_002", postID, "opt_nope")
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "POLL_OPTION_NOT_FOUND" {
		t.Fatalf("want POLL_OPTION_NOT_FOUND, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
}

func TestVotePostPollRejectsOptionBelongingToAnotherPost(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	postA := createPostWithPoll(t, s, "user_001", "A 的投票", now.Add(time.Hour),
		[2]string{"opt_a1", "A1"}, [2]string{"opt_a2", "A2"})
	createPostWithPoll(t, s, "user_001", "B 的投票", now.Add(time.Hour),
		[2]string{"opt_b1", "B1"}, [2]string{"opt_b2", "B2"})

	// 拿 B 帖子的选项去投 A 帖子的票 —— 必须拒绝，不能悄悄记成一票。
	res := votePoll(t, s, "user_002", postA, "opt_b1")
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "POLL_OPTION_NOT_FOUND" {
		t.Fatalf("want POLL_OPTION_NOT_FOUND for a foreign option, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
	if poll := pollViewFor(t, s, postA, "user_002"); poll.TotalVotes != 0 {
		t.Fatalf("a rejected vote must not be counted, total=%d", poll.TotalVotes)
	}
}

func TestVotePostPollRejectedAfterExpiryButResultsStayVisible(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, clockSvc := newGhostClockService(t, now)
	postID := createPostWithPoll(t, s, "user_001", "投个票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})

	if res := votePoll(t, s, "user_002", postID, "opt_a"); res.Outcome != "ACCEPTED" {
		t.Fatalf("vote: %s", res.Outcome)
	}
	clockSvc.Advance(2 * time.Hour)

	res := votePoll(t, s, "user_003", postID, "opt_b")
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "POLL_CLOSED" {
		t.Fatalf("want POLL_CLOSED after expiry, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
	// 到期只关闭投票，不隐藏结果 —— 把结果一起藏掉等于开奖前把票箱烧了。
	poll := pollViewFor(t, s, postID, "user_002")
	if poll == nil || !poll.Closed {
		t.Fatalf("poll must be marked closed, got %+v", poll)
	}
	if poll.TotalVotes != 1 || poll.Options[0].VoteCount != 1 {
		t.Fatalf("results must survive expiry: total=%d", poll.TotalVotes)
	}
}

func TestPollWithoutExpiryNeverCloses(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, clockSvc := newGhostClockService(t, now)

	res := s.Handle(actorEnvelope("user_001", "CreatePost", map[string]any{
		"authorType": "USER",
		"body":       "永久投票",
		"visibility": "PUBLIC",
		"poll": map[string]any{
			"options": []any{
				map[string]any{"optionId": "opt_a", "label": "A", "sortOrder": 0},
				map[string]any{"optionId": "opt_b", "label": "B", "sortOrder": 1},
			},
		},
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("CreatePost: %s (%+v)", res.Outcome, res.Error)
	}
	postID := res.Aggregate.ID
	clockSvc.Advance(10 * 365 * 24 * time.Hour)
	if poll := pollViewFor(t, s, postID, "user_002"); poll == nil || poll.Closed {
		t.Fatalf("a poll with no expiry must stay open, got %+v", poll)
	}
	if res := votePoll(t, s, "user_002", postID, "opt_a"); res.Outcome != "ACCEPTED" {
		t.Fatalf("voting an open-ended poll: %s", res.Outcome)
	}
}

func TestCreatePostRejectsPollWithTooFewOptions(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	res := s.Handle(actorEnvelope("user_001", "CreatePost", pollCreatePayload("只有一个选项", now.Add(time.Hour),
		[2]string{"opt_a", "A"})))
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "INVALID_POST_POLL" {
		t.Fatalf("want INVALID_POST_POLL, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
}

func TestCreatePostRejectsMultiSelectPollInsteadOfDowngrading(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	payload := pollCreatePayload("多选投票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})
	payload["poll"].(map[string]any)["multiSelect"] = true

	res := s.Handle(actorEnvelope("user_001", "CreatePost", payload))
	// 关键是**拒绝**而不是「悄悄按单选存」。静默降级正是 GHOST-24H-001 的病根。
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "POLL_MULTISELECT_UNSUPPORTED" {
		t.Fatalf("want POLL_MULTISELECT_UNSUPPORTED, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
}

func TestCreatePostRejectsPollThatExpiresInThePast(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	res := s.Handle(actorEnvelope("user_001", "CreatePost", pollCreatePayload("昨天的投票", now.Add(-time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})))
	// 同 GHOST-24H-001：不接受「已经截止的投票」，那会产出一条谁都投不了的投票。
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "INVALID_POST_POLL_EXPIRES_AT" {
		t.Fatalf("want INVALID_POST_POLL_EXPIRES_AT, got outcome=%s err=%+v", res.Outcome, res.Error)
	}
}

// 投票权挂在**已认证的用户**上，这是「一人一票」这条约束唯一的支点。
// 匿名信封没有稳定身份，服务端也就无从判断「这一票是不是投过了」——
// 一旦放行，一人一票立刻退化成一人无限票，投票结果不再有任何意义。
func TestVotePostPollRequiresAUserActor(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	postID := createPostWithPoll(t, s, "user_001", "投个票", now.Add(time.Hour),
		[2]string{"opt_a", "A"}, [2]string{"opt_b", "B"})

	// 注意：envelopeFor 的 actor 恒为 USER/user_001，想造匿名信封必须显式改。
	cases := []struct {
		name  string
		actor command.Actor
	}{
		{"no actor id", command.Actor{Type: "USER", ID: ""}},
		{"anonymous type", command.Actor{Type: "ANONYMOUS", ID: "anon_001"}},
	}
	for _, tc := range cases {
		env := envelopeFor("", "VotePostPoll", map[string]any{"postId": postID, "optionId": "opt_a"})
		env.Actor = tc.actor
		res := s.Handle(env)
		if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "POLL_VOTE_NOT_ALLOWED" {
			t.Fatalf("%s: want POLL_VOTE_NOT_ALLOWED, got outcome=%s err=%+v", tc.name, res.Outcome, res.Error)
		}
	}
}
