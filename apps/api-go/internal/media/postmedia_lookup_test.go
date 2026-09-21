package media

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

func TestCompositionHintEmptyBoxesEncodeAsArrays(t *testing.T) {
	dto := toCompositionHintDTO(&MediaCompositionHint{})
	encoded, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal composition hint: %v", err)
	}
	value := string(encoded)
	if !strings.Contains(value, `"faceBoxes":[]`) || !strings.Contains(value, `"bodyBoxes":[]`) {
		t.Fatalf("empty detection boxes must encode as arrays, got %s", value)
	}
}

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

// LC-06 显示侧（2026-09-21 产品决定「AI 做的就标注，法规要求要满足」）：
// PostMediaLookup 是把 MediaAsset.AIGenerationSource 带进 Feed read model 的那座桥。
// 跟 DominantColorHex 同构 —— 也是一行代码，重构时最容易静默消失：消失了编译照样过，
// 只是客户端再也拿不到「这张图是 AI 生成的」，标注就无声无息地没了。
func TestPostMediaLookup_PropagatesAIGenerationSource(t *testing.T) {
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	ctx := context.Background()
	if err := repository.CreateAsset(ctx, MediaAsset{
		MediaAssetID:       "media_ai_prov_001",
		MediaType:          "IMAGE",
		OwnerPrincipalID:   "user_001",
		ProcessingStatus:   "READY",
		ModerationStatus:   "APPROVED",
		VisibilityClass:    "PUBLIC",
		AIGenerationSource: "AI_PERSONA",
	}); err != nil {
		t.Fatalf("seed asset: %v", err)
	}
	lookup := NewPostMediaLookup(s)
	got, err := lookup.LookupMediaAssets(ctx, []string{"media_ai_prov_001"})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	info, ok := got["media_ai_prov_001"]
	if !ok {
		t.Fatalf("expected info for media_ai_prov_001, got %+v", got)
	}
	if info.AIGenerationSource != "AI_PERSONA" {
		t.Fatalf("AIGenerationSource not propagated: want AI_PERSONA, got %q", info.AIGenerationSource)
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

// Pass 3 audit: compositionHint with all-zero body (no face/body boxes
// and a non-nil but empty sub-bbox group) must still serialise the
// `faceBoxes`/`bodyBoxes` arrays as `[]`. Pin the wire-shape contract
// at the DTO level, not only at the hint level, so a future refactor
// of the hint → DTO bridge cannot regress to `null` and break the
// zod fail-closed client.

func TestCompositionHintDTO_EmptyBoxesEncodeAsArrays(t *testing.T) {
	dto := &localnet.MediaCompositionHintDTO{
		SubjectType:   "SCENE",
		SubjectCount:  0,
		FaceBoxes:     []localnet.MediaBoxDTO{},
		BodyBoxes:     []localnet.MediaBoxDTO{},
		Confidence:    0,
		RecipeVersion: "composition_recipe_v1",
	}
	encoded, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal DTO: %v", err)
	}
	if !strings.Contains(string(encoded), `"faceBoxes":[]`) {
		t.Fatalf("DTO.faceBoxes must encode as [] not null, got %s", string(encoded))
	}
	if !strings.Contains(string(encoded), `"bodyBoxes":[]`) {
		t.Fatalf("DTO.bodyBoxes must encode as [] not null, got %s", string(encoded))
	}
}

// Pass 3 audit: toBoxDTOs(nil) must not blow up. A nil input is
// distinct from an empty slice input but the contract is the same:
// emit `[]` so the wire never ships `null`. Belt-and-braces in case
// a future refactor changes the call site to pass a nil literal
// instead of an empty slice.

func TestToBoxDTOs_Nil_EncodesAsArray(t *testing.T) {
	out := toBoxDTOs(nil)
	if out == nil {
		t.Fatal("toBoxDTOs(nil) must return an empty slice, not nil")
	}
	if len(out) != 0 {
		t.Fatalf("toBoxDTOs(nil) must be empty, got %d items", len(out))
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("toBoxDTOs(nil) JSON must be [], got %s", string(encoded))
	}
}

// Pass 3 audit: a single missing media id must NOT bubble up as an
// error from LookupMediaAssets. The lookup is fail-open: unknown ids
// are silently dropped so the feed hydrator can still emit every
// other post and every other media item on a multi-asset post. This
// is the unit-level guarantee behind the architecture invariant
// "one malformed media item must not erase an entire feed".

func TestPostMediaLookup_PartialMissing_KeepsKnownAssets(t *testing.T) {
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	ctx := context.Background()
	if err := repository.CreateAsset(ctx, MediaAsset{
		MediaAssetID:     "media_present",
		MediaType:        "IMAGE",
		OwnerPrincipalID: "user_001",
		ProcessingStatus: "READY",
		ModerationStatus: "APPROVED",
		VisibilityClass:  "PUBLIC",
		Width:            100,
		Height:           100,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	lookup := NewPostMediaLookup(s)
	got, err := lookup.LookupMediaAssets(ctx, []string{"media_present", "media_missing_a", "media_missing_b"})
	if err != nil {
		t.Fatalf("partial missing must not error, got %v", err)
	}
	if _, ok := got["media_present"]; !ok {
		t.Fatalf("present asset must be in result, got %+v", got)
	}
	if _, ok := got["media_missing_a"]; ok {
		t.Fatalf("missing asset must not appear, got %+v", got)
	}
	if _, ok := got["media_missing_b"]; ok {
		t.Fatalf("missing asset must not appear, got %+v", got)
	}
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 entry, got %d", len(got))
	}
}
