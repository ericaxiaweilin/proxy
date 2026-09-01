package media

import (
	"context"
	"errors"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

// bulkReadRepository is implemented by durable repositories so a feed page is
// hydrated with two bounded queries instead of one asset + one variant query
// per media item. Memory/custom repositories continue through the safe fallback.
type bulkReadRepository interface {
	GetAssets(ctx context.Context, ids []string) ([]MediaAsset, error)
	ListVariantsForAssets(ctx context.Context, ids []string) ([]MediaVariant, error)
}

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
	if bulk, ok := l.service.repository.(bulkReadRepository); ok {
		assets, err := bulk.GetAssets(ctx, ids)
		if err != nil {
			return nil, err
		}
		variants, err := bulk.ListVariantsForAssets(ctx, ids)
		if err != nil {
			return nil, err
		}
		variantsByAsset := make(map[string][]MediaVariant, len(assets))
		for _, variant := range variants {
			if variant.Status == "READY" {
				variantsByAsset[variant.MediaAssetID] = append(variantsByAsset[variant.MediaAssetID], variant)
			}
		}
		for _, asset := range assets {
			result[asset.MediaAssetID] = mediaAssetInfo(asset, variantsByAsset[asset.MediaAssetID])
		}
		return result, nil
	}
	for _, id := range ids {
		asset, err := l.service.repository.GetAsset(ctx, id)
		if err != nil {
			continue // 找不到的媒体跳过（不阻塞 Feed）
		}
		variants, variantErr := l.service.ListReadyVariants(ctx, id)
		if variantErr != nil {
			variants = nil
		}
		result[id] = mediaAssetInfo(asset, variants)
	}
	return result, nil
}

func mediaAssetInfo(asset MediaAsset, variants []MediaVariant) localnet.MediaAssetInfo {
	info := localnet.MediaAssetInfo{
		MediaAssetID: asset.MediaAssetID, MediaType: asset.MediaType,
		ThumbnailURL: asset.ThumbnailURL, PlaybackURL: asset.PlaybackURL,
		Width: asset.Width, Height: asset.Height, DurationMs: asset.DurationMs, Animated: asset.Animated,
		ProcessingStatus: asset.ProcessingStatus, ModerationStatus: asset.ModerationStatus,
		VisibilityClass: asset.VisibilityClass, DominantColorHex: asset.DominantColorHex,
	}
	for _, variant := range variants {
		url := "/v1/media/variant/" + variant.MediaVariantID
		switch variant.Purpose {
		case "ORIGINAL":
			info.OriginalAvailable = true
		case "FEED_1X":
			info.FeedURL = url
		case "FEED_2X":
			info.Feed2xURL = url
		case "FEED_1X_HINT":
			info.Feed2xHintURL = url
		case "FEED_1X_NATURAL":
			info.Feed2xNaturalURL = url
		case "GALLERY":
			info.GalleryURL = url
		case "PLACEHOLDER":
			info.PlaceholderURL = url
		}
	}
	if asset.CompositionHint != nil {
		info.CompositionHint = toCompositionHintDTO(asset.CompositionHint)
	}
	return info
}

// toCompositionHintDTO 把 media.MediaCompositionHint 转 wire DTO。
func toCompositionHintDTO(h *MediaCompositionHint) *localnet.MediaCompositionHintDTO {
	if h == nil {
		return nil
	}
	dto := &localnet.MediaCompositionHintDTO{
		SubjectType:   h.SubjectType,
		SubjectCount:  h.SubjectCount,
		Confidence:    h.Confidence,
		RecipeVersion: h.RecipeVersion,
		FaceBoxes:     toBoxDTOs(h.FaceBoxes),
		BodyBoxes:     toBoxDTOs(h.BodyBoxes),
	}
	if h.TextSafeArea != nil {
		b := localnet.MediaBoxDTO{X: h.TextSafeArea.X, Y: h.TextSafeArea.Y, Width: h.TextSafeArea.Width, Height: h.TextSafeArea.Height}
		dto.TextSafeArea = &b
	}
	if h.FocalPoint != nil {
		b := localnet.MediaBoxDTO{X: h.FocalPoint.X, Y: h.FocalPoint.Y, Width: h.FocalPoint.Width, Height: h.FocalPoint.Height}
		dto.FocalPoint = &b
	}
	if h.SafeCropRect != nil {
		b := localnet.MediaBoxDTO{X: h.SafeCropRect.X, Y: h.SafeCropRect.Y, Width: h.SafeCropRect.Width, Height: h.SafeCropRect.Height}
		dto.SafeCropRect = &b
	}
	return dto
}

func toBoxDTOs(boxes []MediaBox) []localnet.MediaBoxDTO {
	if len(boxes) == 0 {
		// Wire contract uses arrays for detected regions. JSON null makes the
		// whole feed payload fail validation on clients, so an empty detection
		// result must be encoded as [] rather than null.
		return make([]localnet.MediaBoxDTO, 0)
	}
	out := make([]localnet.MediaBoxDTO, 0, len(boxes))
	for _, b := range boxes {
		out = append(out, localnet.MediaBoxDTO{X: b.X, Y: b.Y, Width: b.Width, Height: b.Height})
	}
	return out
}

func (l *PostMediaLookup) AuthorizeForPost(ctx context.Context, ids []string, ownerPrincipalID, visibility string) error {
	if l.service == nil {
		return errors.New("media service not configured")
	}
	return l.service.AuthorizeForPost(ctx, ids, ownerPrincipalID, visibility)
}
