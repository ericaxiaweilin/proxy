package media

import (
	"context"
	"errors"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

// PostMediaLookup 实现 localnet.MediaLookup：Feed Read Model 的媒体详情 Hydrate。
type PostMediaLookup struct {
	service *Service
}

func NewPostMediaLookup(service *Service) *PostMediaLookup {
	return &PostMediaLookup{service: service}
}

func (l *PostMediaLookup) LookupMediaAssets(ctx context.Context, ids []string) (map[string]localnet.MediaAssetInfo, error) {
	if l.service == nil {
		return nil, errors.New("media service not configured")
	}
	result := make(map[string]localnet.MediaAssetInfo, len(ids))
	for _, id := range ids {
		asset, err := l.service.repository.GetAsset(ctx, id)
		if err != nil {
			continue // 找不到的媒体跳过（不阻塞 Feed）
		}
		info := localnet.MediaAssetInfo{
			MediaAssetID:     asset.MediaAssetID,
			MediaType:        asset.MediaType,
			ThumbnailURL:     asset.ThumbnailURL,
			PlaybackURL:      asset.PlaybackURL,
			Width:            asset.Width,
			Height:           asset.Height,
			DurationMs:       asset.DurationMs,
			ProcessingStatus: asset.ProcessingStatus,
			ModerationStatus: asset.ModerationStatus,
			VisibilityClass:  asset.VisibilityClass,
		}
		variants, variantErr := l.service.ListReadyVariants(ctx, id)
		if variantErr == nil {
			for _, variant := range variants {
				url := "/v1/media/variant/" + variant.MediaVariantID
				switch variant.Purpose {
				case "ORIGINAL":
					info.OriginalAvailable = true
				case "FEED_1X":
					info.FeedURL = url
				case "FEED_2X":
					info.Feed2xURL = url
				case "GALLERY":
					info.GalleryURL = url
				case "PLACEHOLDER":
					info.PlaceholderURL = url
				}
			}
		}
		result[id] = info
	}
	return result, nil
}

func (l *PostMediaLookup) AuthorizeForPost(ctx context.Context, ids []string, ownerPrincipalID, visibility string) error {
	if l.service == nil {
		return errors.New("media service not configured")
	}
	return l.service.AuthorizeForPost(ctx, ids, ownerPrincipalID, visibility)
}
