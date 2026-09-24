package api

import (
	"context"
	"errors"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/media"
)

// AI-MANAGE-009（2026-09-23，用户：「我们本身让模型生成照片 但是模型提示要有本人授权 否则很容易侵犯
// 肖像权 所以这个 ai 管理还要有授权按钮 读取个人主页的图库 不然模型访问不了个人公共相册」）：
//
// 模型要读一个人的照片（拿去生成 TA 的形象图），**只能**走 likenessReferencePhotos。
// 它先查本人对自己 AI 分身（USER_TWIN）的形象授权（LC-07 likeness consent，VISUAL 或
// VISUAL_AND_VOICE、未撤回、未过期、当前条款版本），没有就 ErrLikenessConsentRequired，
// 一张都不给。授权在「我的 → AI 管理」里点，随时可撤回。
//
// 本人在自己的 AI 分身页看自己的图库不受影响（那是 GET /v1/ai/personas/{id}/media，本人会话校验）；
// 这里拦的是「模型 / 出图任务」这条读取路径。出图任务接入时必须调用这里，不许直读媒体库。

var ErrLikenessConsentRequired = errors.New("likeness consent required: the owner has not authorised AI use of their photos")

func (s *Server) likenessReferencePhotos(ctx context.Context, ownerID string) ([]media.MediaAsset, error) {
	if s.AIPersona == nil || s.Media == nil || ownerID == "" {
		return nil, ErrLikenessConsentRequired
	}
	personas, err := s.AIPersona.ListPersonas(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	for _, persona := range personas {
		if persona.PersonaType != aipersona.PersonaTypeUserTwin || persona.OwnerID != ownerID {
			continue
		}
		consent, err := s.AIPersona.HasLiveConsent(ctx, persona.ID, ownerID)
		if err != nil {
			return nil, err
		}
		if consent == nil || (consent.ConsentKind != aipersona.ConsentVisual && consent.ConsentKind != aipersona.ConsentVisualAndVoice) {
			continue
		}
		// 素材 = 本人上传的原图（raw），不含 AI 生成图。
		return s.Media.ListPersonaGallery(ctx, ownerID, persona.ID, "raw")
	}
	return nil, ErrLikenessConsentRequired
}
