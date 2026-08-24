package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const imageRecipeVersion = "image_recipe_v1"

type imageVariantRecipe struct {
	purpose string
	filter  string
}

var imageVariantRecipes = []imageVariantRecipe{
	{purpose: "FEED_1X", filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease"},
	{purpose: "FEED_2X", filter: "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease"},
	{purpose: "GALLERY", filter: "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease"},
	{purpose: "SHARE_OG", filter: "scale=1200:630:force_original_aspect_ratio=decrease,pad=1200:630:(ow-iw)/2:(oh-ih)/2:color=0x17131F"},
	{purpose: "PLACEHOLDER", filter: "scale=64:64:force_original_aspect_ratio=decrease"},
}

func generateImageVariants(ctx context.Context, originalPath, storeDir string, asset MediaAsset, now time.Time) ([]MediaVariant, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("ffmpeg unavailable for image variants")
	}
	result := make([]MediaVariant, 0, len(imageVariantRecipes))
	for _, recipe := range imageVariantRecipes {
		variantID := "mv_" + asset.MediaAssetID + "_" + strings.ToLower(recipe.purpose) + "_v1"
		storageKey := variantID + ".jpg"
		outputPath := filepath.Join(storeDir, storageKey)
		if _, err := os.Stat(outputPath); errors.Is(err, os.ErrNotExist) {
			temporary, tempErr := os.CreateTemp(storeDir, ".proxy-variant-*.jpg")
			if tempErr != nil {
				return nil, tempErr
			}
			temporaryPath := temporary.Name()
			_ = temporary.Close()
			generated := false
			defer func() {
				if !generated {
					_ = os.Remove(temporaryPath)
				}
			}()
			args := []string{
				"-y", "-i", originalPath, "-frames:v", "1", "-vf", recipe.filter,
				"-map_metadata", "-1", "-q:v", "2", temporaryPath,
			}
			if out, runErr := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); runErr != nil {
				return nil, fmt.Errorf("%s variant failed: %w: %s", recipe.purpose, runErr, clippedOutput(out))
			}
			if renameErr := os.Rename(temporaryPath, outputPath); renameErr != nil {
				return nil, renameErr
			}
			generated = true
		}
		variant, err := describeImageVariant(ctx, variantID, asset.MediaAssetID, recipe.purpose, storageKey, outputPath, now)
		if err != nil {
			return nil, err
		}
		result = append(result, variant)
	}
	return result, nil
}

func describeImageVariant(ctx context.Context, variantID, assetID, purpose, storageKey, path string, now time.Time) (MediaVariant, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return MediaVariant{}, err
	}
	hash := sha256.Sum256(data)
	metadata := readSourceImageMetadata(ctx, path, "image/jpeg")
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return MediaVariant{}, errors.New("generated variant has invalid dimensions")
	}
	return MediaVariant{
		MediaVariantID: variantID,
		MediaAssetID:   assetID,
		Purpose:        purpose,
		RecipeVersion:  imageRecipeVersion,
		Format:         "image/jpeg",
		Width:          metadata.Width,
		Height:         metadata.Height,
		Bytes:          int64(len(data)),
		StorageKey:     storageKey,
		ContentHash:    hex.EncodeToString(hash[:]),
		Status:         "READY",
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}

func variantStorageKey(variants []MediaVariant, purpose, fallback string) string {
	for _, variant := range variants {
		if variant.Purpose == purpose && variant.Status == "READY" {
			return variant.StorageKey
		}
	}
	return fallback
}

func variantURL(variants []MediaVariant, purpose, fallback string) string {
	for _, variant := range variants {
		if variant.Purpose == purpose && variant.Status == "READY" {
			return "/v1/media/variant/" + variant.MediaVariantID
		}
	}
	return fallback
}
