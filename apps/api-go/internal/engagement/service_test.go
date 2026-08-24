package engagement

import (
	"encoding/json"
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
