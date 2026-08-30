//go:build pigo

// P1 tripwires for the geometric fallback. They assert that the heuristic
// must return SubjectUnknown (not SubjectScene / SubjectPortrait) when no
// ML detector is available, so downstream crop decisions never come from
// raw aspect-ratio guessing. Today the implementation in composition_pigo.go
// still returns SubjectScene for landscape + SubjectPortrait for tall
// portraits; the tests below are a forcing function for P1 to replace that
// with an honest "I don't know". Run with `go test -tags=pigo` to exercise
// them; default `go test` skips this file.
package media

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestGeometryFallbackNeverFabricatesPeople(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name   string
		width  int
		height int
	}{
		{name: "vertical portrait or poster", width: 1080, height: 1920},
		{name: "four by five portrait or advertisement", width: 1080, height: 1350},
		{name: "landscape group or scene", width: 1920, height: 1080},
		{name: "square product or avatar", width: 1080, height: 1080},
	} {
		t.Run(test.name, func(t *testing.T) {
			boxes, confidence, subjectType := faceRegionHeuristic(test.width, test.height)
			if subjectType != SubjectUnknown {
				t.Fatalf("subject type = %q, want %q", subjectType, SubjectUnknown)
			}
			if len(boxes) != 0 {
				t.Fatalf("fabricated %d face boxes without a detector", len(boxes))
			}
			if confidence >= LowConfidenceThreshold {
				t.Fatalf("confidence = %.2f, must stay below crop threshold %.2f", confidence, LowConfidenceThreshold)
			}
		})
	}
}

func TestFeedRecipesDoNotGenerateCroppedHintVariant(t *testing.T) {
	t.Parallel()

	foundNatural := false
	for _, recipe := range imageVariantRecipesV2 {
		if recipe.purpose == "FEED_1X_HINT" {
			t.Fatal("FEED_1X_HINT must remain legacy-only; new Feed derivatives cannot crop content")
		}
		if recipe.purpose == "FEED_1X_NATURAL" {
			foundNatural = true
		}
		if recipe.purpose == "SHARE_OG" && recipe.filter == "" {
			t.Fatal("SHARE_OG must have a non-cropping filter so later NATURAL recipes are still generated")
		}
	}
	if !foundNatural {
		t.Fatal("FEED_1X_NATURAL preservation derivative is required")
	}
}

func TestNaturalDerivativePreservesPortraitAspect(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	t.Parallel()

	dir := t.TempDir()
	originalPath := filepath.Join(dir, "portrait.png")
	file, err := os.Create(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	portrait := image.NewRGBA(image.Rect(0, 0, 200, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 200; x++ {
			portrait.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 140, A: 255})
		}
	}
	if err := png.Encode(file, portrait); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	variants, err := generateImageVariantsV2(context.Background(), originalPath, dir, MediaAsset{
		MediaAssetID: "portrait_preservation",
		MediaType:    "IMAGE",
	}, nil, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}

	var natural *MediaVariant
	for index := range variants {
		variant := &variants[index]
		if variant.Purpose == "FEED_1X_HINT" {
			t.Fatal("generated a cropped Feed variant")
		}
		if variant.Purpose == "FEED_1X_NATURAL" {
			natural = variant
		}
	}
	if natural == nil {
		t.Fatal("missing FEED_1X_NATURAL")
	}
	if natural.Width*300 != natural.Height*200 {
		t.Fatalf("natural aspect changed: got %dx%d, want 2:3", natural.Width, natural.Height)
	}
}
