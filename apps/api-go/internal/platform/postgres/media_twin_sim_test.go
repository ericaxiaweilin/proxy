package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/media"
)

// TestMediaTwinSimProvenanceRoundTrip proves migration 110 is live and the
// repository round-trips the twin-simulation provenance columns
// (TWIN-PHOTO-SIM-001): persona linkage, source assets and the simulated
// flag survive CreateAsset → GetAsset. Run-scoped rows only, cleaned up.
func TestMediaTwinSimProvenanceRoundTrip(t *testing.T) {
	pool := testPool(t)
	repo := NewMediaRepository(pool)
	ctx := context.Background()
	run := time.Now().UnixNano()
	owner := "user_media_twinsim_" + itoa(run)
	assetID := "ma_twinsim_" + itoa(run)
	now := time.Now().UTC()
	out := media.MediaAsset{
		MediaAssetID: assetID, OwnerPrincipalType: "INDIVIDUAL", OwnerPrincipalID: owner,
		MediaType: "IMAGE", OriginalStorageKey: "twin-sim-" + itoa(run) + ".jpg",
		MimeType: "image/jpeg", Width: 1080, Height: 1440,
		ProcessingStatus: "READY", ModerationStatus: "QUARANTINED", VisibilityClass: "OWNER_ONLY",
		CreatedAt: now, UpdatedAt: now, AIGenerationSource: "USER_UPLOADED",
		TwinPersonaID: "aip_twinsim_" + itoa(run), TwinSourceAssetIDs: []string{"ma_src_a", "ma_src_b"}, TwinSimulated: true,
	}
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })
	if err := repo.CreateAsset(ctx, out); err != nil {
		t.Fatalf("CreateAsset: %v", err)
	}
	got, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if !got.TwinSimulated || got.TwinPersonaID != out.TwinPersonaID || len(got.TwinSourceAssetIDs) != 2 || got.TwinSourceAssetIDs[0] != "ma_src_a" {
		t.Fatalf("twin provenance lost: %+v", got)
	}
	if got.AIGenerationSource != "USER_UPLOADED" || got.AIGenerated {
		t.Fatalf("sim output must not wear the AI badge: %+v", got)
	}
}
