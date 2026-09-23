package usermodel

import (
	"context"
	"errors"
	"testing"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

type fakeVision struct {
	out   string
	err   error
	calls int
	parts int
	task  string
}

func (f *fakeVision) Available() bool { return true }
func (f *fakeVision) Complete(_ context.Context, task string, msgs []modelstack.ChatMessage) (modelstack.Completion, error) {
	f.calls++
	f.task = task
	if len(msgs) > 0 {
		f.parts = len(msgs[0].Parts)
	}
	return modelstack.Completion{Content: f.out}, f.err
}

func intp(v int) *int       { return &v }
func strp(v string) *string { return &v }

func TestEmptyModelHasNothingMadeUp(t *testing.T) {
	p, err := NewService(nil, nil).Get(context.Background(), "u1")
	if err != nil || p.HeightCm != nil || p.Age != nil || p.BodyType != "" || len(p.Sources) != 0 || !p.AsianLock {
		t.Fatalf("a fresh model is empty (asian lock on by default): %+v %v", p, err)
	}
}

func TestAnalyzeFillsAIFieldsButNeverOverwritesManualOnesOrGuessesWeight(t *testing.T) {
	vision := &fakeVision{out: "```json\n{\"heightCm\":165,\"age\":22,\"bodyType\":\"匀称型 · Mesomorph\",\"skinTone\":\"Fitzpatrick II · 暖金底\",\"hair\":null,\"weightKg\":50}\n```"}
	svc := NewService(nil, vision)
	ctx := context.Background()
	if _, err := svc.Update(ctx, "u1", Patch{Age: intp(25)}); err != nil {
		t.Fatal(err)
	}
	p, recognised, err := svc.Analyze(ctx, "u1", []Photo{{DataURI: "data:image/jpeg;base64,AA"}, {DataURI: "data:image/jpeg;base64,BB"}})
	if err != nil {
		t.Fatal(err)
	}
	if vision.task != "proxy.twin.user_modeling_vision" || vision.parts != 3 {
		t.Fatalf("must ask a vision task with the prompt + every photo: task=%q parts=%d", vision.task, vision.parts)
	}
	if recognised != 4 || p.AnalyzedPhotoCount != 2 {
		t.Fatalf("recognised=%d photos=%d", recognised, p.AnalyzedPhotoCount)
	}
	if *p.HeightCm != 165 || p.Sources[FieldHeight] != SourceAI || p.SkinTone == "" {
		t.Fatalf("AI fields must be filled and marked ai: %+v", p)
	}
	if *p.Age != 25 || p.Sources[FieldAge] != SourceManual {
		t.Fatalf("the owner's own value wins over AI: %+v", p)
	}
	if p.WeightKg != nil || p.Hair != "" {
		t.Fatalf("weight is never guessed from photos, null stays empty: %+v", p)
	}
}

func TestAnalyzeRefusesWithoutPhotosOrReadableOutput(t *testing.T) {
	svc := NewService(nil, &fakeVision{out: "我看不清"})
	if _, _, err := svc.Analyze(context.Background(), "u1", nil); !errors.Is(err, ErrNoPhotos) {
		t.Fatalf("no authorised photos -> ErrNoPhotos, got %v", err)
	}
	if _, _, err := svc.Analyze(context.Background(), "u1", []Photo{{DataURI: "x"}}); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("prose instead of JSON -> ErrUnreadable, got %v", err)
	}
	unrouted := NewService(nil, &fakeVision{err: modelstack.ErrTaskNotRoutable})
	if _, _, err := unrouted.Analyze(context.Background(), "u1", []Photo{{DataURI: "x"}}); !errors.Is(err, ErrModelUnavailable) {
		t.Fatalf("no vision model -> ErrModelUnavailable, got %v", err)
	}
}

func TestUpdateValidatesAndClears(t *testing.T) {
	svc := NewService(nil, nil)
	ctx := context.Background()
	if _, err := svc.Update(ctx, "u1", Patch{HeightCm: intp(20)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("absurd height must be rejected, got %v", err)
	}
	if _, err := svc.Update(ctx, "u1", Patch{Age: intp(16)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("under-18 age must be rejected, got %v", err)
	}
	p, _ := svc.Update(ctx, "u1", Patch{WeightKg: intp(48), Hair: strp("短发 · 棕色"), AsianLock: new(bool)})
	if *p.WeightKg != 48 || p.Sources[FieldWeight] != SourceManual || p.AsianLock {
		t.Fatalf("manual values stick: %+v", p)
	}
	p, _ = svc.Update(ctx, "u1", Patch{Clear: []string{FieldWeight, FieldHair}})
	if p.WeightKg != nil || p.Hair != "" || p.Sources[FieldWeight] != "" {
		t.Fatalf("cleared fields go back to empty: %+v", p)
	}
}
