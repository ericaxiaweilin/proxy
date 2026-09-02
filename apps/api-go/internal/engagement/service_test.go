package engagement

import (
	"encoding/json"
	"fmt"
	"testing"

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
