package providerapp

import (
	"context"
	"errors"
	"testing"
)

func testService(missing []string, bad []string) (*Service, *[]Application) {
	activated := &[]Application{}
	return NewService(NewMemory(), Deps{
		Missing:     func(context.Context, string) []string { return missing },
		DisplayName: func(context.Context, string) string { return "Linh" },
		BadPhotos:   func(context.Context, string, []string) ([]string, error) { return bad, nil },
		Activate: func(_ context.Context, a Application) (string, error) {
			*activated = append(*activated, a)
			return "agent_linh", nil
		},
	}), activated
}

func goodInput() Input {
	return Input{
		RealName: "Nguyễn Linh", GenderAttested: true, City: "河内",
		ServiceAreas: []string{"hn", "HN"}, Languages: []string{"vi", "zh"}, Capabilities: []string{"photography"},
		Intro: "河内本地人，中文流利，喜欢带朋友拍照。", PhotoAssetIDs: []string{"assets/ma_1", "ma_2", "ma_3"},
	}
}

func TestSubmitNormalizesAndRejectsASecondOpenApplication(t *testing.T) {
	s, _ := testService(nil, nil)
	ctx := context.Background()
	app, err := s.Submit(ctx, "user_1", goodInput())
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if app.Status != StatusSubmitted || app.DisplayName != "Linh" || len(app.ServiceAreas) != 1 || app.PhotoAssetIDs[0] != "ma_1" || app.Languages[1] != "ZH" {
		t.Fatalf("unexpected application: %+v", app)
	}
	if _, err := s.Submit(ctx, "user_1", goodInput()); !errors.Is(err, ErrAlreadyOpen) {
		t.Fatalf("second submit while open = %v, want ErrAlreadyOpen", err)
	}
}

func TestSubmitListsEveryInvalidField(t *testing.T) {
	s, _ := testService([]string{"avatar"}, nil)
	_, err := s.Submit(context.Background(), "user_1", Input{Languages: []string{"XX"}, PhotoAssetIDs: []string{"ma_1"}})
	var v *ValidationError
	if !errors.As(err, &v) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	want := map[string]bool{"profile_avatar": true, "real_name": true, "gender_attested": true, "city": true,
		"service_areas": true, "languages": true, "intro": true, "photos_count": true}
	for _, f := range v.Fields {
		delete(want, f)
	}
	if len(want) != 0 {
		t.Fatalf("missing field errors %v in %v", want, v.Fields)
	}
}

func TestSubmitRejectsPhotosThatAreNotOwnRealImages(t *testing.T) {
	s, _ := testService(nil, []string{"ma_2"})
	_, err := s.Submit(context.Background(), "user_1", goodInput())
	var v *ValidationError
	if !errors.As(err, &v) || len(v.Fields) != 1 || v.Fields[0] != "photos_not_own_real" {
		t.Fatalf("want photos_not_own_real, got %v", err)
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
