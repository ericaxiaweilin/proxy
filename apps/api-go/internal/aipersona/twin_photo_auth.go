package aipersona

import (
	"context"
	"errors"
	"strings"
)

// ErrTwinPhotoForbidden 是分身写真授权失败的统配错。调用方（media 仿真
// 通道）只关心放行与否，不关心哪一道没过 —— 具体哪道没过写日志，不进
// 响应，避免给调用方枚举「这个分身是谁的 / 有没有同意」的神谕。
var ErrTwinPhotoForbidden = errors.New("aipersona: twin photo not allowed")

// AuthorizeTwinPhoto 判定 userID 能否以 personaID 分身的名义出一张仿真写真，
// 返回 likeness 主体（即分身主人本人）。五道门，全是 fail-closed：
//
//  1. 分身存在且未归档；2. 类型是 USER_TWIN（平台 AI / 创意分身没有真人
//     likeness，不在此通道出图）；3. 调用方就是分身主人；4. (persona,
//     主人) 有活体 likeness 同意（撤回即停）；5. 主人年龄允许（与建分身时
//     同口径的 COMP-AI-MINOR-001，未接查询 / 无证据 / 未成年都拒绝）。
func (s *Service) AuthorizeTwinPhoto(ctx context.Context, personaID, userID string) (string, error) {
	if strings.TrimSpace(personaID) == "" || strings.TrimSpace(userID) == "" {
		return "", ErrTwinPhotoForbidden
	}
	persona, err := s.repo.GetPersona(ctx, personaID)
	if err != nil || persona == nil {
		return "", ErrTwinPhotoForbidden
	}
	if persona.PersonaType != PersonaTypeUserTwin || persona.ArchivedAt != nil {
		return "", ErrTwinPhotoForbidden
	}
	if persona.OwnerID != userID {
		return "", ErrTwinPhotoForbidden
	}
	if ok, err := CompanionAllowedFor(ctx, s.ageLookup, userID, s.now().UTC()); err != nil || !ok {
		return "", ErrTwinPhotoForbidden
	}
	if consent, err := s.HasLiveConsent(ctx, personaID, userID); err != nil || consent == nil {
		return "", ErrTwinPhotoForbidden
	}
	return userID, nil
}
