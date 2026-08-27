package media

import (
	"context"
	"testing"
)

// Pass 2 audit closure: PostMediaLookup is the bridge that carries
// MediaAsset.DominantColorHex into the Feed read model. The wiring
// (asset.DominantColorHex → info.DominantColorHex) is one line of code
// and is the kind of line that silently disappears in a refactor. Pin
// it with a focused test so a regression in the lookup is caught at
// unit-test time, not at integration smoke.

func TestPostMediaLookup_PropagatesDominantColorHex(t *testing.T) {
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	ctx := context.Background()
	// Seed an asset directly via the repository (no need to walk the
	// full upload state machine — we are testing the read path).
	if err := repository.CreateAsset(ctx, MediaAsset{
		MediaAssetID:     "media_audit_001",
		MediaType:        "IMAGE",
		OwnerPrincipalID: "user_001",
		ProcessingStatus: "READY",
		ModerationStatus: "APPROVED",
		VisibilityClass:  "PUBLIC",
		DominantColorHex: "#AABBCC",
	}); err != nil {
		t.Fatalf("seed asset: %v", err)
	}
	lookup := NewPostMediaLookup(s)
	got, err := lookup.LookupMediaAssets(ctx, []string{"media_audit_001"})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	info, ok := got["media_audit_001"]
	if !ok {
		t.Fatalf("expected info for media_audit_001, got %+v", got)
	}
	if info.DominantColorHex != "#AABBCC" {
		t.Fatalf("DominantColorHex not propagated: want #AABBCC, got %q", info.DominantColorHex)
	}
}

func TestPostMediaLookup_MissingAsset_SkipsSilently(t *testing.T) {
	// The Feed must NOT fail when a referenced asset is missing; the
	// lookup skips unknown ids and the Feed simply omits the media
	// reference. This is a fail-open contract on the lookup itself
	// but a fail-closed contract on the Feed: missing media MUST NOT
	// turn into a placeholder. Pin the lookup's skip behaviour.
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	lookup := NewPostMediaLookup(s)
	got, err := lookup.LookupMediaAssets(context.Background(), []string{"does_not_exist"})
	if err != nil {
		t.Fatalf("lookup should not error on missing asset: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty map for missing asset, got %+v", got)
	}
}

func TestPostMediaLookup_NilService_Errors(t *testing.T) {
	// Constructing a PostMediaLookup with a nil service must produce a
	// defensive error rather than panic. This guards the integration
	// code in api/server.go where PostMediaLookup wiring is optional.
	lookup := &PostMediaLookup{service: nil}
	if _, err := lookup.LookupMediaAssets(context.Background(), []string{"any"}); err == nil {
		t.Fatal("expected error from nil-service lookup, got nil")
	}
	if err := lookup.AuthorizeForPost(context.Background(), []string{"any"}, "user_001", "PUBLIC"); err == nil {
		t.Fatal("expected error from nil-service AuthorizeForPost, got nil")
	}
}
