package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// MEDIA-FILE-001 — escaped 2026-09-12.
//
// Symptom: "带图片的帖文图片都是黑屏". The posts were fine and the API was
// fine; the bytes were gone. 104 of 528 READY variants (19.7%, across 27
// assets) had no file behind them, yet the read model still emitted a URL for
// every one of them. expo-image renders a failed request as nothing, so the
// parent's dark background showed through — a black rectangle that is
// indistinguishable from "this post has no image".
//
// Two contracts are pinned here:
//   1. a READY row is a claim about INTENT, not about bytes; turning a storage
//      key into a URL the client will fetch requires the file to exist;
//   2. the gate must not degenerate into "never emit a URL" — an object whose
//      bytes are present must still be advertised.
//
// The live DB <-> disk sweep lives in cmd/media-audit --check-files, which is
// wired into scripts/check-regression-contracts.sh.

func writeStoreFile(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestMediaFilePresenceRejectsMissingAndTraversalKeys(t *testing.T) {
	dir := t.TempDir()
	s := NewWithDependencies(NewMemoryRepository(), nil)
	s.SetStoreDir(dir)

	writeStoreFile(t, dir, "present.jpg")

	if !s.storeFilePresent("present.jpg") {
		t.Fatal("present.jpg exists on disk but storeFilePresent said no")
	}
	if s.storeFilePresent("gone.jpg") {
		t.Fatal("gone.jpg is absent but storeFilePresent said yes")
	}
	if s.storeFilePresent("") {
		t.Fatal("empty storage key must never count as present")
	}
	// A key that escapes the store directory must never resolve, even if the
	// target exists: the URL builder must not become a file-browser.
	if s.storeFilePresent("../service.go") {
		t.Fatal("traversal key must not resolve")
	}
	if s.storeFilePresent("nested/../present.jpg") {
		t.Fatal("traversal key with a valid tail must not resolve")
	}
}

func TestPostMediaLookupDoesNotAdvertiseMissingFiles(t *testing.T) {
	dir := t.TempDir()
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	s.SetStoreDir(dir)
	ctx := context.Background()

	// A "ghost": every row says READY, the disk says otherwise.
	if err := repository.CreateAsset(ctx, MediaAsset{
		MediaAssetID:         "ma_ghost",
		MediaType:            "IMAGE",
		OwnerPrincipalID:     "user_001",
		ProcessingStatus:     "READY",
		ModerationStatus:     "APPROVED",
		VisibilityClass:      "PUBLIC",
		ThumbnailStorageKey:  "ghost_thumb.jpg",
		PlaybackStorageKey:   "ghost_play.jpg",
		ThumbnailURL:        "/v1/media/play/ma_ghost",
		PlaybackURL:         "/v1/media/play/ma_ghost",
		OriginalStorageKey:  "ghost_original.jpg",
	}); err != nil {
		t.Fatalf("seed ghost asset: %v", err)
	}
	for _, variant := range []MediaVariant{
		{MediaVariantID: "mv_ghost_feed", MediaAssetID: "ma_ghost", Purpose: "FEED_1X", Status: "READY", StorageKey: "ghost_feed.jpg"},
		{MediaVariantID: "mv_ghost_gallery", MediaAssetID: "ma_ghost", Purpose: "GALLERY", Status: "READY", StorageKey: "ghost_gallery.jpg"},
		{MediaVariantID: "mv_ghost_original", MediaAssetID: "ma_ghost", Purpose: "ORIGINAL", Status: "READY", StorageKey: "ghost_original.jpg"},
	} {
		if err := repository.UpsertVariant(ctx, variant); err != nil {
			t.Fatalf("seed ghost variant %s: %v", variant.MediaVariantID, err)
		}
	}

	// A healthy asset: identical rows, but the bytes are really there.
	writeStoreFile(t, dir, "real_thumb.jpg")
	writeStoreFile(t, dir, "real_play.jpg")
	writeStoreFile(t, dir, "real_feed.jpg")
	writeStoreFile(t, dir, "real_gallery.jpg")
	writeStoreFile(t, dir, "real_original.jpg")
	if err := repository.CreateAsset(ctx, MediaAsset{
		MediaAssetID:        "ma_real",
		MediaType:           "IMAGE",
		OwnerPrincipalID:    "user_001",
		ProcessingStatus:    "READY",
		ModerationStatus:    "APPROVED",
		VisibilityClass:     "PUBLIC",
		ThumbnailStorageKey: "real_thumb.jpg",
		PlaybackStorageKey:  "real_play.jpg",
		ThumbnailURL:        "/v1/media/play/ma_real",
		PlaybackURL:         "/v1/media/play/ma_real",
		OriginalStorageKey:  "real_original.jpg",
	}); err != nil {
		t.Fatalf("seed real asset: %v", err)
	}
	for _, variant := range []MediaVariant{
		{MediaVariantID: "mv_real_feed", MediaAssetID: "ma_real", Purpose: "FEED_1X", Status: "READY", StorageKey: "real_feed.jpg"},
		{MediaVariantID: "mv_real_gallery", MediaAssetID: "ma_real", Purpose: "GALLERY", Status: "READY", StorageKey: "real_gallery.jpg"},
		{MediaVariantID: "mv_real_original", MediaAssetID: "ma_real", Purpose: "ORIGINAL", Status: "READY", StorageKey: "real_original.jpg"},
	} {
		if err := repository.UpsertVariant(ctx, variant); err != nil {
			t.Fatalf("seed real variant %s: %v", variant.MediaVariantID, err)
		}
	}

	got, err := NewPostMediaLookup(s).LookupMediaAssets(ctx, []string{"ma_ghost", "ma_real"})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}

	ghost, ok := got["ma_ghost"]
	if !ok {
		t.Fatalf("expected an entry for ma_ghost, got %+v", got)
	}
	// The whole point: not one URL for a file that is not there. The client
	// then falls back to the labelled placeholder instead of a black frame.
	for name, value := range map[string]string{
		"ThumbnailURL": ghost.ThumbnailURL,
		"PlaybackURL":  ghost.PlaybackURL,
		"FeedURL":      ghost.FeedURL,
		"Feed2xURL":    ghost.Feed2xURL,
		"GalleryURL":   ghost.GalleryURL,
	} {
		if value != "" {
			t.Fatalf("ghost asset advertised %s=%q for a file that does not exist", name, value)
		}
	}
	if ghost.OriginalAvailable {
		t.Fatal("ghost asset advertised originalAvailable for a file that does not exist")
	}

	// Contract 2: the gate must not swallow healthy media.
	real, ok := got["ma_real"]
	if !ok {
		t.Fatalf("expected an entry for ma_real, got %+v", got)
	}
	if real.ThumbnailURL != "/v1/media/play/ma_real" {
		t.Fatalf("healthy thumbnail dropped: got %q", real.ThumbnailURL)
	}
	if real.FeedURL != "/v1/media/variant/mv_real_feed" {
		t.Fatalf("healthy feed variant dropped: got %q", real.FeedURL)
	}
	if real.GalleryURL != "/v1/media/variant/mv_real_gallery" {
		t.Fatalf("healthy gallery variant dropped: got %q", real.GalleryURL)
	}
	if !real.OriginalAvailable {
		t.Fatal("healthy ORIGINAL variant dropped")
	}
}
