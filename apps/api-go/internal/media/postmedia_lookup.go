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
			DominantColorHex: asset.DominantColorHex,
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
		}
		// 透传 compositionHint（§5.2.2）。为空时 nil，前端走启发式回落。
		if asset.CompositionHint != nil {
			info.CompositionHint = toCompositionHintDTO(asset.CompositionHint)
		}
		result[id] = info
	}
	return result, nil
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
