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
		result[id] = localnet.MediaAssetInfo{
			MediaAssetID:     asset.MediaAssetID,
			MediaType:        asset.MediaType,
			ThumbnailURL:     asset.ThumbnailURL,
			PlaybackURL:      asset.PlaybackURL,
			Width:            asset.Width,
			Height:           asset.Height,
			DurationMs:       asset.DurationMs,
			ProcessingStatus: asset.ProcessingStatus,
		}
	}
	return result, nil
}
