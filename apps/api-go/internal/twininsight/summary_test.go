package twininsight

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// summary:refresh 的诚实性测试。
//
// 核心：模型底座不可用时**必须 fail-closed 报错**，绝不退化成"本地拼一句
// 话然后告诉用户已重新总结"。那等于把规则输出冒充模型输出 —— 跟原来那份
// 虚构好友的 demo 是同一类问题。modelstack/port.go 的 ErrUnconfigured
// 就是为这条原则设的。

// unavailableStack 模拟一个"没配置"的模型底座（生产里是 modelstack.Unconfigured）。
type unavailableStack struct{}

func (unavailableStack) Available() bool { return false }
func (unavailableStack) Complete(context.Context, string, []modelstack.ChatMessage) (modelstack.Completion, error) {
	return modelstack.Completion{}, modelstack.ErrUnconfigured
}

// htmlStack 模拟一个"不听话"的模型：返回带 HTML 的输出。
// 契约写明 wire 上是纯文本，出口必须剥掉标签。
type htmlStack struct{}

func (htmlStack) Available() bool { return true }
func (htmlStack) Complete(context.Context, string, []modelstack.ChatMessage) (modelstack.Completion, error) {
	return modelstack.Completion{Content: "他<strong>访问了 7 次</strong>，互动不错。"}, nil
}

func newSummaryFixture() *Service {
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "friend_1", DisplayName: "Linh", Since: time.Now().Add(-30 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	return svc
}

func TestRefreshSummaryFailsClosedWhenModelStackUnconfigured(t *testing.T) {
	svc := newSummaryFixture()
	svc.SetSummaryGenerator(NewModelStackSummarizer(unavailableStack{}))
	_, err := svc.RefreshSummary(context.Background(), "twin_1", "owner_1", "friend_1")
	if !errors.Is(err, ErrSummaryUnavailable) {
		t.Fatalf("want ErrSummaryUnavailable, got %v", err)
	}
}

func TestRefreshSummaryFailsClosedWhenNoGeneratorWired(t *testing.T) {
	svc := newSummaryFixture()
	// 连 SetSummaryGenerator 都没调。
	if _, err := svc.RefreshSummary(context.Background(), "twin_1", "owner_1", "friend_1"); !errors.Is(err, ErrSummaryUnavailable) {
		t.Fatalf("want ErrSummaryUnavailable, got %v", err)
	}
}

func TestRefreshSummaryStripsHTMLFromModelOutput(t *testing.T) {
	svc := newSummaryFixture()
	svc.SetSummaryGenerator(NewModelStackSummarizer(htmlStack{}))
	insight, err := svc.RefreshSummary(context.Background(), "twin_1", "owner_1", "friend_1")
	if err != nil {
		t.Fatalf("RefreshSummary: %v", err)
	}
	if strings.Contains(insight.SummaryText, "<") || strings.Contains(insight.SummaryText, ">") {
		t.Errorf("model output must be stripped to plain text on the way out, got %q", insight.SummaryText)
	}
	if strings.TrimSpace(insight.SummaryText) == "" {
		t.Error("summaryText must not be empty (contract min 1)")
	}
}

func TestStripHTML(t *testing.T) {
	cases := map[string]string{
		"他<strong>访问了 7 次</strong>":  "他访问了 7 次",
		"plain text":                "plain text",
		"<script>alert(1)</script>hi": "alert(1)hi",
		// 裸的 '<' 不是标签 —— 绝不能连后面所有字一起吃掉。
		"a < b":                    "a < b",
		"未闭合 < 之后还有字":              "未闭合 < 之后还有字",
		"":                         "",
	}
	for input, want := range cases {
		if got := stripHTML(input); got != want {
			t.Errorf("stripHTML(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRefreshSummaryRejectsNonFriend(t *testing.T) {
	svc := newSummaryFixture()
	svc.SetSummaryGenerator(NewModelStackSummarizer(htmlStack{}))
	if _, err := svc.RefreshSummary(context.Background(), "twin_1", "owner_1", "stranger_9"); !errors.Is(err, ErrTargetNotAFriend) {
		t.Fatalf("want ErrTargetNotAFriend, got %v", err)
	}
}
