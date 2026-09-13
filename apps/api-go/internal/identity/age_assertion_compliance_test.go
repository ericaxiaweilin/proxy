package identity

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-AGE-001 — 注册时的 18+ 判定必须留下证据。
//
// 此前 CreateAnonymousSession 在服务端判了 18+（dob.AddDate(18,0,0)），
// 判完就把 dateOfBirth 丢了：identity.user_accounts 里没有任何年龄字段。
// 于是「这个用户满 18 岁」这件事只在注册那一瞬间成立，之后无法复查、
// 无法举证，而 AI 法 134/2025（2026-03-01 生效）要求的未成年人保护
// 也因为没有年龄信号而无从做起。
//
// 这一组测试钉死：判定通过的出生日期会被写下去，且写的是判定用的那个值。

// ageAssertionRecorder 是「支持年龄断言写入」的仓库。走的是
// RecordAgeAssertionDetached 里的可选接口断言，所以它只要额外实现这一个方法。
type ageAssertionRecorder struct {
	*MemoryRepository
	calls []ageAssertionCall
}

type ageAssertionCall struct {
	UserID      string
	DateOfBirth string
	Source      string
}

func (r *ageAssertionRecorder) RecordAgeAssertion(_ context.Context, userID, dateOfBirth, source, _, _ string) error {
	r.calls = append(r.calls, ageAssertionCall{UserID: userID, DateOfBirth: dateOfBirth, Source: source})
	return nil
}

func newAgeService(t *testing.T) (*Service, *ageAssertionRecorder) {
	t.Helper()
	repo := &ageAssertionRecorder{MemoryRepository: NewMemoryRepository(nil)}
	svc := NewWithRepositoryAndClock(repo, clock.NewFixed(time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)))
	return svc, repo
}

func ageEnvelope(dob string, consents map[string]any) command.Envelope {
	if consents == nil {
		consents = map[string]any{"terms": true, "privacy": true}
	}
	return testEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": "device_age", "platform": "IOS", "dateOfBirth": dob,
		"consents": consents, "legalDocVersion": "1.1",
	}, command.Target{Type: "Session", ID: "new"})
}

func TestAnonymousSessionPersistsTheAgeItJustVerified(t *testing.T) {
	svc, repo := newAgeService(t)
	r := svc.Handle(ageEnvelope("1990-01-01", nil))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("signup: %s (%+v)", r.Outcome, r.Error)
	}
	if len(repo.calls) != 1 {
		t.Fatalf("the date of birth that just passed the 18+ gate must be recorded, got %d writes", len(repo.calls))
	}
	if repo.calls[0].DateOfBirth != "1990-01-01" {
		t.Fatalf("recorded the wrong date of birth: %q", repo.calls[0].DateOfBirth)
	}
	if repo.calls[0].Source != "SELF_DECLARED_AT_SIGNUP" {
		t.Fatalf("the source must say where the assertion came from, got %q", repo.calls[0].Source)
	}
	if repo.calls[0].UserID == "" {
		t.Fatal("the assertion must be bound to the account it was verified for")
	}
}

// 判定与留痕必须成对：没通过 18+ 的，一个字都不该写。
func TestAgeAssertionIsNotWrittenWhenTheAgeGateRejects(t *testing.T) {
	svc, repo := newAgeService(t)
	r := svc.Handle(ageEnvelope("2015-01-01", nil))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "AGE_RESTRICTED" {
		t.Fatalf("expected AGE_RESTRICTED, got %s/%+v", r.Outcome, r.Error)
	}
	if len(repo.calls) != 0 {
		t.Fatalf("an account that failed the age gate must not leave an age assertion, got %+v", repo.calls)
	}
}

// 出生日期缺失时同样不该写（AGE_RESTRICTED 分支）。
func TestAgeAssertionIsNotWrittenWhenDateOfBirthMissing(t *testing.T) {
	svc, repo := newAgeService(t)
	r := svc.Handle(ageEnvelope("", nil))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "AGE_RESTRICTED" {
		t.Fatalf("expected AGE_RESTRICTED, got %s/%+v", r.Outcome, r.Error)
	}
	if len(repo.calls) != 0 {
		t.Fatalf("no date of birth means nothing to assert, got %+v", repo.calls)
	}
}

// 不支持年龄断言的仓库（老部署 / 内存仓库）必须让注册照常走完 ——
// 缺表不能把主流程拖垮，这是和同意记录一样的取舍。
func TestSignupSucceedsWhenAgeAssertionIsUnsupported(t *testing.T) {
	svc := NewWithRepositoryAndClock(NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)))
	r := svc.Handle(ageEnvelope("1990-01-01", nil))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("a repository without age-assertion support must not break signup, got %s/%+v", r.Outcome, r.Error)
	}
}

// 18 岁生日当天必须算成年 —— 留痕用的日期要和判定用的日期是同一天，
// 否则会出现「判定时成年，留痕时未成年」这种自相矛盾的记录。
func TestAgeAssertionUsesTheSameDateTheGateAccepted(t *testing.T) {
	svc, repo := newAgeService(t)
	// 2008-08-21 出生，固定时钟 2026-08-21 → 恰好 18 岁当天
	r := svc.Handle(ageEnvelope("2008-08-21", nil))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("exactly 18 today must be accepted, got %s/%+v", r.Outcome, r.Error)
	}
	if len(repo.calls) != 1 || repo.calls[0].DateOfBirth != "2008-08-21" {
		t.Fatalf("the assertion must record exactly the date the gate accepted, got %+v", repo.calls)
	}
}
