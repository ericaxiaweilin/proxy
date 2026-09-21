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
	"strconv"
	"strings"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// TWIN-PHOTO-SIM-001: 分身仿真写真（本地仿真通道）。
//
// 用户选自己图库里的 1 张 READY 照片，分身按模板（竖构图 3:4 / 方构图 1:1）
// 做确定性本地合成，产出一张新的写真资产。诚实边界，一个不少：
//
//   - 分身五道门走 aipersona.AuthorizeTwinPhoto（归属 / 类型 / 活体同意 / 年龄）。
//   - 来源图必须是调用者本人名下 READY 的 IMAGE，别人的图、没处理完的图一律拒绝。
//   - 合成是 ffmpeg 确定性裁切缩放，无模型参与：来源标 USER_UPLOADED，不配
//     AI 生成徽；分身归属与来源记 twin_* 三列，UI 显示「分身仿真 · 非AI生成」。
//     真模型供应商接入后走 AI_PERSONA / MODEL_API，那是另一个命令的事。
//   - ffmpeg 不可用时明确 TWIN_SIM_UNAVAILABLE（可重试），绝不假装成功。
//   - v1 只做单图 + 照片：多图合成与视频本地做不了，不开入口（开了就是死按钮）。
type requestTwinPhotoPayload struct {
	TwinPersonaID string `json:"twinPersonaId"`
	SourceAssetID string `json:"sourceAssetId"`
	Template      string `json:"template"`
}

func (s *Service) requestTwinPhoto(ctx context.Context, e command.Envelope) command.Result {
	var p requestTwinPhotoPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.TwinPersonaID) == "" || strings.TrimSpace(p.SourceAssetID) == "" {
		return command.Rejected(e, "INVALID_TWIN_PHOTO_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_twin_photo_request", nil)
	}
	if p.Template != "portrait" && p.Template != "square" {
		return command.Rejected(e, "INVALID_TWIN_PHOTO_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_twin_photo_request", nil)
	}
	if s.personaService == nil {
		return command.Rejected(e, "TWIN_PHOTO_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "media.twin_photo_unavailable", nil)
	}
	if _, err := s.personaService.AuthorizeTwinPhoto(ctx, p.TwinPersonaID, e.Principal.ID); err != nil {
		return command.Rejected(e, "TWIN_PHOTO_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "media.twin_photo_forbidden", nil)
	}
	src, err := s.repository.GetAsset(ctx, p.SourceAssetID)
	if errors.Is(err, ErrAssetNotFound) {
		return command.Rejected(e, "TWIN_SOURCE_INVALID", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.twin_source_invalid", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEDIA_READ_FAILED", "INTERNAL", "SAFE_RETRY", "media.read_failed", nil)
	}
	if src.OwnerPrincipalID != e.Principal.ID || src.MediaType != "IMAGE" || src.ProcessingStatus != "READY" {
		return command.Rejected(e, "TWIN_SOURCE_INVALID", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.twin_source_invalid", nil)
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return command.Rejected(e, "TWIN_SIM_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "media.twin_sim_unavailable", nil)
	}
	srcPath, ok := s.safeStorePath(src.OriginalStorageKey)
	if !ok {
		return command.Rejected(e, "TWIN_SOURCE_INVALID", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.twin_source_invalid", nil)
	}
	now := s.clock.Now().UTC()
	outKey := fmt.Sprintf("twin-sim-%s-%d.jpg", strings.ToLower(p.Template), now.UnixNano())
	outPath := filepath.Join(s.storeDir, outKey)
	var filter string
	if p.Template == "portrait" {
		filter = "crop=w='min(iw,ih*3/4)':h='min(ih,iw*4/3)',scale=1080:1440:force_original_aspect_ratio=disable,setsar=1,format=yuvj420p"
	} else {
		filter = "crop=w='min(iw,ih)':h='min(iw,ih)',scale=1080:1080:force_original_aspect_ratio=disable,setsar=1,format=yuvj420p"
	}
	cmd := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-i", srcPath, "-vf", filter, "-q:v", "4", "-y", outPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(outPath)
		return command.Rejected(e, "TWIN_SIM_FAILED", "INTERNAL", "SAFE_RETRY", "media.twin_sim_failed", map[string]any{"detail": strings.TrimSpace(string(out))})
	}
	w, h := probeImageSize(ctx, outPath)
	raw, err := os.ReadFile(outPath)
	if err != nil {
		_ = os.Remove(outPath)
		return command.Rejected(e, "TWIN_SIM_FAILED", "INTERNAL", "SAFE_RETRY", "media.twin_sim_failed", nil)
	}
	sum := sha256.Sum256(raw)
	asset := MediaAsset{
		MediaAssetID:       newID("ma_"),
		OwnerPrincipalType: e.Principal.Type,
		OwnerPrincipalID:   e.Principal.ID,
		MediaType:          "IMAGE",
		OriginalStorageKey: outKey,
		PlaybackStorageKey: outKey,
		MimeType:           "image/jpeg",
		Width:              w,
		Height:             h,
		ModerationStatus:   "QUARANTINED",
		VisibilityClass:    "OWNER_ONLY",
		ProcessingStatus:   "READY",
		SourceBytes:        int64(len(raw)),
		ChecksumSHA256:     hex.EncodeToString(sum[:]),
		CreatedAt:          now,
		UpdatedAt:          now,
		AIGenerationSource: "USER_UPLOADED",
		AIGenerated:        false,
		TwinPersonaID:      p.TwinPersonaID,
		TwinSourceAssetIDs: []string{src.MediaAssetID},
		TwinSimulated:      true,
	}
	domainEvents := []event.DomainEvent{event.New("TwinPhotoSimulated", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"twinPersonaId": p.TwinPersonaID, "sourceAssetId": src.MediaAssetID, "template": p.Template,
	})}
	if err := s.repository.CreateAsset(ctx, asset); err != nil {
		_ = os.Remove(outPath)
		return command.Rejected(e, "MEDIA_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.create_failed", nil)
	}
	return acceptedWithPayload(e, "MediaAsset", asset.MediaAssetID, 1, "READY", map[string]any{
		"asset":         asset,
		"playable":      true,
		"simulated":     true,
		"template":      p.Template,
		"sourceAssetId": src.MediaAssetID,
	}, domainEvents)
}

// safeStorePath 把 storage key 落到本服务目录，拒绝穿越（与上传路径同口径）。
func (s *Service) safeStorePath(key string) (string, bool) {
	if key == "" || filepath.Base(key) != key || strings.Contains(key, "..") {
		return "", false
	}
	return filepath.Join(s.storeDir, key), true
}

// probeImageSize 读合成产物的真实宽高，写进资产行，不猜。
func probeImageSize(ctx context.Context, path string) (int, int) {
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, 0
	}
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height", "-of", "csv=p=0", path).Output()
	if err != nil {
		return 0, 0
	}
	parts := strings.Split(strings.TrimSpace(string(out)), ",")
	if len(parts) != 2 {
		return 0, 0
	}
	w, _ := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, _ := strconv.Atoi(strings.TrimSpace(parts[1]))
	return w, h
}
