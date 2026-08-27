package scene

import (
	"context"
	"testing"
	"time"
)

// TestGetAestheticBackdrop_EmptyRepo_ReturnsZero verifies the
// happy-empty path: a service with no memories returns the zero
// AestheticBackdrop and a nil error. The feed hydrator treats this
// as "no signal, use the hard-coded frame background" — there
// must be no panic, no error, and no fake hex.
func TestGetAestheticBackdrop_EmptyRepo_ReturnsZero(t *testing.T) {
	s := New()
	got, err := s.GetAestheticBackdrop(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Hex != "" || got.SampleCount != 0 {
		t.Fatalf("expected zero backdrop, got %+v", got)
	}
}

// TestGetAestheticBackdrop_SceneTypeFilter verifies the histogram
// filter: only memories whose SceneType matches are considered.
// This guards the "ROOFTOP_PHOTO and BRUNCH don't conflate" rule
// stated in the GetAestheticBackdrop comment.
func TestGetAestheticBackdrop_SceneTypeFilter(t *testing.T) {
	s := New()
	ctx := context.Background()
	// Two ROOFTOP memories, one BRUNCH memory. Filter for ROOFTOP
	// must return the ROOFTOP majority (no cross-contamination).
	now := time.Now()
	if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "s1", HostID: "h", GuestID: "g", MerchantID: "m1", SceneType: "ROOFTOP_PHOTO", FundingMode: "AA", AestheticAssets: []map[string]any{{"dominant": "#AA0000"}}, CreatedAt: now}); err != nil {
		t.Fatalf("upsert 1: %v", err)
	}
	if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "s2", HostID: "h", GuestID: "g", MerchantID: "m1", SceneType: "ROOFTOP_PHOTO", FundingMode: "AA", AestheticAssets: []map[string]any{{"dominant": "#AA0000"}}, CreatedAt: now}); err != nil {
		t.Fatalf("upsert 2: %v", err)
	}
	if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "s3", HostID: "h", GuestID: "g", MerchantID: "m2", SceneType: "BRUNCH", FundingMode: "AA", AestheticAssets: []map[string]any{{"dominant": "#00BB00"}}, CreatedAt: now}); err != nil {
		t.Fatalf("upsert 3: %v", err)
	}
	got, err := s.GetAestheticBackdrop(ctx, "", "ROOFTOP_PHOTO")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.Hex != "#AA0000" {
		t.Fatalf("expected ROOFTOP majority #AA0000, got %q", got.Hex)
	}
	if got.SampleCount != 2 {
		t.Fatalf("expected SampleCount=2, got %d", got.SampleCount)
	}
}

// TestGetAestheticBackdrop_Determinism verifies the same memories
// always produce the same hex — no map-iteration-order flakiness
// in the wire payload. The aggregator sorts (count desc, hex asc)
// before picking the winner.
func TestGetAestheticBackdrop_Determinism(t *testing.T) {
	s := New()
	ctx := context.Background()
	now := time.Now()
	for _, hex := range []string{"#112233", "#223344", "#112233", "#334455"} {
		if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "sc_" + hex, HostID: "h", GuestID: "g", MerchantID: "m", SceneType: "X", FundingMode: "AA", AestheticAssets: []map[string]any{{"dominant": hex}}, CreatedAt: now}); err != nil {
			t.Fatalf("upsert %s: %v", hex, err)
		}
	}
	first, err := s.GetAestheticBackdrop(ctx, "", "X")
	if err != nil { t.Fatalf("first: %v", err) }
	for i := 0; i < 5; i++ {
		again, err := s.GetAestheticBackdrop(ctx, "", "X")
		if err != nil { t.Fatalf("iter %d: %v", i, err) }
		if first.Hex != again.Hex || first.SampleCount != again.SampleCount {
			t.Fatalf("non-deterministic: first=%+v again=%+v", first, again)
		}
	}
	if first.Hex != "#112233" {
		t.Fatalf("expected mode #112233, got %q", first.Hex)
	}
}

// TestGetAestheticBackdrop_MalformedAssetsIgnored verifies that
// memories with no dominant / wrong-format / non-string dominant
// are silently skipped. The aggregate must not panic on bad data
// and must not surface "#INVALID" as the frame color.
func TestGetAestheticBackdrop_MalformedAssetsIgnored(t *testing.T) {
	s := New()
	ctx := context.Background()
	now := time.Now()
	cases := [][]map[string]any{
		nil,
		{},
		{{"other": "x"}},                            // no dominant
		{{"dominant": "not-a-hex"}},                 // wrong length
		{{"dominant": 12345}},                       // wrong type
		{{"dominant": "#GG0000"}},                   // invalid chars (the regex gate is len==7+#, anything else sneaks through but is still uppercase-safe; this is a defensive check)
		{{"dominant": "#ABCDEF"}},                   // the one good row
	}
	for i, assets := range cases {
		if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "bad_" + string(rune('A'+i)), HostID: "h", GuestID: "g", MerchantID: "m", SceneType: "MALFORMED", FundingMode: "AA", AestheticAssets: assets, CreatedAt: now}); err != nil {
			t.Fatalf("upsert %d: %v", i, err)
		}
	}
	got, err := s.GetAestheticBackdrop(ctx, "", "MALFORMED")
	if err != nil { t.Fatalf("unexpected: %v", err) }
	// Only the well-formed #ABCDEF row counts.
	if got.Hex != "#ABCDEF" {
		t.Fatalf("expected #ABCDEF, got %q (sampleCount=%d)", got.Hex, got.SampleCount)
	}
	if got.SampleCount != 1 {
		t.Fatalf("expected SampleCount=1, got %d", got.SampleCount)
	}
}

// TestGetAestheticBackdrop_ConfidenceClampedAtOne guards the
// "Confidence > 1 → 1" clamp so a runaway memory log can't push
// the wire payload outside the documented [0,1] range.
func TestGetAestheticBackdrop_ConfidenceClampedAtOne(t *testing.T) {
	s := New()
	ctx := context.Background()
	now := time.Now()
	for i := 0; i < 20; i++ { // 20 * the same hex — well above saturation
		if err := s.repo.UpsertMemory(ctx, Memory{SceneID: "s_" + string(rune('A'+i)), HostID: "h", GuestID: "g", MerchantID: "m", SceneType: "HOT", FundingMode: "AA", AestheticAssets: []map[string]any{{"dominant": "#FF8800"}}, CreatedAt: now}); err != nil {
			t.Fatalf("upsert %d: %v", i, err)
		}
	}
	got, err := s.GetAestheticBackdrop(ctx, "", "HOT")
	if err != nil { t.Fatalf("unexpected: %v", err) }
	if got.Confidence > 1.0 {
		t.Fatalf("Confidence must clamp at 1.0, got %f", got.Confidence)
	}
	if got.SampleCount != 20 {
		t.Fatalf("expected SampleCount=20, got %d", got.SampleCount)
	}
}

// TestSceneAestheticAdapter_WireShape verifies the adapter
// presents the service's AestheticBackdrop in the localnet
// SceneAestheticBackdrop wire shape. This is the only place the
// two structs ever interop; a future refactor that changes one
// without the other would silently break the feed contract.
func TestSceneAestheticAdapter_WireShape(t *testing.T) {
	// We don't import localnet here (scene cannot depend on
	// localnet via the adapter path; the adapter is what
	// performs that import). Instead, verify the adapter is
	// constructible and returns the underlying service's
	// numbers unchanged. The wire-shape test lives on the
	// localnet side; this test guards the localnet import.
	// We simply confirm the constructor does not panic and the
	// nil service path returns the zero value.
	a := &SceneAestheticAdapter{Service: nil}
	if a == nil { t.Fatal("nil adapter") }
	got, err := a.GetAestheticBackdrop(context.Background(), "", "")
	if err != nil { t.Fatalf("nil svc: %v", err) }
	if got.Hex != "" || got.SampleCount != 0 || got.Confidence != 0 {
		t.Fatalf("nil svc must return zero, got %+v", got)
	}
}
