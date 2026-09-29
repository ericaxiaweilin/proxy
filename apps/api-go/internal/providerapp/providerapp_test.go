package providerapp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeSender 是 Deps.Phone 的假实现——"code" 就是唯一一个会被判定为正确的验证码，
// 跟 identity 包里真的短信厂商适配器不打交道（那边有单独的测试）。
type fakeSender struct {
	code string
}

func (f fakeSender) RequestOTP(_ context.Context, phone, _ string) (string, time.Time, error) {
	return "ref_" + phone, time.Now().Add(5 * time.Minute), nil
}

func (f fakeSender) VerifyOTP(_ context.Context, _ string, code string) (bool, error) {
	return code == f.code, nil
}

func testService(missing []string) (*Service, *[]Application) {
	activated := &[]Application{}
	mem := NewMemory()
	return NewService(mem, mem, Deps{
		Missing:     func(context.Context, string) []string { return missing },
		DisplayName: func(context.Context, string) string { return "Linh" },
		Terms:       func() (Terms, error) { return testTerms, nil },
		Phone:       fakeSender{code: "123456"},
		Activate: func(_ context.Context, a Application) (string, error) {
			*activated = append(*activated, a)
			return "agent_linh", nil
		},
	}), activated
}

var testTerms = Terms{Version: "v1", Items: []TermItem{{ID: "monitoring"}, {ID: "cancel"}}}

// verifiedChallenge 走真的 Request → Verify 两步，返回可以塞进 Input.PhoneChallengeID
// 的挑战单 id —— 不是"测试自己伪造一个 VERIFIED 记录"，是真的把 Service 自己的两个
// 方法跑一遍，跟真实客户端的路径一致。
func verifiedChallenge(t *testing.T, s *Service, userID, phone string) string {
	t.Helper()
	ch, err := s.RequestPhoneVerification(context.Background(), userID, phone)
	if err != nil {
		t.Fatalf("request phone verification: %v", err)
	}
	verified, err := s.VerifyPhoneVerification(context.Background(), userID, ch.ID, "123456")
	if err != nil {
		t.Fatalf("verify phone verification: %v", err)
	}
	return verified.ID
}

func goodInputFor(t *testing.T, s *Service, userID string) Input {
	t.Helper()
	phone := "090 123 4567"
	return Input{
		RealName: "Nguyễn Linh", BirthDate: time.Now().AddDate(-25, 0, 0).Format("2006-01-02"), Phone: phone,
		PhoneChallengeID: verifiedChallenge(t, s, userID, phone),
		NoCrime:          true, DataConsent: true, Emergency: "Mẹ 0987654321", TermsVersion: "v1", Accepted: []string{"monitoring", "cancel"},
	}
}

func TestSubmitNormalizesAndRejectsASecondOpenApplication(t *testing.T) {
	s, _ := testService(nil)
	ctx := context.Background()
	app, err := s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if app.Status != StatusSubmitted || app.DisplayName != "Linh" || !app.PhoneVerified ||
		app.Phone != "+84901234567" || app.TermsVersion != "v1" || app.Gender != "" {
		t.Fatalf("unexpected application: %+v", app)
	}
	if _, err := s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1")); !errors.Is(err, ErrAlreadyOpen) {
		t.Fatalf("second submit while open = %v, want ErrAlreadyOpen", err)
	}
}

func TestSubmitListsEveryInvalidField(t *testing.T) {
	s, _ := testService([]string{"avatar"})
	_, err := s.Submit(context.Background(), "user_1", Input{Languages: []string{"XX"}, BirthDate: time.Now().AddDate(-16, 0, 0).Format("2006-01-02"), TermsVersion: "v1"})
	var v *ValidationError
	if !errors.As(err, &v) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	// KYC-PHONE-ONLY-001：没填手机号本身就是格式错（"phone"），还没轮到
	// "phone_not_verified"（那个只在格式对但没验证时才出现）——两者不会同时出现。
	want := map[string]bool{"profile_avatar": true, "real_name": true, "birth_date": true, "phone": true,
		"languages": true, "no_crime_declared": true, "data_consent": true, "emergency_contact": true, "terms_accepted": true}
	for _, f := range v.Fields {
		delete(want, f)
	}
	if len(want) != 0 {
		t.Fatalf("missing field errors %v in %v", want, v.Fields)
	}
}

func TestSubmitBirthDateBoundaryIsExactDay(t *testing.T) {
	// KYC-BIRTH-DATE-001：满 18 当天放行，差一天（还差 1 天满 18）拦下 —— 年份算法做不到这个。
	s, _ := testService(nil)
	ctx := context.Background()
	exact := goodInputFor(t, s, "user_1")
	exact.BirthDate = time.Now().AddDate(-18, 0, 0).Format("2006-01-02")
	app, err := s.Submit(ctx, "user_1", exact)
	if err != nil {
		t.Fatalf("exact 18 today: %v", err)
	}
	if app.BirthDate != exact.BirthDate || app.BirthYear != time.Now().Year()-18 {
		t.Fatalf("birth compat columns wrong: %+v", app)
	}
	almost := goodInputFor(t, s, "user_2")
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

// KYC-PHONE-ONLY-001: Submit 重新查一遍挑战单，不信客户端自己说"验证过了"——
// 没验证 / 验的是别的号 / 验的是别人的申请，都必须落在 phone_not_verified 上。
func TestSubmitRejectsUnverifiedOrMismatchedPhoneChallenge(t *testing.T) {
	ctx := context.Background()

	s, _ := testService(nil)
	in := goodInputFor(t, s, "user_1")
	in.PhoneChallengeID = "" // 从没验证过
	var v *ValidationError
	if _, err := s.Submit(ctx, "user_1", in); !errors.As(err, &v) || !containsField(v.Fields, "phone_not_verified") {
		t.Fatalf("no challenge id = %v, want phone_not_verified", err)
	}

	s2, _ := testService(nil)
	ch, err := s2.RequestPhoneVerification(ctx, "user_1", "090 123 4567")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	in2 := goodInputFor(t, s2, "user_1")
	in2.PhoneChallengeID = ch.ID // 请求过、但从没验证成功（还是 PENDING）
	if _, err := s2.Submit(ctx, "user_1", in2); !errors.As(err, &v) || !containsField(v.Fields, "phone_not_verified") {
		t.Fatalf("unverified challenge = %v, want phone_not_verified", err)
	}

	s3, _ := testService(nil)
	otherChallenge := verifiedChallenge(t, s3, "user_1", "090 999 9999") // 验证的是另一个号
	in3 := goodInputFor(t, s3, "user_1")
	in3.PhoneChallengeID = otherChallenge
	if _, err := s3.Submit(ctx, "user_1", in3); !errors.As(err, &v) || !containsField(v.Fields, "phone_not_verified") {
		t.Fatalf("phone mismatch = %v, want phone_not_verified", err)
	}

	s4, _ := testService(nil)
	othersChallenge := verifiedChallenge(t, s4, "user_2", "090 123 4567") // 验证的是别人的账号
	in4 := goodInputFor(t, s4, "user_2")
	in4.PhoneChallengeID = othersChallenge
	if _, err := s4.Submit(ctx, "user_1", in4); !errors.As(err, &v) || !containsField(v.Fields, "phone_not_verified") {
		t.Fatalf("challenge belongs to another user = %v, want phone_not_verified", err)
	}
}

func containsField(fields []string, want string) bool {
	for _, f := range fields {
		if f == want {
			return true
		}
	}
	return false
}

// KYC-PHONE-ONLY-001: 验证码本身的行为——错误码计次、锁死、成功后状态转 VERIFIED。
func TestVerifyPhoneVerificationLocksAfterMaxAttempts(t *testing.T) {
	s, _ := testService(nil)
	ctx := context.Background()
	ch, err := s.RequestPhoneVerification(ctx, "user_1", "090 123 4567")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, err := s.VerifyPhoneVerification(ctx, "user_1", ch.ID, "000000"); !errors.Is(err, ErrPhoneChallenge) {
			t.Fatalf("wrong code attempt %d = %v, want ErrPhoneChallenge", i, err)
		}
	}
	// 第 6 次哪怕码是对的也不行——已经锁了。
	if _, err := s.VerifyPhoneVerification(ctx, "user_1", ch.ID, "123456"); !errors.Is(err, ErrPhoneChallenge) {
		t.Fatalf("locked challenge with correct code = %v, want ErrPhoneChallenge", err)
	}
}

func TestVerifyPhoneVerificationRejectsWrongUserOrChallenge(t *testing.T) {
	s, _ := testService(nil)
	ctx := context.Background()
	ch, err := s.RequestPhoneVerification(ctx, "user_1", "090 123 4567")
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := s.VerifyPhoneVerification(ctx, "user_2", ch.ID, "123456"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("verify by non-owner = %v, want ErrNotFound", err)
	}
	if _, err := s.VerifyPhoneVerification(ctx, "user_1", "not_a_real_id", "123456"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("verify unknown challenge = %v, want ErrNotFound", err)
	}
}

func TestReviewApproveActivatesRejectNeedsReasonAndCanReapply(t *testing.T) {
	s, activated := testService(nil)
	ctx := context.Background()
	first, _ := s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1"))
	var v *ValidationError
	if _, err := s.Review(ctx, first.ID, "op", false, "  "); !errors.As(err, &v) {
		t.Fatalf("reject without reason = %v, want ValidationError", err)
	}
	rejected, err := s.Review(ctx, first.ID, "op", false, "资料对不上")
	if err != nil || rejected.Status != StatusRejected || rejected.RejectReason != "资料对不上" {
		t.Fatalf("reject: %+v %v", rejected, err)
	}
	if _, err := s.Review(ctx, first.ID, "op", true, ""); !errors.Is(err, ErrNotReviewable) {
		t.Fatalf("re-review = %v, want ErrNotReviewable", err)
	}
	if len(*activated) != 0 {
		t.Fatal("rejection must not activate supply")
	}
	second, err := s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1"))
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
	s, _ := testService(nil)
	ctx := context.Background()
	if _, err := s.Withdraw(ctx, "user_1"); !errors.Is(err, ErrNotWithdrawable) {
		t.Fatalf("withdraw nothing = %v", err)
	}
	_, _ = s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1"))
	if app, err := s.Withdraw(ctx, "user_1"); err != nil || app.Status != StatusWithdrawn {
		t.Fatalf("withdraw: %+v %v", app, err)
	}
	mem := NewMemory()
	if _, err := NewService(mem, mem, Deps{}).Mine(ctx, "user_1"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("no deps = %v, want ErrUnavailable", err)
	}
}

// 用户：「如果只是小美有性别歧视限制」—— 性别可选，填什么都不影响能不能提交。
func TestGenderIsOptionalAndNeverGates(t *testing.T) {
	for _, gender := range []string{"", "female", "MALE", "other"} {
		s, _ := testService(nil)
		in := goodInputFor(t, s, "user_1")
		in.Gender = gender
		if _, err := s.Submit(context.Background(), "user_1", in); err != nil {
			t.Fatalf("gender %q blocked submission: %v", gender, err)
		}
	}
}

func TestOutdatedTermsAreRejected(t *testing.T) {
	s, _ := testService(nil)
	stale := goodInputFor(t, s, "user_1")
	stale.TermsVersion = "v0"
	var v *ValidationError
	if _, err := s.Submit(context.Background(), "user_1", stale); !errors.As(err, &v) || v.Fields[0] != "terms_outdated" {
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
	s, _ := testService(nil)
	ctx := context.Background()
	if ok, _ := s.Granted(ctx, "user_1"); ok {
		t.Fatal("no application must not grant")
	}
	app, _ := s.Submit(ctx, "user_1", goodInputFor(t, s, "user_1"))
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
	s, _ := testService(nil)
	in := goodInputFor(t, s, "user_1")
	in.City, in.ServiceAreas, in.Languages = "", nil, nil
	if _, err := s.Submit(context.Background(), "user_1", in); err != nil {
		t.Fatalf("KYC must not require service-profile fields: %v", err)
	}
}
