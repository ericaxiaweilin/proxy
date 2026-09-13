package engagement

import (
	"context"
	"encoding/json"
	"testing"
)

// FEED-REPLY-001 — 评论必须显示作者名，而不是把 actorId 当成名字显示给用户。
//
// 这组测试钉住的是「服务端必须下发可展示的评论作者名」这条能力。名字来自
// profile（权威），不落库、不接受客户端提供；解析不到时保持空串，由客户端
// 降级成中性标签——任何一条退化成回显 actorId 都是回归。

type stubReplyAuthorNames struct {
	names  map[string]string
	looked []string
}

func (s *stubReplyAuthorNames) ResolveAuthorDisplayName(_ context.Context, userAccountID string) (string, bool) {
	s.looked = append(s.looked, userAccountID)
	name, ok := s.names[userAccountID]
	return name, ok
}

func listReplies(t *testing.T, s *Service, postID string) []Reply {
	t.Helper()
	result := s.Handle(envelopeFor("ListPostReplies", map[string]any{"postId": postID, "limit": 20}, postID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ListPostReplies: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	var body struct {
		Replies []Reply `json:"replies"`
		Count   int     `json:"count"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &body); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	if body.Count != len(body.Replies) || body.Count == 0 {
		t.Fatalf("reply list must be non-empty and consistent, got count=%d len=%d", body.Count, len(body.Replies))
	}
	return body.Replies
}

func addReply(t *testing.T, s *Service, actorID, postID, body string) {
	t.Helper()
	result := s.Handle(envelopeWithActor("ReplyToPost", actorID, map[string]any{"postId": postID, "body": body}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ReplyToPost(%s): outcome=%s err=%+v", actorID, result.Outcome, result.Error)
	}
}

// 评论作者名必须来自 profile，而不是客户端或 actorId。
func TestListPostRepliesResolvesActorDisplayNameFromProfile(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{
		"user_001": "NguyenThanhHuyen",
		"user_002": "Khoa",
	}})
	addReply(t, s, "user_001", "post_names", "第一条")
	addReply(t, s, "user_002", "post_names", "第二条")

	replies := listReplies(t, s, "post_names")
	if replies[0].ActorDisplayName != "NguyenThanhHuyen" {
		t.Fatalf("first reply name must come from profile, got %q", replies[0].ActorDisplayName)
	}
	if replies[1].ActorDisplayName != "Khoa" {
		t.Fatalf("second reply name must come from profile, got %q", replies[1].ActorDisplayName)
	}
	for _, reply := range replies {
		if reply.ActorDisplayName == reply.ActorID {
			t.Fatalf("display name must never echo the account id: %+v", reply)
		}
	}
}

// 解析不到时保持空串：客户端据此显示中性标签。绝不能把 actorId 塞进名字字段。
func TestListPostRepliesLeavesUnresolvedActorNameBlank(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{}})
	addReply(t, s, "user_404", "post_unnamed", "没有 profile 的人")

	replies := listReplies(t, s, "post_unnamed")
	if replies[0].ActorDisplayName != "" {
		t.Fatalf("unresolved actor must stay blank, got %q", replies[0].ActorDisplayName)
	}
	if replies[0].ActorID != "user_404" {
		t.Fatalf("authoritative actor id must still be returned, got %q", replies[0].ActorID)
	}
}

// 存量评论（写在这个字段存在之前）也必须拿到名字——解析在读时做，不依赖迁移。
func TestListPostRepliesNamesLegacyRepliesWrittenBeforeWiring(t *testing.T) {
	s := New()
	addReply(t, s, "user_001", "post_legacy", "老评论")
	// 接线发生在评论已经写完之后。
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{"user_001": "Huyen"}})

	replies := listReplies(t, s, "post_legacy")
	if replies[0].ActorDisplayName != "Huyen" {
		t.Fatalf("legacy reply must be named on read, got %q", replies[0].ActorDisplayName)
	}
}

// "你" 是历史客户端硬编码写进 profile 的脏值（FEED-OWN-001）。当成名字回给
// 所有人，会让别人的评论显示成"你"。
func TestListPostRepliesRejectsPoisonedYouDisplayName(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{"user_001": "你"}})
	addReply(t, s, "user_001", "post_poisoned", "hi")

	replies := listReplies(t, s, "post_poisoned")
	if replies[0].ActorDisplayName != "" {
		t.Fatalf("poisoned '你' must not be returned as a name, got %q", replies[0].ActorDisplayName)
	}
}

// 同一个作者的多条评论只查一次 profile，避免评论流放大成 N 次查询。
func TestListPostRepliesDeduplicatesActorNameLookups(t *testing.T) {
	s := New()
	resolver := &stubReplyAuthorNames{names: map[string]string{"user_001": "Huyen"}}
	s.SetAuthorNameResolver(resolver)
	addReply(t, s, "user_001", "post_dup", "a")
	addReply(t, s, "user_001", "post_dup", "b")
	addReply(t, s, "user_001", "post_dup", "c")

	replies := listReplies(t, s, "post_dup")
	if len(replies) != 3 {
		t.Fatalf("expected 3 replies, got %d", len(replies))
	}
	if len(resolver.looked) != 1 {
		t.Fatalf("one distinct author must mean one lookup, got %d (%v)", len(resolver.looked), resolver.looked)
	}
	for _, reply := range replies {
		if reply.ActorDisplayName != "Huyen" {
			t.Fatalf("every reply by the author must be named, got %+v", reply)
		}
	}
}

// 未接线的实例（老的构造路径）不能崩，也不得冒充名字。
func TestListPostRepliesWithoutWiredResolverStaysUnnamed(t *testing.T) {
	s := New()
	addReply(t, s, "user_001", "post_unwired", "hi")

	replies := listReplies(t, s, "post_unwired")
	if replies[0].ActorDisplayName != "" {
		t.Fatalf("unwired resolver must yield no name, got %q", replies[0].ActorDisplayName)
	}
}

// 名字只可能来自 profile：客户端在 ReplyToPost 里塞什么都不作数。
func TestReplyActorDisplayNameIsNeverClientSupplied(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(&stubReplyAuthorNames{names: map[string]string{"user_001": "Huyen"}})
	result := s.Handle(envelopeWithActor("ReplyToPost", "user_001", map[string]any{
		"postId":           "post_spoof",
		"body":             "试试冒充",
		"actorDisplayName": "冒充者",
	}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ReplyToPost: outcome=%s err=%+v", result.Outcome, result.Error)
	}

	replies := listReplies(t, s, "post_spoof")
	if replies[0].ActorDisplayName != "Huyen" {
		t.Fatalf("client-supplied name must be ignored, got %q", replies[0].ActorDisplayName)
	}
}
