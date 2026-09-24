package conversation

import (
	"context"
	"testing"
	"time"
)

// AI-MANAGE-014：全自动代回复按本人「节奏」延迟发出；请求本身立刻返回 SCHEDULED。

type recordedJob struct {
	delay time.Duration
	run   func()
}

func rhythmService(t *testing.T, states map[string]AiEngineChatState) (*Service, *MemoryRepository, *recordingModelStack, *[]recordedJob) {
	t.Helper()
	model := &recordingModelStack{}
	repo := NewMemoryRepository()
	s := NewWithModelStack(repo, model)
	var asked []string
	s.SetAiEngineChatStateReader(stateByUser(states, &asked))
	jobs := &[]recordedJob{}
	s.SetStandInScheduler(func(delay time.Duration, run func()) { *jobs = append(*jobs, recordedJob{delay, run}) })
	return s, repo, model, jobs
}

func standInReplies(t *testing.T, repo *MemoryRepository, convID string) []Message {
	t.Helper()
	messages, _ := repo.Messages(context.Background(), convID)
	var out []Message
	for _, m := range messages {
		// 只数替 owner（user_002）发的；user_001 没配置时自己也会有秒回的代回复，不算。
		if m.AuthoredBy == "ai_stand_in" && m.SenderID == "user_002" {
			out = append(out, m)
		}
	}
	return out
}

func TestStandInWaitsForTheOwnersRhythmThenRepliesAsTheOwner(t *testing.T) {
	s, repo, model, jobs := rhythmService(t, map[string]AiEngineChatState{"user_002": {ChatPermission: "auto", Rhythm: "human_3_5"}})
	opened := dmHuman(t, s)
	if opened.AssistantStatus != "SCHEDULED" || opened.AIMessage != nil || model.calls != 0 {
		t.Fatalf("a delayed stand-in must not answer inside the sender's request: status=%q calls=%d", opened.AssistantStatus, model.calls)
	}
	if len(*jobs) != 1 || (*jobs)[0].delay < 3*time.Second || (*jobs)[0].delay > 5*time.Second {
		t.Fatalf("human_3_5 must wait 3-5s, got %+v", *jobs)
	}
	(*jobs)[0].run()
	replies := standInReplies(t, repo, opened.ConversationID)
	if len(replies) != 1 || replies[0].SenderID != "user_002" {
		t.Fatalf("when the wait is over the owner's AI replies as the owner: %+v", replies)
	}
}

func TestStandInAnswersOnlyTheLatestMessageAfterABurst(t *testing.T) {
	s, repo, _, jobs := rhythmService(t, map[string]AiEngineChatState{"user_002": {ChatPermission: "auto", Rhythm: "human_10_30"}})
	opened := dmHuman(t, s)
	sendIn(t, s, opened.ConversationID, "在吗")
	sendIn(t, s, opened.ConversationID, "周六有空吗")
	for _, job := range *jobs {
		job.run()
	}
	if got := len(standInReplies(t, repo, opened.ConversationID)); got != 1 {
		t.Fatalf("three quick messages get one reply (to the latest), got %d", got)
	}
}

func TestStandInStaysSilentWhenTheOwnerAnsweredOrTurnedItOffWhileWaiting(t *testing.T) {
	// 本人自己先回了。
	s, repo, _, jobs := rhythmService(t, map[string]AiEngineChatState{"user_002": {ChatPermission: "auto", Rhythm: "human_3_5"}})
	opened := dmHuman(t, s)
	own := s.Handle(envelopeAs("SendMessage", map[string]any{"messageType": "TEXT", "body": "我在，马上回你"}, opened.ConversationID, "user_002"))
	if own.Outcome != "ACCEPTED" {
		t.Fatalf("owner reply: %+v", own.Error)
	}
	(*jobs)[0].run()
	if got := len(standInReplies(t, repo, opened.ConversationID)); got != 0 {
		t.Fatalf("the owner already answered, the stand-in must stay silent, got %d", got)
	}

	// 等待期间本人把对话权限关了。
	states := map[string]AiEngineChatState{"user_002": {ChatPermission: "auto", Rhythm: "human_3_5"}}
	s2, repo2, model2, jobs2 := rhythmService(t, states)
	opened2 := dmHuman(t, s2)
	states["user_002"] = AiEngineChatState{ChatPermission: "off", Rhythm: "human_3_5"}
	(*jobs2)[0].run()
	if got := len(standInReplies(t, repo2, opened2.ConversationID)); got != 0 || model2.calls != 0 {
		t.Fatalf("turned off while waiting: no reply and no model call, got %d replies, %d calls", got, model2.calls)
	}
}

func TestStandInDelayMatchesTheRhythmChoices(t *testing.T) {
	low := func(int64) int64 { return 0 }
	high := func(n int64) int64 { return n - 1 }
	for _, tc := range []struct {
		rhythm   string
		min, max time.Duration
	}{
		{"instant", 0, 0},
		{"", 0, 0},
		{"human_3_5", 3 * time.Second, 5 * time.Second},
		{"human_10_30", 10 * time.Second, 30 * time.Second},
	} {
		if d := standInDelay(tc.rhythm, low); d != tc.min {
			t.Fatalf("%q low: %s", tc.rhythm, d)
		}
		if d := standInDelay(tc.rhythm, high); d != tc.max {
			t.Fatalf("%q high: %s", tc.rhythm, d)
		}
	}
	if d := standInDelay("random", func(n int64) int64 { return 1 }); d <= 0 || d > 2*time.Minute {
		t.Fatalf("random must be a real, bounded wait: %s", d)
	}
}
