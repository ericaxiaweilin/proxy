package providerapp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testService(missing []string, bad []string) (*Service, *[]Application) {
	activated := &[]Application{}
	return NewService(NewMemory(), Deps{
		Missing:     func(context.Context, string) []string { return missing },
		DisplayName: func(context.Context, string) string { return "Linh" },
		Terms:       func() (Terms, error) { return testTerms, nil },
		BadPhotos:   func(context.Context, string, []string) ([]string, error) { return bad, nil },
		Activate: func(_ context.Context, a Application) (string, error) {
			*activated = append(*activated, a)
			return "agent_linh", nil
		},
	}), activated
}

var testTerms = Terms{Version: "v1", Items: []TermItem{{ID: "monitoring"}, {ID: "cancel"}}}

func goodInput() Input {
	return Input{
		RealName: "Nguyễn Linh", BirthDate: time.Now().AddDate(-25, 0, 0).Format("2006-01-02"), Phone: "090 123 4567",
		IDType: "cccd", IDFrontAsset: "assets/ma_f", IDBackAsset: "ma_b", SelfieAsset: "ma_s",
		NoCrime: true, DataConsent: true, Emergency: "Mẹ 0987654321", TermsVersion: "v1", Accepted: []string{"monitoring", "cancel"},
	}
}

func TestSubmitNormalizesAndRejectsASecondOpenApplication(t *testing.T) {
	s, _ := testService(nil, nil)
	ctx := context.Background()
	app, err := s.Submit(ctx, "user_1", goodInput())
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if app.Status != StatusSubmitted || app.DisplayName != "Linh" || app.IDFrontAsset != "ma_f" ||
		app.Phone != "+84901234567" || app.IDType != "CCCD" || app.TermsVersion != "v1" || app.Gender != "" {
		t.Fatalf("unexpected application: %+v", app)
	}
	if _, err := s.Submit(ctx, "user_1", goodInput()); !errors.Is(err, ErrAlreadyOpen) {
		t.Fatalf("second submit while open = %v, want ErrAlreadyOpen", err)
	}
}

func TestSubmitListsEveryInvalidField(t *testing.T) {
	s, _ := testService([]string{"avatar"}, nil)
	_, err := s.Submit(context.Background(), "user_1", Input{Languages: []string{"XX"}, BirthDate: time.Now().AddDate(-16, 0, 0).Format("2006-01-02"), TermsVersion: "v1"})
	var v *ValidationError
	if !errors.As(err, &v) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	want := map[string]bool{"profile_avatar": true, "real_name": true, "birth_date": true, "phone": true,
		"languages": true, "id_type": true, "id_documents": true, "selfie": true,
		"no_crime_declared": true, "data_consent": true, "emergency_contact": true, "terms_accepted": true}
	for _, f := range v.Fields {
		delete(want, f)
	}
	if len(want) != 0 {
		t.Fatalf("missing field errors %v in %v", want, v.Fields)
	}
}

func TestSubmitBirthDateBoundaryIsExactDay(t *testing.T) {
	// KYC-BIRTH-DATE-001：满 18 当天放行，差一天（还差 1 天满 18）拦下 —— 年份算法做不到这个。
	s, _ := testService(nil, nil)
	ctx := context.Background()
	exact := goodInput()
	exact.BirthDate = time.Now().AddDate(-18, 0, 0).Format("2006-01-02")
	app, err := s.Submit(ctx, "user_1", exact)
	if err != nil {
		t.Fatalf("exact 18 today: %v", err)
	}
	if app.BirthDate != exact.BirthDate || app.BirthYear != time.Now().Year()-18 {
		t.Fatalf("birth compat columns wrong: %+v", app)
	}
	almost := goodInput()
	almost.BirthDate = time.Now().AddDate(-18, 0, 1).Format("2006-01-02")
	if _, err := s.Submit(ctx, "user_2", almost); !isBirthDateError(err) {
		t.Fatalf("1 day short of 18: got %v, want birth_date", err)
	}
}

func isBirthDateError(err error) bool {
	var v *ValidationError
	if !errors.As(err, &v) {
		return false
	}
	for _, f := range v.Fields {
		if f == "birth_date" {
			return true
		}
	}
	return false
}

func TestSubmitRejectsPhotosThatAreNotOwnRealImages(t *testing.T) {
	s, _ := testService(nil, []string{"ma_s"})
	_, err := s.Submit(context.Background(), "user_1", goodInput())
	var v *ValidationError
	if !errors.As(err, &v) || len(v.Fields) != 1 || v.Fields[0] != "documents_not_own_real" {
		t.Fatalf("want documents_not_own_real, got %v", err)
	}
}

func TestReviewApproveActivatesRejectNeedsReasonAndCanReapply(t *testing.T) {
	s, activated := testService(nil, nil)
	ctx := context.Background()
	first, _ := s.Submit(ctx, "user_1", goodInput())
	var v *ValidationError
	if _, err := s.Review(ctx, first.ID, "op", false, "  "); !errors.As(err, &v) {
		t.Fatalf("reject without reason = %v, want ValidationError", err)
	}
	rejected, err := s.Review(ctx, first.ID, "op", false, "照片太暗")
	if err != nil || rejected.Status != StatusRejected || rejected.RejectReason != "照片太暗" {
		t.Fatalf("reject: %+v %v", rejected, err)
	}
	if _, err := s.Review(ctx, first.ID, "op", true, ""); !errors.Is(err, ErrNotReviewable) {
		t.Fatalf("re-review = %v, want ErrNotReviewable", err)
	}
	if len(*activated) != 0 {
		t.Fatal("rejection must not activate supply")
	}
	second, err := s.Submit(ctx, "user_1", goodInput())
	if err != nil {
		t.Fatalf("reapply after rejection: %v", err)
	}
	approved, err := s.Review(ctx, second.ID, "op", true, "")
	if err != nil || approved.Status != StatusApproved || approved.AgentID != "agent_linh" || len(*activated) != 1 {
		t.Fatalf("approve: %+v %v", approved, err)
	}
	if ForApplicant(approved).ReviewedBy != "" {
		t.Fatal("applicant view must not expose the reviewer")
	}
}

func TestWithdrawOnlyWhileSubmittedAndFailClosedWithoutDeps(t *testing.T) {
	s, _ := testService(nil, nil)
	ctx := context.Background()
	if _, err := s.Withdraw(ctx, "user_1"); !errors.Is(err, ErrNotWithdrawable) {
		t.Fatalf("withdraw nothing = %v", err)
	}
	_, _ = s.Submit(ctx, "user_1", goodInput())
	if app, err := s.Withdraw(ctx, "user_1"); err != nil || app.Status != StatusWithdrawn {
		t.Fatalf("withdraw: %+v %v", app, err)
	}
	if _, err := NewService(NewMemory(), Deps{}).Mine(ctx, "user_1"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("no deps = %v, want ErrUnavailable", err)
	}
}

// 用户：「如果只是小美有性别歧视限制」—— 性别可选，填什么都不影响能不能提交。
func TestGenderIsOptionalAndNeverGates(t *testing.T) {
	for _, gender := range []string{"", "female", "MALE", "other"} {
		s, _ := testService(nil, nil)
		in := goodInput()
		in.Gender = gender
		if _, err := s.Submit(context.Background(), "user_1", in); err != nil {
			t.Fatalf("gender %q blocked submission: %v", gender, err)
		}
	}
}

func TestPassportNeedsNoBackAndOutdatedTermsAreRejected(t *testing.T) {
	s, _ := testService(nil, nil)
	in := goodInput()
	in.IDType, in.IDBackAsset = "PASSPORT", ""
	app, err := s.Submit(context.Background(), "user_1", in)
	if err != nil || app.IDBackAsset != "" {
		t.Fatalf("passport without back: %+v %v", app, err)
	}
	s2, _ := testService(nil, nil)
	stale := goodInput()
	stale.TermsVersion = "v0"
	var v *ValidationError
	if _, err := s2.Submit(context.Background(), "user_2", stale); !errors.As(err, &v) || v.Fields[0] != "terms_outdated" {
		t.Fatalf("stale terms = %v", err)
	}
}

func TestLoadTermsFromTheRepoFile(t *testing.T) {
	terms, err := LoadTerms(filepath.Join("..", "..", "..", "..", "config", "provider-terms", "terms.json"))
	if err != nil || terms.Version == "" || len(terms.Items) < 4 {
		t.Fatalf("repo terms: %+v %v", terms, err)
	}
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "t.json"), []byte(`{"version":"x","items":[{"id":"a"},{"id":"a"}]}`), 0o600)
	if _, err := LoadTerms(filepath.Join(dir, "t.json")); err == nil {
		t.Fatal("duplicate term ids must be rejected")
	}
}

func TestGrantedOnlyAfterApproval(t *testing.T) {
	s, _ := testService(nil, nil)
	ctx := context.Background()
	if ok, _ := s.Granted(ctx, "user_1"); ok {
		t.Fatal("no application must not grant")
	}
	app, _ := s.Submit(ctx, "user_1", goodInput())
	if ok, _ := s.Granted(ctx, "user_1"); ok {
		t.Fatal("pending application must not grant")
	}
	_, _ = s.Review(ctx, app.ID, "op", true, "")
	if ok, _ := s.Granted(ctx, "user_1"); !ok {
		t.Fatal("approved application must grant")
	}
}

// ORDER-CENTER-STATS-001：分母为 0 时比率是 nil（界面显示 —），不是 0% 也不是 100%。
func TestFillRatesLeavesEmptyDenominatorsNil(t *testing.T) {
	empty := ProviderStats{}
	FillRates(&empty)
	if empty.CompletionRate != nil || empty.OnTimeRate != nil {
		t.Fatalf("no orders must give nil rates, got %+v", empty)
	}
	s := ProviderStats{Completed: 3, CancelledByMe: 1, OnTime: 2}
	FillRates(&s)
	if s.CompletionRate == nil || *s.CompletionRate != 0.75 || s.OnTimeRate == nil || *s.OnTimeRate < 0.66 || *s.OnTimeRate > 0.67 {
		t.Fatalf("rates: %+v", s)
	}
}

// ORDER-PERMISSION-KYC-003：KYC 只认人 —— 不填城市 / 服务区域 / 语言也能提交。
func TestKYCDoesNotRequireCityAreasOrLanguages(t *testing.T) {
	s, _ := testService(nil, nil)
	in := goodInput()
	in.City, in.ServiceAreas, in.Languages = "", nil, nil
	if _, err := s.Submit(context.Background(), "user_1", in); err != nil {
		t.Fatalf("KYC must not require service-profile fields: %v", err)
	}
}
