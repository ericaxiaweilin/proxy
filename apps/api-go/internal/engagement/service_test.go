package engagement

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Post", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func TestPostInteractions(t *testing.T) {
	s := New()

	// Follow
	r := s.Handle(envelopeFor("FollowProfile", map[string]any{"followeeId": "agent_linh"}, ""))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "FOLLOWING" {
		t.Fatalf("follow: got %s/%s", r.Outcome, r.Aggregate.State)
	}

	// React
	r = s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_1", "kind": "HELPFUL"}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("react: got %s", r.Outcome)
	}

	// Reply
	r = s.Handle(envelopeFor("ReplyToPost", map[string]any{"postId": "post_1", "body": "写得真好"}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("reply: got %s", r.Outcome)
	}

	// Repost
	r = s.Handle(envelopeFor("RepostPost", map[string]any{"postId": "post_1"}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("repost: got %s", r.Outcome)
	}

	// Bookmark
	r = s.Handle(envelopeFor("BookmarkPost", map[string]any{"postId": "post_1"}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("bookmark: got %s", r.Outcome)
	}

	// Engagement 汇总
	r = s.Handle(envelopeFor("GetPostEngagement", map[string]any{"postId": "post_1"}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("engagement: got %s", r.Outcome)
	}
	var view struct {
		Engagement PostEngagement `json:"engagement"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Engagement.Reactions != 1 || view.Engagement.Replies != 1 || view.Engagement.Reposts != 1 {
		t.Fatalf("engagement counts wrong: %+v", view.Engagement)
	}
}

func TestInvalidReply(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("ReplyToPost", map[string]any{"postId": "post_1", "body": ""}, ""))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_REPLY" {
		t.Fatalf("want INVALID_REPLY, got %s/%+v", r.Outcome, r.Error)
	}
}

// REPLY-IMAGE-001: 纯图片评论（空正文 + 媒体）放行，且列表读回媒体引用。
func TestReplyWithMediaOnlyAcceptedAndRoundTripped(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("ReplyToPost", map[string]any{
		"postId": "post_media", "body": "",
		"media": []any{map[string]any{"mediaAssetId": "ma_1", "sortOrder": 0}},
	}, "post_media"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("image-only reply: got %s/%+v", r.Outcome, r.Error)
	}
	listed := s.Handle(envelopeFor("ListPostReplies", map[string]any{"postId": "post_media", "limit": 20}, "post_media"))
	var list struct {
		Replies []Reply `json:"replies"`
		Count   int     `json:"count"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &list); err != nil {
		t.Fatal(err)
	}
	if list.Count != 1 || len(list.Replies) != 1 {
		t.Fatalf("listed replies: %+v", list)
	}
	got := list.Replies[0].Media
	if len(got) != 1 || got[0].MediaAssetID != "ma_1" || got[0].SortOrder != 0 {
		t.Fatalf("media not round-tripped: %+v", got)
	}
}

func TestReplyRejectsBadMedia(t *testing.T) {
	s := New()
	many := make([]any, 0, 7)
	for i := 0; i < 7; i++ {
		many = append(many, map[string]any{"mediaAssetId": "ma_x", "sortOrder": i})
	}
	for name, payload := range map[string]map[string]any{
		"too many":   {"postId": "post_1", "body": "x", "media": many},
		"empty id":   {"postId": "post_1", "body": "x", "media": []any{map[string]any{"mediaAssetId": "", "sortOrder": 0}}},
		"bad order":  {"postId": "post_1", "body": "x", "media": []any{map[string]any{"mediaAssetId": "ma_1", "sortOrder": -1}}},
		"empty both": {"postId": "post_1", "body": ""},
	} {
		r := s.Handle(envelopeFor("ReplyToPost", payload, ""))
		if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_REPLY" {
			t.Fatalf("%s: want INVALID_REPLY, got %s/%+v", name, r.Outcome, r.Error)
		}
	}
}

func TestPostReactionTruthToggleAndRemountHydration(t *testing.T) {
	s := New()
	first := s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_truth"}, "post_truth"))
	if first.Outcome != "ACCEPTED" || first.Aggregate.State != "REACTED" {
		t.Fatalf("first toggle: %#v", first)
	}
	read := s.Handle(envelopeFor("GetPostEngagement", map[string]any{"postId": "post_truth"}, "post_truth"))
	var body struct {
		Engagement PostEngagement `json:"engagement"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Engagement.Reactions != 1 || !body.Engagement.Reacted {
		t.Fatalf("hydrated truth: %+v", body.Engagement)
	}
	repeated := s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_truth", "active": true}, "post_truth"))
	if err := json.Unmarshal([]byte(repeated.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Engagement.Reactions != 1 || !body.Engagement.Reacted {
		t.Fatalf("repeated like must be idempotent: %+v", body.Engagement)
	}
	second := s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_truth", "active": false}, "post_truth"))
	if second.Outcome != "ACCEPTED" || second.Aggregate.State != "UNREACTED" {
		t.Fatalf("unlike: %#v", second)
	}
	if err := json.Unmarshal([]byte(second.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Engagement.Reactions != 0 || body.Engagement.Reacted {
		t.Fatalf("unlike truth: %+v", body.Engagement)
	}
	repeated = s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_truth", "active": false}, "post_truth"))
	if err := json.Unmarshal([]byte(repeated.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Engagement.Reactions != 0 || body.Engagement.Reacted {
		t.Fatalf("repeated unlike must be idempotent: %+v", body.Engagement)
	}
}

func TestPostCommentVisibilityRefreshesListAndCount(t *testing.T) {
	s := New()
	for _, text := range []string{"first", "second"} {
		if result := s.Handle(envelopeFor("ReplyToPost", map[string]any{"postId": "post_comments", "body": text}, "post_comments")); result.Outcome != "ACCEPTED" {
			t.Fatalf("reply: %#v", result)
		}
	}
	listed := s.Handle(envelopeFor("ListPostReplies", map[string]any{"postId": "post_comments", "limit": 20}, "post_comments"))
	var list struct {
		Replies []Reply `json:"replies"`
		Count   int     `json:"count"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &list); err != nil {
		t.Fatal(err)
	}
	if list.Count != 2 || len(list.Replies) != 2 || list.Replies[1].Body != "second" {
		t.Fatalf("listed replies: %+v", list)
	}
	read := s.Handle(envelopeFor("GetPostEngagement", map[string]any{"postId": "post_comments"}, "post_comments"))
	var body struct {
		Engagement PostEngagement `json:"engagement"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Engagement.Replies != 2 {
		t.Fatalf("reply count=%d", body.Engagement.Replies)
	}
}

// SEARCH-CORPUS-003：feed 搜索问「这些帖子里谁有命中的评论」。
//
// 这个判定归 engagement，因为评论只存在这里 —— localnet 的 Post 上一条都没有。
// 顺带钉住「字面子串」语义：传进来的 % 就是个百分号，不是通配符
// （PROFILE-SEARCH-001 在 profile 搜索上已经为同一个坑付过一次学费）。
func TestListPostIDsWithMatchingReplyIsLiteralSubstring(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	_ = repo.AddReply(ctx, Reply{ID: "r1", PostID: "post_a", ActorID: "u1", Body: "这家的河粉真的好吃"})
	_ = repo.AddReply(ctx, Reply{ID: "r2", PostID: "post_b", ActorID: "u2", Body: "西湖昨天夕阳很美"})
	_ = repo.AddReply(ctx, Reply{ID: "r3", PostID: "post_c", ActorID: "u3", Body: "折扣 50% off"})

	hits, err := repo.ListPostIDsWithMatchingReply(ctx, []string{"post_a", "post_b", "post_c"}, "河粉")
	if err != nil {
		t.Fatalf("reply search: %v", err)
	}
	if !hits["post_a"] || hits["post_b"] || hits["post_c"] {
		t.Fatalf("reply search '河粉': %+v", hits)
	}
	// 只问候选：不在 postIDs 里的帖子即使命中也不该出现（feed 只关心这一页）。
	scoped, err := repo.ListPostIDsWithMatchingReply(ctx, []string{"post_b"}, "河粉")
	if err != nil {
		t.Fatalf("scoped reply search: %v", err)
	}
	if len(scoped) != 0 {
		t.Fatalf("scoped reply search must stay within the candidates: %+v", scoped)
	}
	// 空查询 / 空候选：不命中任何东西，也不报错。
	empty, err := repo.ListPostIDsWithMatchingReply(ctx, []string{"post_a"}, "")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty query must return no hits: %+v %v", empty, err)
	}
	// "%" 是字面量：LIKE 语义下它会吃掉所有行。
	wildcard, err := repo.ListPostIDsWithMatchingReply(ctx, []string{"post_a", "post_c"}, "%")
	if err != nil {
		t.Fatalf("wildcard reply search: %v", err)
	}
	if !wildcard["post_c"] || wildcard["post_a"] {
		t.Fatalf("'%%' must be a literal, not a wildcard: %+v", wildcard)
	}
	// Service 层直通：localnet 调的就是这个（api.NewServer 把 Service 接给 localnet）。
	if got, err := NewWithRepository(repo).ListPostIDsWithMatchingReply(ctx, []string{"post_b"}, "夕阳"); err != nil || !got["post_b"] {
		t.Fatalf("service-level reply search: %+v %v", got, err)
	}
}

func TestFeedPreferenceAndReportAreDurableCommands(t *testing.T) {
	s := New()
	preference := s.Handle(envelopeFor("RecordFeedPreference", map[string]any{"postId": "post_1", "authorId": "author_1", "action": "REDUCE_AUTHOR"}, "post_1"))
	if preference.Outcome != "ACCEPTED" || preference.Aggregate.State != "RECORDED" {
		t.Fatalf("preference: %#v", preference)
	}
	report := s.Handle(envelopeFor("ReportPost", map[string]any{"postId": "post_1", "reason": "SPAM"}, "post_1"))
	if report.Outcome != "ACCEPTED" || report.Aggregate.State != "SUBMITTED" {
		t.Fatalf("report: %#v", report)
	}
}

func TestFeedPreferenceAndReportRejectUnknownValues(t *testing.T) {
	s := New()
	if result := s.Handle(envelopeFor("RecordFeedPreference", map[string]any{"postId": "post_1", "action": "DELETE"}, "post_1")); result.Outcome != "REJECTED" {
		t.Fatalf("unexpected preference result: %#v", result)
	}
	if result := s.Handle(envelopeFor("ReportPost", map[string]any{"postId": "post_1", "reason": "DISLIKE"}, "post_1")); result.Outcome != "REJECTED" {
		t.Fatalf("unexpected report result: %#v", result)
	}
}

// ---------- R15.45 MuteAuthor ----------

// TestMuteAuthor_HappyPath —— 正常 mute，state = MUTED
func TestMuteAuthor_HappyPath(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", result)
	}
	if result.Aggregate.State != "MUTED" {
		t.Errorf("expected state=MUTED, got %q", result.Aggregate.State)
	}
	if result.Aggregate == nil || result.Aggregate.ID == "" {
		t.Error("expected Aggregate.ID (mute id)")
	}
}

// TestMuteAuthor_Idempotent —— 重复 mute 同 author → ALREADY_MUTED，不发新事件
func TestMuteAuthor_Idempotent(t *testing.T) {
	s := New()
	r1 := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001"))
	if r1.Aggregate.State != "MUTED" {
		t.Fatalf("first mute should be MUTED, got %q", r1.Aggregate.State)
	}
	r2 := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001"))
	if r2.Aggregate.State != "ALREADY_MUTED" {
		t.Errorf("second mute should be ALREADY_MUTED, got %q", r2.Aggregate.State)
	}
	if r1.Aggregate.ID != r2.Aggregate.ID {
		t.Errorf("idempotent should return same id, got %s vs %s", r1.Aggregate.ID, r2.Aggregate.ID)
	}
}

// TestMuteAuthor_CannotMuteSelf —— actor == author 拒绝
// envelopeFor hardcodes actor.ID = "user_001", so authorId = "user_001" simulates self-mute.
func TestMuteAuthor_CannotMuteSelf(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "user_001"}, "user_001"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("self-mute should be REJECTED, got %#v", result)
	}
	if result.Error == nil || result.Error.ErrorCode != "CANNOT_MUTE_SELF" {
		t.Errorf("expected CANNOT_MUTE_SELF, got %#v", result.Error)
	}
}

// TestMuteAuthor_RequiresAuthorID —— 缺 authorId 拒绝
func TestMuteAuthor_RequiresAuthorID(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("MuteAuthor", map[string]any{}, "user_001"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("missing authorId should be REJECTED, got %#v", result)
	}
	if result.Error == nil || result.Error.ErrorCode != "INVALID_MUTE_AUTHOR" {
		t.Errorf("expected INVALID_MUTE_AUTHOR, got %#v", result.Error)
	}
}

// TestMuteAuthor_GuestNotAllowed —— 访客不能 mute
func TestMuteAuthor_GuestNotAllowed(t *testing.T) {
	s := New()
	// 用 PUBLIC actor (不是 USER) — 应被拒
	env := envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "public_reader")
	env.Actor.Type = "PUBLIC"
	result := s.Handle(env)
	if result.Outcome != "REJECTED" {
		t.Fatalf("guest mute should be REJECTED, got %#v", result)
	}
	if result.Error == nil || result.Error.ErrorCode != "MUTE_AUTHOR_NOT_ALLOWED" {
		t.Errorf("expected MUTE_AUTHOR_NOT_ALLOWED, got %#v", result.Error)
	}
}

// TestMuteAuthor_PerUserIsolation —— 同一 author 被不同 user mute 是独立记录
// (envelopeFor hardcodes actor.ID="user_001"; 模拟第二个用户需要新建 envelope)
func TestMuteAuthor_PerUserIsolation(t *testing.T) {
	s := New()
	r1 := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001"))
	if r1.Aggregate.State != "MUTED" {
		t.Fatalf("user_001 mute failed: %#v", r1)
	}
	// 第二个用户用独立 envelope (手动构造)
	env2 := envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001")
	env2.Actor = command.Actor{Type: "USER", ID: "user_002"}
	env2.Principal = command.Principal{Type: "INDIVIDUAL", ID: "user_002"}
	r2 := s.Handle(env2)
	if r2.Aggregate.State != "MUTED" {
		t.Errorf("user_002 mute should be fresh MUTED, got %q", r2.Aggregate.State)
	}
	if r1.Aggregate.ID == r2.Aggregate.ID {
		t.Error("per-user mutes should have different ids")
	}
}

// ---------- MUTE-REVERSIBLE-001 UnmuteAuthor / ListMutedAuthors ----------

// TestUnmuteAuthorMakesMuteReversible —— 本次修复的核心断言。
//
// 修复前 UnmuteAuthor 这条命令**根本不存在**：mute 之后被屏蔽者的帖子会被
// feed 永久过滤，你再也点不到 Ta 的帖子菜单/头像，于是没有任何入口能撤销。
// 这个测试钉住「mute → 解掉 → IsMuted 立刻回到 false」这条闭环。
func TestUnmuteAuthorMakesMuteReversible(t *testing.T) {
	s := New()
	if r := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001")); r.Aggregate.State != "MUTED" {
		t.Fatalf("setup mute failed: %#v", r)
	}
	if muted, err := s.repository.IsMuted(context.Background(), "user_001", "author_xyz"); err != nil || !muted {
		t.Fatalf("expected IsMuted=true after mute, got muted=%v err=%v", muted, err)
	}

	r := s.Handle(envelopeFor("UnmuteAuthor", map[string]any{"authorId": "author_xyz"}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("unmute should be ACCEPTED, got %#v", r)
	}
	if r.Aggregate == nil || r.Aggregate.State != "UNMUTED" {
		t.Errorf("expected state=UNMUTED, got %#v", r.Aggregate)
	}
	if muted, err := s.repository.IsMuted(context.Background(), "user_001", "author_xyz"); err != nil || muted {
		t.Fatalf("expected IsMuted=false after unmute, got muted=%v err=%v", muted, err)
	}
}

// TestUnmuteAuthorIdempotent —— 本来没屏蔽也 ACCEPTED/NOT_MUTED，且不发事件。
// 跟 MuteAuthor 的 ALREADY_MUTED 同一个道理：重复操作不是错误。
func TestUnmuteAuthorIdempotent(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("UnmuteAuthor", map[string]any{"authorId": "author_never_muted"}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("unmuting a never-muted author must be idempotent ACCEPTED, got %#v", r)
	}
	if r.Aggregate == nil || r.Aggregate.State != "NOT_MUTED" {
		t.Errorf("expected state=NOT_MUTED, got %#v", r.Aggregate)
	}
	if len(r.EventRefs) != 0 {
		t.Errorf("idempotent unmute must not emit AuthorUnmuted, got %v", r.EventRefs)
	}
}

// TestUnmuteAuthorRequiresAuthorID —— 缺 authorId 要拒绝，不能静默成功。
func TestUnmuteAuthorRequiresAuthorID(t *testing.T) {
	s := New()
	for _, payload := range []map[string]any{{}, {"authorId": ""}, {"authorId": "   "}} {
		r := s.Handle(envelopeFor("UnmuteAuthor", payload, "user_001"))
		if r.Outcome != "REJECTED" {
			t.Fatalf("payload %#v should be REJECTED, got %#v", payload, r)
		}
		if r.Error == nil || r.Error.ErrorCode != "INVALID_UNMUTE_PAYLOAD" {
			t.Errorf("payload %#v: expected INVALID_UNMUTE_PAYLOAD, got %#v", payload, r.Error)
		}
	}
}

// TestListMutedAuthorsIsScopedToActor —— 「我屏蔽的人」只能看到自己的，
// 且解掉一条之后列表要跟着少一条（否则界面会把已解除的人继续列着）。
func TestListMutedAuthorsIsScopedToActor(t *testing.T) {
	s := New()
	for _, author := range []string{"author_a", "author_b", "author_c"} {
		if r := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": author}, "user_001")); r.Outcome != "ACCEPTED" {
			t.Fatalf("mute %s failed: %#v", author, r)
		}
	}
	// 另一个用户也屏蔽了一个 —— 绝不能出现在 user_001 的列表里。
	if r := s.Handle(envelopeWithActor("MuteAuthor", "user_002", map[string]any{"authorId": "author_z"})); r.Outcome != "ACCEPTED" {
		t.Fatalf("user_002 mute failed: %#v", r)
	}

	read := func() MutedAuthorsList {
		t.Helper()
		return listMutedAuthorsFor(t, s, "user_001")
	}

	list := read()
	if list.Count != 3 || len(list.MutedAuthors) != 3 {
		t.Fatalf("expected 3 mutes for user_001, got count=%d len=%d", list.Count, len(list.MutedAuthors))
	}
	if list.ActorID != "user_001" {
		t.Errorf("list must be scoped to the caller, got actorId=%q", list.ActorID)
	}
	for _, mute := range list.MutedAuthors {
		if mute.AuthorID == "author_z" {
			t.Error("list leaked user_002's mute of author_z")
		}
		if mute.MuteID == "" {
			t.Errorf("every row needs a muteId so the client can key it: %+v", mute)
		}
	}

	if r := s.Handle(envelopeFor("UnmuteAuthor", map[string]any{"authorId": "author_b"}, "user_001")); r.Outcome != "ACCEPTED" {
		t.Fatalf("unmute author_b failed: %#v", r)
	}
	list = read()
	if list.Count != 2 {
		t.Errorf("expected 2 mutes after unmuting author_b, got %d", list.Count)
	}
	for _, mute := range list.MutedAuthors {
		if mute.AuthorID == "author_b" {
			t.Error("author_b is still listed after being unmuted")
		}
	}
}

// TestListMutedAuthorsOrdersNewestFirst —— 顺序必须与 PG 的
// ORDER BY created_at DESC, id DESC 一致，否则同一份断言在内存与 PG
// 两种 repo 下会给出不同顺序。这里直接喂确定的 CreatedAt，不依赖真实时钟。
func TestListMutedAuthorsOrdersNewestFirst(t *testing.T) {
	repo := NewMemoryRepository()
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	// 刻意乱序插入。
	for _, spec := range []struct {
		id     string
		author string
		offset time.Duration
	}{
		{"mute_oldest", "author_a", 0},
		{"mute_newest", "author_c", 2 * time.Hour},
		{"mute_middle", "author_b", time.Hour},
	} {
		if _, _, err := repo.AddMutedAuthor(context.Background(), MutedAuthor{
			ID: spec.id, ActorID: "user_001", AuthorID: spec.author, CreatedAt: base.Add(spec.offset),
		}); err != nil {
			t.Fatalf("seed %s: %v", spec.id, err)
		}
	}
	got, err := repo.ListMutedAuthors(context.Background(), "user_001")
	if err != nil {
		t.Fatalf("ListMutedAuthors: %v", err)
	}
	gotAuthors := make([]string, 0, len(got))
	for _, mute := range got {
		gotAuthors = append(gotAuthors, mute.AuthorID)
	}
	want := []string{"author_c", "author_b", "author_a"}
	if len(gotAuthors) != len(want) {
		t.Fatalf("expected %d mutes, got %v", len(want), gotAuthors)
	}
	for i := range want {
		if gotAuthors[i] != want[i] {
			t.Fatalf("newest-first order: want %v, got %v", want, gotAuthors)
		}
	}
}

// listMutedAuthorsFor 读「我屏蔽的人」并解开读模型，供上面几组断言共用。
func listMutedAuthorsFor(t *testing.T, s *Service, actorID string) MutedAuthorsList {
	t.Helper()
	r := s.Handle(envelopeWithActor("ListMutedAuthors", actorID, map[string]any{}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListMutedAuthors should be ACCEPTED, got %#v", r)
	}
	if r.OperationRef == "" {
		t.Fatal("ListMutedAuthors returned no operationRef")
	}
	var list MutedAuthorsList
	if err := json.Unmarshal([]byte(r.OperationRef), &list); err != nil {
		t.Fatalf("unmarshal MutedAuthorsList: %v", err)
	}
	return list
}

// TestListMutedAuthorsResolvesAuthorDisplayName —— 列表必须给出**可展示的名字**。
//
// 为什么这条是能力而不是装饰：屏蔽列表恰恰是「帖子全被 feed 过滤掉」的一群人，
// 客户端没法像 feed 那样从帖子读模型里借名字 —— 它手里只有一个 authorId。服务端
// 不回填名字，用户就只能对着一串账号 id 猜该解除谁，这个「解除屏蔽」入口等于没做。
// 名字必须来自 profile 解析器（跟评论同一个），解析不到留空串由客户端降级，
// 任何一条退化成回显 authorId 都是回归。
func TestListMutedAuthorsResolvesAuthorDisplayName(t *testing.T) {
	s := New()
	resolver := &stubReplyAuthorNames{names: map[string]string{"author_a": "NguyenThanhHuyen", "author_b": "Khoa"}}
	s.SetAuthorNameResolver(resolver)
	for _, author := range []string{"author_a", "author_b", "author_c"} {
		if r := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": author}, "user_001")); r.Outcome != "ACCEPTED" {
			t.Fatalf("mute %s failed: %#v", author, r)
		}
	}

	rows := listMutedAuthorsFor(t, s, "user_001").MutedAuthors
	names := make(map[string]string, len(rows))
	for _, row := range rows {
		names[row.AuthorID] = row.AuthorDisplayName
		if row.AuthorID == row.AuthorDisplayName {
			t.Errorf("display name must never be the raw author id: %+v", row)
		}
	}
	if names["author_a"] != "NguyenThanhHuyen" {
		t.Errorf("author_a name must come from the profile resolver, got %q", names["author_a"])
	}
	if names["author_b"] != "Khoa" {
		t.Errorf("author_b name must come from the profile resolver, got %q", names["author_b"])
	}
	if names["author_c"] != "" {
		t.Errorf("unresolved author must stay blank (client degrades to a neutral label), got %q", names["author_c"])
	}
	if len(resolver.looked) != len(rows) {
		t.Errorf("names must be resolved once per distinct author, looked=%v rows=%d", resolver.looked, len(rows))
	}
}

// TestListMutedAuthorsIgnoresPoisonedName —— 跟 withReplyActorNames 同一条规矩：
// 历史客户端把 "你" 硬编码进过 profile（FEED-OWN-001），当成名字回给所有人会让
// 被屏蔽者显示成"你"。脏值必须当作「解析不到」。
func TestListMutedAuthorsIgnoresPoisonedName(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{"author_a": "你", "author_b": "   "}})
	for _, author := range []string{"author_a", "author_b"} {
		if r := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": author}, "user_001")); r.Outcome != "ACCEPTED" {
			t.Fatalf("mute %s failed: %#v", author, r)
		}
	}
	for _, row := range listMutedAuthorsFor(t, s, "user_001").MutedAuthors {
		if row.AuthorDisplayName != "" {
			t.Errorf("poisoned/blank profile name must not be sent as a display name: %+v", row)
		}
	}
}

// TestListMutedAuthorsUnwiredResolverYieldsNoName —— 没接 resolver（或 profile
// 服务不可用）时不能崩，也不能回填 authorId 当名字，只是名字为空。
func TestListMutedAuthorsUnwiredResolverYieldsNoName(t *testing.T) {
	s := New()
	if r := s.Handle(envelopeFor("MuteAuthor", map[string]any{"authorId": "author_a"}, "user_001")); r.Outcome != "ACCEPTED" {
		t.Fatalf("mute failed: %#v", r)
	}
	rows := listMutedAuthorsFor(t, s, "user_001").MutedAuthors
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].AuthorDisplayName != "" {
		t.Errorf("unwired resolver must yield no name, got %q", rows[0].AuthorDisplayName)
	}
	if rows[0].AuthorID != "author_a" {
		t.Errorf("authorId must survive: %+v", rows[0])
	}
}

// ---------- R15.54 UnfollowProfile / GetFollowCounts / IsFollowing ----------

func envelopeWithActor(commandType, actorID string, payload map[string]any) command.Envelope {
	env := envelopeFor(commandType, payload, "x")
	env.Actor = command.Actor{Type: "USER", ID: actorID}
	env.Principal = command.Principal{Type: "INDIVIDUAL", ID: actorID}
	return env
}

func TestUnfollow_HappyPath(t *testing.T) {
	s := New()
	// 先 follow
	s.Handle(envelopeWithActor("FollowProfile", "user_001", map[string]any{"followeeId": "user_002"}))
	// 再 unfollow
	result := s.Handle(envelopeWithActor("UnfollowProfile", "user_001", map[string]any{"followeeId": "user_002"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", result.Outcome, result.Error)
	}
	if result.Aggregate.State != "UNFOLLOWED" {
		t.Errorf("expected UNFOLLOWED, got %s", result.Aggregate.State)
	}
}

func TestUnfollow_Idempotent(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("UnfollowProfile", "user_001", map[string]any{"followeeId": "user_999"}))
	if result.Outcome != "ACCEPTED" || result.Aggregate.State != "NOT_FOLLOWING" {
		t.Errorf("expected ACCEPTED + NOT_FOLLOWING (idempotent), got %s %s", result.Outcome, result.Aggregate.State)
	}
}

func TestUnfollow_CannotUnfollowSelf(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("UnfollowProfile", "user_001", map[string]any{"followeeId": "user_001"}))
	if result.Outcome != "REJECTED" {
		t.Errorf("expected REJECTED self, got %s", result.Outcome)
	}
}

// SELF-FOLLOW-001: unfollow 拒绝自己（上面那条），follow 却照收 —— 这个不对称让
// 自关注成为一条**永远删不掉**的行：follow 建了它，unfollow 又拒绝删除自己。
// 而 CountFollowers/CountFollowing 分别按 followee_id / follower_id 计数，
// 所以一次自关注会让自己「粉丝」和「关注」各 +1，且没有任何 API 能回滚。
func TestFollow_CannotFollowSelf(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("FollowProfile", "user_001", map[string]any{"followeeId": "user_001"}))
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for self-follow, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "CANNOT_FOLLOW_SELF" {
		t.Errorf("expected CANNOT_FOLLOW_SELF, got %+v", result.Error)
	}
}

// SELF-FOLLOW-001 的后果面：自关注被拒后，计数必须保持 0/0。
// 这条钉的是「不可回滚」——如果 follow 收了自关注，unfollow 又拒绝自己，
// 那么 +1 是永久的。
func TestFollow_SelfFollowLeavesCountsUntouched(t *testing.T) {
	s := New()
	s.Handle(envelopeWithActor("FollowProfile", "user_001", map[string]any{"followeeId": "user_001"}))
	result := s.Handle(envelopeWithActor("GetFollowCounts", "user_001", map[string]any{"userId": "user_001"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	var counts map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &counts); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if int(counts["followers"].(float64)) != 0 || int(counts["following"].(float64)) != 0 {
		t.Errorf("self-follow must not move counts, got followers=%v following=%v",
			counts["followers"], counts["following"])
	}
}

func TestGetFollowCounts(t *testing.T) {
	s := New()
	// user_002 follow user_001; user_003 follow user_001; user_001 follow user_004
	s.Handle(envelopeWithActor("FollowProfile", "user_002", map[string]any{"followeeId": "user_001"}))
	s.Handle(envelopeWithActor("FollowProfile", "user_003", map[string]any{"followeeId": "user_001"}))
	s.Handle(envelopeWithActor("FollowProfile", "user_001", map[string]any{"followeeId": "user_004"}))
	result := s.Handle(envelopeWithActor("GetFollowCounts", "user_001", map[string]any{"userId": "user_001"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	if result.OperationRef == "" {
		t.Fatal("expected OperationRef to contain counts")
	}
	var counts map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &counts); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if int(counts["followers"].(float64)) != 2 {
		t.Errorf("expected 2 followers, got %v", counts["followers"])
	}
	if int(counts["following"].(float64)) != 1 {
		t.Errorf("expected 1 following, got %v", counts["following"])
	}
}

func TestIsFollowing(t *testing.T) {
	s := New()
	// user_001 follow user_002
	s.Handle(envelopeWithActor("FollowProfile", "user_001", map[string]any{"followeeId": "user_002"}))

	// user_001 IS following user_002
	result := s.Handle(envelopeWithActor("IsFollowing", "user_001", map[string]any{"followerId": "user_001", "followeeId": "user_002"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	var state map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &state)
	if state["isFollowing"] != true {
		t.Errorf("expected isFollowing=true, got %v", state["isFollowing"])
	}

	// user_001 NOT following user_003
	result = s.Handle(envelopeWithActor("IsFollowing", "user_001", map[string]any{"followerId": "user_001", "followeeId": "user_003"}))
	_ = json.Unmarshal([]byte(result.OperationRef), &state)
	if state["isFollowing"] != false {
		t.Errorf("expected isFollowing=false, got %v", state["isFollowing"])
	}
}

func TestIsFollowing_AnonymousReturnsFalse(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("IsFollowing", "user_001", map[string]any{"followerId": "", "followeeId": "user_002"}))
	var state map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &state)
	if state["isFollowing"] != false {
		t.Errorf("expected isFollowing=false for anonymous, got %v", state["isFollowing"])
	}
}

// ---------- R15.56 PinPost / UnpinPost / ListPinnedPosts ----------

func TestPinPost_HappyPath(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_1"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	if result.Aggregate.State != "PINNED" {
		t.Errorf("expected PINNED, got %s", result.Aggregate.State)
	}
}

func TestPinPost_Idempotent(t *testing.T) {
	s := New()
	s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_1"}))
	result := s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_1"}))
	if result.Outcome != "ACCEPTED" || result.Aggregate.State != "ALREADY_PINNED" {
		t.Errorf("expected ALREADY_PINNED idempotent, got %s %s", result.Outcome, result.Aggregate.State)
	}
}

func TestPinPost_LimitExceeded(t *testing.T) {
	s := New()
	for i := 1; i <= 3; i++ {
		s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": fmt.Sprintf("post_%d", i)}))
	}
	result := s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_4"}))
	if result.Outcome != "REJECTED" {
		t.Errorf("expected REJECTED (limit), got %s", result.Outcome)
	}
}

func TestUnpinPost_HappyPath(t *testing.T) {
	s := New()
	s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_1"}))
	result := s.Handle(envelopeWithActor("UnpinPost", "user_001", map[string]any{"postId": "post_1"}))
	if result.Outcome != "ACCEPTED" || result.Aggregate.State != "UNPINNED" {
		t.Errorf("expected UNPINNED, got %s %s", result.Outcome, result.Aggregate.State)
	}
}

func TestUnpinPost_NotPinned(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("UnpinPost", "user_001", map[string]any{"postId": "post_999"}))
	if result.Outcome != "ACCEPTED" || result.Aggregate.State != "NOT_PINNED" {
		t.Errorf("expected NOT_PINNED idempotent, got %s %s", result.Outcome, result.Aggregate.State)
	}
}

func TestListPinnedPosts(t *testing.T) {
	s := New()
	s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_1"}))
	s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_2"}))
	s.Handle(envelopeWithActor("PinPost", "user_001", map[string]any{"postId": "post_3"}))
	result := s.Handle(envelopeWithActor("ListPinnedPosts", "user_001", map[string]any{"ownerId": "user_001"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	var out map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &out)
	if int(out["count"].(float64)) != 3 {
		t.Errorf("expected 3 pins, got %v", out["count"])
	}
	ids := out["postIds"].([]any)
	if ids[0] != "post_1" || ids[1] != "post_2" || ids[2] != "post_3" {
		t.Errorf("expected post order [post_1, post_2, post_3], got %v", ids)
	}
}

// ---------- R15.61 ListUserReplies ----------

func TestListUserReplies_Empty(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("ListUserReplies", "user_001", map[string]any{"userId": "user_001"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	var out map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &out)
	if int(out["count"].(float64)) != 0 {
		t.Errorf("expected 0 replies, got %v", out["count"])
	}
}

func TestListUserReplies_WithReplies(t *testing.T) {
	s := New()
	// 2 个 reply from user_001 + 1 from user_002
	s.Handle(envelopeWithActor("ReplyToPost", "user_001", map[string]any{"postId": "post_1", "body": "comment A"}))
	s.Handle(envelopeWithActor("ReplyToPost", "user_001", map[string]any{"postId": "post_2", "body": "comment B"}))
	s.Handle(envelopeWithActor("ReplyToPost", "user_002", map[string]any{"postId": "post_3", "body": "comment C"}))
	result := s.Handle(envelopeWithActor("ListUserReplies", "user_001", map[string]any{"userId": "user_001"}))
	var out map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &out)
	if int(out["count"].(float64)) != 2 {
		t.Errorf("expected 2 replies for user_001, got %v", out["count"])
	}
}

func TestListUserReplies_LimitClamp(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("ListUserReplies", "user_001", map[string]any{"userId": "user_001", "limit": 9999}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
}

// ---------- R15.62 ListUserBookmarks ----------

func TestListUserBookmarks_Empty(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("ListUserBookmarks", "user_001", map[string]any{"userId": "user_001"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	var out map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &out)
	if int(out["count"].(float64)) != 0 {
		t.Errorf("expected 0 bookmarks, got %v", out["count"])
	}
}

func TestListUserBookmarks_WithBookmarks(t *testing.T) {
	s := New()
	s.Handle(envelopeWithActor("BookmarkPost", "user_001", map[string]any{"postId": "post_1"}))
	s.Handle(envelopeWithActor("BookmarkPost", "user_001", map[string]any{"postId": "post_2"}))
	s.Handle(envelopeWithActor("BookmarkPost", "user_002", map[string]any{"postId": "post_3"}))
	result := s.Handle(envelopeWithActor("ListUserBookmarks", "user_001", map[string]any{"userId": "user_001"}))
	var out map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &out)
	if int(out["count"].(float64)) != 2 {
		t.Errorf("expected 2 bookmarks for user_001, got %v", out["count"])
	}
	ids := out["bookmarks"].([]any)
	if len(ids) != 2 {
		t.Errorf("expected 2 ids, got %d", len(ids))
	}
}

func TestListUserBookmarks_InvalidUserId(t *testing.T) {
	s := New()
	result := s.Handle(envelopeWithActor("ListUserBookmarks", "user_001", map[string]any{"userId": ""}))
	if result.Outcome != "REJECTED" {
		t.Errorf("expected REJECTED (empty userId), got %s", result.Outcome)
	}
}

// ---------- R16.12 约束违例 → 业务码（audit 2026-09-03 dup-like 500 修复）----------

// TestReactToPost_DuplicateLike 已删除：HEAD 基线（556dabc fix(feed): hydrate
// reactions and post replies）把 ReactToPost 改成 toggle 语义（SetReaction with
// active bool + ON CONFLICT DO UPDATE），重复点赞是幂等 toggle 而不是
// ALREADY_REACTED 错误 —— 该基线由 TestPostReactionTruthToggleAndRemountHydration
// 钉住。合并时保留 HEAD 语义，分支上这条断言旧基线的用例随之作废。
// 约束违例 → 业务码的保证仍然保留：FK(23503) 走 POST_NOT_FOUND（见下方用例 +
// platform/postgres SetReaction 的 insertEngagementRow 翻译）。

// TestReactToPost_PostNotFound —— 对不存在的帖文点赞必须返 POST_NOT_FOUND,
// 不允许 FK 违例 (23503) 泄成 500。
func TestReactToPost_PostNotFound(t *testing.T) {
	// Memory 仓不做 FK 检查 (无 posts 表); PG 路径由集成测试覆盖。
	// 这里测 service 层对哨兵错误的映射: 注入 ErrPostNotFound 的仓。
	s := NewWithRepository(&postNotFoundRepo{inner: NewMemoryRepository()})
	result := s.Handle(envelopeFor("ReactToPost", map[string]any{"postId": "post_ghost", "kind": "LIKE"}, ""))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "POST_NOT_FOUND" {
		t.Fatalf("ghost post like: want REJECTED/POST_NOT_FOUND, got %s err=%+v", result.Outcome, result.Error)
	}
}

// TestRepostPost_DuplicateAndGhost —— repost 的 23505/23503 同样映射成业务码。
func TestRepostPost_DuplicateAndGhost(t *testing.T) {
	s := New()
	first := s.Handle(envelopeFor("RepostPost", map[string]any{"postId": "post_dup"}, ""))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first repost should be accepted, got %s", first.Outcome)
	}
	second := s.Handle(envelopeFor("RepostPost", map[string]any{"postId": "post_dup"}, ""))
	if second.Outcome != "REJECTED" || second.Error == nil || second.Error.ErrorCode != "ALREADY_REPOSTED" {
		t.Fatalf("dup repost: want REJECTED/ALREADY_REPOSTED, got %s err=%+v", second.Outcome, second.Error)
	}
	s2 := NewWithRepository(&postNotFoundRepo{inner: NewMemoryRepository()})
	ghost := s2.Handle(envelopeFor("RepostPost", map[string]any{"postId": "post_ghost"}, ""))
	if ghost.Outcome != "REJECTED" || ghost.Error == nil || ghost.Error.ErrorCode != "POST_NOT_FOUND" {
		t.Fatalf("ghost repost: want REJECTED/POST_NOT_FOUND, got %s err=%+v", ghost.Outcome, ghost.Error)
	}
}

// TestBookmarkPost_DuplicateAndGhost —— bookmark 的 23505/23503 同样映射成业务码。
func TestBookmarkPost_DuplicateAndGhost(t *testing.T) {
	s := New()
	first := s.Handle(envelopeFor("BookmarkPost", map[string]any{"postId": "post_dup"}, ""))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first bookmark should be accepted, got %s", first.Outcome)
	}
	second := s.Handle(envelopeFor("BookmarkPost", map[string]any{"postId": "post_dup"}, ""))
	if second.Outcome != "REJECTED" || second.Error == nil || second.Error.ErrorCode != "ALREADY_BOOKMARKED" {
		t.Fatalf("dup bookmark: want REJECTED/ALREADY_BOOKMARKED, got %s err=%+v", second.Outcome, second.Error)
	}
	s2 := NewWithRepository(&postNotFoundRepo{inner: NewMemoryRepository()})
	ghost := s2.Handle(envelopeFor("BookmarkPost", map[string]any{"postId": "post_ghost"}, ""))
	if ghost.Outcome != "REJECTED" || ghost.Error == nil || ghost.Error.ErrorCode != "POST_NOT_FOUND" {
		t.Fatalf("ghost bookmark: want REJECTED/POST_NOT_FOUND, got %s err=%+v", ghost.Outcome, ghost.Error)
	}
}

// postNotFoundRepo — 把所有 Add* 写路径变成 ErrPostNotFound, 模拟 PG FK 违例翻译后的行为。
type postNotFoundRepo struct {
	inner *MemoryRepository
}

func (p *postNotFoundRepo) AddFollow(ctx context.Context, f Follow) error {
	return p.inner.AddFollow(ctx, f)
}
func (p *postNotFoundRepo) RemoveFollow(ctx context.Context, followerID, followeeID string) (bool, error) {
	return p.inner.RemoveFollow(ctx, followerID, followeeID)
}
func (p *postNotFoundRepo) CountFollowers(ctx context.Context, userID string) (int, error) {
	return p.inner.CountFollowers(ctx, userID)
}
func (p *postNotFoundRepo) CountFollowing(ctx context.Context, userID string) (int, error) {
	return p.inner.CountFollowing(ctx, userID)
}
func (p *postNotFoundRepo) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	return p.inner.IsFollowing(ctx, followerID, followeeID)
}
func (p *postNotFoundRepo) SetReaction(ctx context.Context, r Reaction, active bool) (bool, error) {
	return false, ErrPostNotFound
}
func (p *postNotFoundRepo) ListRepliesByPost(ctx context.Context, postID string, limit int) ([]Reply, error) {
	return p.inner.ListRepliesByPost(ctx, postID, limit)
}
func (p *postNotFoundRepo) ListPostIDsWithMatchingReply(ctx context.Context, postIDs []string, loweredQuery string) (map[string]bool, error) {
	return p.inner.ListPostIDsWithMatchingReply(ctx, postIDs, loweredQuery)
}
func (p *postNotFoundRepo) AddReply(ctx context.Context, r Reply) error       { return ErrPostNotFound }
func (p *postNotFoundRepo) AddRepost(ctx context.Context, r Repost) error     { return ErrPostNotFound }
func (p *postNotFoundRepo) AddBookmark(ctx context.Context, b Bookmark) error { return ErrPostNotFound }
func (p *postNotFoundRepo) ListRepliesByActor(ctx context.Context, actorID string, limit int) ([]Reply, error) {
	return p.inner.ListRepliesByActor(ctx, actorID, limit)
}
func (p *postNotFoundRepo) ListBookmarksByActor(ctx context.Context, actorID string, limit int) ([]Bookmark, error) {
	return p.inner.ListBookmarksByActor(ctx, actorID, limit)
}
func (p *postNotFoundRepo) AddPostPin(ctx context.Context, pin PostPin) (PostPin, bool, error) {
	return p.inner.AddPostPin(ctx, pin)
}
func (p *postNotFoundRepo) RemovePostPin(ctx context.Context, ownerID, postID string) (bool, error) {
	return p.inner.RemovePostPin(ctx, ownerID, postID)
}
func (p *postNotFoundRepo) ListPinnedPosts(ctx context.Context, ownerID string) ([]string, error) {
	return p.inner.ListPinnedPosts(ctx, ownerID)
}
func (p *postNotFoundRepo) AddFeedPreference(ctx context.Context, preference FeedPreference) error {
	return p.inner.AddFeedPreference(ctx, preference)
}
func (p *postNotFoundRepo) AddPostReport(ctx context.Context, report PostReport) error {
	return p.inner.AddPostReport(ctx, report)
}
func (p *postNotFoundRepo) AddMutedAuthor(ctx context.Context, mute MutedAuthor) (MutedAuthor, bool, error) {
	return p.inner.AddMutedAuthor(ctx, mute)
}
func (p *postNotFoundRepo) IsMuted(ctx context.Context, actorID, authorID string) (bool, error) {
	return p.inner.IsMuted(ctx, actorID, authorID)
}

// MUTE-REVERSIBLE-001: 新增的解除屏蔽/列出被屏蔽者也要透传，
// 否则这个 wrapper 不再满足 Repository 接口。
func (p *postNotFoundRepo) RemoveMutedAuthor(ctx context.Context, actorID, authorID string) (bool, error) {
	return p.inner.RemoveMutedAuthor(ctx, actorID, authorID)
}

func (p *postNotFoundRepo) ListMutedAuthors(ctx context.Context, actorID string) ([]MutedAuthor, error) {
	return p.inner.ListMutedAuthors(ctx, actorID)
}
func (p *postNotFoundRepo) Engagement(ctx context.Context, postID string, viewerID ...string) (PostEngagement, error) {
	return p.inner.Engagement(ctx, postID, viewerID...)
}

func (p *postNotFoundRepo) CountReceivedEngagement(ctx context.Context, ownerID string, since time.Time) (ReceivedEngagementStats, error) {
	return p.inner.CountReceivedEngagement(ctx, ownerID, since)
}

// TestReceivedEngagementStatsCountsOthersActionsInWindow (ANALYTICS-ME-001):
// 「我的 → 分析」互动行 = 30 天窗口内别人给我的赞 + 评论。自赞/自评不算
// "被互动"；窗口外的不算；归属解析不到的帖子不猜；只能查自己的。
func TestReceivedEngagementStatsCountsOthersActionsInWindow(t *testing.T) {
	repo := NewMemoryRepository()
	repo.SetPostAuthorSource(func(postID string) (string, bool) {
		if postID == "post_mine" {
			return "user_001", true
		}
		if postID == "post_other" {
			return "user_9", true
		}
		return "", false
	})
	now := time.Now().UTC()
	old := now.AddDate(0, 0, -31)
	repo.reactions["rxn_in"] = Reaction{ID: "rxn_in", PostID: "post_mine", ActorID: "user_2", Kind: "LIKE", CreatedAt: now.Add(-time.Hour)}
	repo.reactions["rxn_self"] = Reaction{ID: "rxn_self", PostID: "post_mine", ActorID: "user_001", Kind: "LIKE", CreatedAt: now.Add(-time.Hour)}
	repo.reactions["rxn_old"] = Reaction{ID: "rxn_old", PostID: "post_mine", ActorID: "user_3", Kind: "LIKE", CreatedAt: old}
	repo.reactions["rxn_other_post"] = Reaction{ID: "rxn_other_post", PostID: "post_other", ActorID: "user_2", Kind: "LIKE", CreatedAt: now.Add(-time.Hour)}
	repo.reactions["rxn_unknown_post"] = Reaction{ID: "rxn_unknown_post", PostID: "post_ghost", ActorID: "user_2", Kind: "LIKE", CreatedAt: now.Add(-time.Hour)}
	repo.replies["rep_in"] = Reply{ID: "rep_in", PostID: "post_mine", ActorID: "user_4", Body: "好", CreatedAt: now.Add(-time.Hour)}
	repo.replies["rep_self"] = Reply{ID: "rep_self", PostID: "post_mine", ActorID: "user_001", Body: "自言自语", CreatedAt: now.Add(-time.Hour)}
	repo.replies["rep_old"] = Reply{ID: "rep_old", PostID: "post_mine", ActorID: "user_5", Body: "老评论", CreatedAt: old}

	svc := NewWithRepository(repo)
	res := svc.Handle(envelopeFor("GetReceivedEngagementStats", map[string]any{}, ""))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("stats: got %s (%+v)", res.Outcome, res.Error)
	}
	var body struct {
		Stats ReceivedEngagementStats `json:"stats"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &body); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if body.Stats.Reactions != 1 || body.Stats.Replies != 1 {
		t.Fatalf("stats = %+v, want {reactions:1 replies:1}", body.Stats)
	}

	// 别人的聚合不暴露。
	other := envelopeFor("GetReceivedEngagementStats", map[string]any{"ownerId": "user_other"}, "")
	if res := svc.Handle(other); res.Outcome != "REJECTED" {
		t.Fatalf("other owner stats: got %s, want REJECTED", res.Outcome)
	}
}
