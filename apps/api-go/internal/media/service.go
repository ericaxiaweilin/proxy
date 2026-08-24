package media

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// Media P0（PRD Chapter06A §9-12）。
// 普通视频：upload / thumbnail / play / pause / seek / fullscreen / caption / share。
// 只有 READY 的视频允许正式播放。
// FFmpeg 不是播放器：客户端播 MP4/HLS URL；FFmpeg 负责把用户上传的
// HEVC/MOV/奇怪 rotation/不同音频 codec 标准化为 H.264+AAC MP4+faststart。
// 不做：多码率 HLS / ABR / 转码集群 / 直播 / WebRTC（P0 只要求正常播放）。

// MediaAsset 是媒体资产（IMAGE | VIDEO）。
type MediaAsset struct {
	MediaAssetID        string    `json:"mediaAssetId"`
	OwnerPrincipalType  string    `json:"ownerPrincipalType"`
	OwnerPrincipalID    string    `json:"ownerPrincipalId"`
	MediaType           string    `json:"mediaType"` // IMAGE | VIDEO
	OriginalStorageKey  string    `json:"originalStorageKey"`
	PlaybackStorageKey  string    `json:"playbackStorageKey,omitempty"`
	ThumbnailStorageKey string    `json:"thumbnailStorageKey,omitempty"`
	MimeType            string    `json:"mimeType,omitempty"`
	Width               int       `json:"width,omitempty"`
	Height              int       `json:"height,omitempty"`
	DurationMs          int64     `json:"durationMs,omitempty"`
	Codec               string    `json:"codec,omitempty"`
	ProcessingStatus    string    `json:"processingStatus"` // UPLOADING | PROCESSING | READY | FAILED
	PlaybackURL         string    `json:"playbackUrl,omitempty"`
	ThumbnailURL        string    `json:"thumbnailUrl,omitempty"`
	SourceBytes         int64     `json:"sourceBytes,omitempty"`
	ChecksumSHA256      string    `json:"checksumSha256,omitempty"`
	Orientation         int       `json:"orientation,omitempty"`
	ColorSpace          string    `json:"colorSpace,omitempty"`
	HasAlpha            bool      `json:"hasAlpha"`
	Animated            bool      `json:"animated"`
	ModerationStatus    string    `json:"moderationStatus"`
	VisibilityClass     string    `json:"visibilityClass"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// MediaVariant is an immutable, recipe-versioned representation for one UI purpose.
// ORIGINAL remains immutable; a recipe upgrade creates another row instead of overwriting it.
type MediaVariant struct {
	MediaVariantID string    `json:"mediaVariantId"`
	MediaAssetID   string    `json:"mediaAssetId"`
	Purpose        string    `json:"purpose"`
	RecipeVersion  string    `json:"recipeVersion"`
	Format         string    `json:"format"`
	Width          int       `json:"width"`
	Height         int       `json:"height"`
	Bytes          int64     `json:"bytes,omitempty"`
	StorageKey     string    `json:"storageKey"`
	ContentHash    string    `json:"contentHash,omitempty"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// VideoMetadata 是 ffprobe 输出（时长/分辨率/codec/rotation）。
type VideoMetadata struct {
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"durationMs"`
	Codec      string `json:"codec"`
	HasAudio   bool   `json:"hasAudio"`
}

// Processor 是媒体处理链接口（worker 实现，dev 用本地 ffmpeg）。
type Processor interface {
	// Process 处理原文件 → 标准 MP4 + thumbnail，返回播放/缩略图存储 key 和元数据。
	Process(ctx context.Context, originalPath string) (ProcessResult, error)
}

// ProcessResult 是处理结果。
type ProcessResult struct {
	PlaybackStorageKey  string
	ThumbnailStorageKey string
	Metadata            VideoMetadata
}

type Repository interface {
	CreateAsset(ctx context.Context, a MediaAsset) error
	GetAsset(ctx context.Context, id string) (MediaAsset, error)
	UpdateAsset(ctx context.Context, a MediaAsset, expectedStatus string) error
	Snapshot(ctx context.Context) ([]MediaAsset, error)
	UpsertVariant(ctx context.Context, variant MediaVariant) error
	GetVariant(ctx context.Context, variantID string) (MediaVariant, error)
	ListVariants(ctx context.Context, mediaAssetID string) ([]MediaVariant, error)
}

var (
	ErrAssetNotFound     = errors.New("media asset not found")
	ErrStatusTransition  = errors.New("invalid status transition")
	ErrMediaNotOwner     = errors.New("media asset owner mismatch")
	ErrUploadTooLarge    = errors.New("media upload too large")
	ErrMediaTypeMismatch = errors.New("media content type does not match declaration")
	ErrOriginalImmutable = errors.New("original media object is immutable")
)

type MemoryRepository struct {
	mu       sync.Mutex
	assets   map[string]MediaAsset
	variants map[string]MediaVariant
	events   []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{assets: make(map[string]MediaAsset), variants: make(map[string]MediaVariant)}
}

func (r *MemoryRepository) CreateAsset(_ context.Context, a MediaAsset) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.assets[a.MediaAssetID]; exists {
		return errors.New("asset already exists")
	}
	r.assets[a.MediaAssetID] = a
	return nil
}

func (r *MemoryRepository) GetAsset(_ context.Context, id string) (MediaAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, exists := r.assets[id]
	if !exists {
		return MediaAsset{}, ErrAssetNotFound
	}
	return a, nil
}

func (r *MemoryRepository) UpdateAsset(_ context.Context, a MediaAsset, expectedStatus string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.assets[a.MediaAssetID]
	if !exists {
		return ErrAssetNotFound
	}
	if current.ProcessingStatus != expectedStatus {
		return ErrStatusTransition
	}
	r.assets[a.MediaAssetID] = a
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]MediaAsset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]MediaAsset, 0, len(r.assets))
	for _, a := range r.assets {
		result = append(result, a)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryRepository) UpsertVariant(_ context.Context, variant MediaVariant) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := variant.MediaAssetID + ":" + variant.Purpose + ":" + variant.RecipeVersion
	r.variants[key] = variant
	return nil
}

func (r *MemoryRepository) ListVariants(_ context.Context, mediaAssetID string) ([]MediaVariant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []MediaVariant{}
	for _, variant := range r.variants {
		if variant.MediaAssetID == mediaAssetID {
			result = append(result, variant)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Purpose < result[j].Purpose })
	return result, nil
}

func (r *MemoryRepository) GetVariant(_ context.Context, variantID string) (MediaVariant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, variant := range r.variants {
		if variant.MediaVariantID == variantID {
			return variant, nil
		}
	}
	return MediaVariant{}, ErrAssetNotFound
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	processor  Processor
	clock      clock.Clock
	storeDir   string
}

func New() *Service {
	return NewWithDependencies(NewMemoryRepository(), nil)
}

// NewWithDependencies 注入 repository 和 processor。
// processor 为 nil 时用 NoopProcessor（单测/无 ffmpeg 环境）。
func NewWithDependencies(repository Repository, processor Processor) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, processor: processor, clock: clock.System{}, storeDir: filepath.Join(".", "media_store")}
}

// SetStoreDir 覆盖媒体文件本地目录（与 FFmpegProcessor.StoreDir 对齐）。
func (s *Service) SetStoreDir(dir string) {
	s.storeDir = dir
}

// SaveUpload persists the authenticated owner's raw upload under the storage
// key registered by CreateMediaAsset. The command state remains UPLOADING;
// CompleteMediaUpload and ProcessMediaAsset still own lifecycle transitions.
func (s *Service) SaveUpload(ctx context.Context, id string, ownerPrincipalID string, source io.Reader, maxBytes int64) (MediaAsset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	asset, err := s.repository.GetAsset(ctx, id)
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.OwnerPrincipalID != ownerPrincipalID {
		return MediaAsset{}, ErrMediaNotOwner
	}
	if asset.ProcessingStatus != "UPLOADING" {
		return MediaAsset{}, ErrStatusTransition
	}
	key := asset.OriginalStorageKey
	if key == "" || filepath.Base(key) != key || strings.Contains(key, "..") {
		return MediaAsset{}, errors.New("invalid storage key")
	}
	if maxBytes <= 0 {
		maxBytes = 20 << 20
	}
	if err := os.MkdirAll(s.storeDir, 0o750); err != nil {
		return MediaAsset{}, err
	}
	destinationPath := filepath.Join(s.storeDir, key)
	temporary, err := os.CreateTemp(s.storeDir, ".proxy-upload-*")
	if err != nil {
		return MediaAsset{}, err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	buffered := bufio.NewReader(source)
	header, peekErr := buffered.Peek(512)
	if peekErr != nil && !errors.Is(peekErr, io.EOF) {
		return MediaAsset{}, peekErr
	}
	detectedMime := detectMediaMime(header)
	if !mediaMimeAllowed(asset.MediaType, asset.MimeType, detectedMime) {
		return MediaAsset{}, ErrMediaTypeMismatch
	}
	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(temporary, hasher), io.LimitReader(buffered, maxBytes+1))
	if err != nil {
		return MediaAsset{}, err
	}
	if written > maxBytes {
		return MediaAsset{}, ErrUploadTooLarge
	}
	if err := temporary.Sync(); err != nil {
		return MediaAsset{}, err
	}
	if err := temporary.Close(); err != nil {
		return MediaAsset{}, err
	}
	if asset.MediaType == "IMAGE" {
		metadata := readSourceImageMetadata(ctx, temporaryPath, detectedMime)
		if metadata.Width > 0 && metadata.Height > 0 {
			asset.Width = metadata.Width
			asset.Height = metadata.Height
		}
		asset.Orientation = metadata.Orientation
		asset.ColorSpace = metadata.ColorSpace
		asset.HasAlpha = metadata.HasAlpha
		asset.Animated = metadata.Animated
	}
	// Link is exclusive: unlike Rename on Unix it cannot silently overwrite an
	// existing ORIGINAL object. The temp file lives in the same directory/filesystem.
	if err := os.Link(temporaryPath, destinationPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			incomingHash := hex.EncodeToString(hasher.Sum(nil))
			// A PUT whose response was lost may be retried. The exact same bytes
			// are idempotent; different bytes can never replace ORIGINAL.
			if asset.SourceBytes == written && asset.ChecksumSHA256 != "" && asset.ChecksumSHA256 == incomingHash {
				_ = os.Remove(temporaryPath)
				committed = true
				if variantErr := s.persistOriginalVariant(ctx, asset); variantErr != nil {
					return MediaAsset{}, variantErr
				}
				return asset, nil
			}
			return MediaAsset{}, ErrOriginalImmutable
		}
		return MediaAsset{}, err
	}
	originalPersisted := true
	defer func() {
		if originalPersisted {
			_ = os.Remove(destinationPath)
		}
	}()
	asset.SourceBytes = written
	asset.ChecksumSHA256 = hex.EncodeToString(hasher.Sum(nil))
	asset.MimeType = detectedMime
	if err := s.repository.UpdateAsset(ctx, asset, "UPLOADING"); err != nil {
		return MediaAsset{}, err
	}
	originalPersisted = false
	if err := s.persistOriginalVariant(ctx, asset); err != nil {
		return MediaAsset{}, err
	}
	_ = os.Remove(temporaryPath)
	committed = true
	return asset, nil
}

func (s *Service) persistOriginalVariant(ctx context.Context, asset MediaAsset) error {
	now := s.clock.Now().UTC()
	return s.repository.UpsertVariant(ctx, MediaVariant{
		MediaVariantID: "mv_" + asset.MediaAssetID + "_original_v1",
		MediaAssetID:   asset.MediaAssetID,
		Purpose:        "ORIGINAL",
		RecipeVersion:  "original_v1",
		Format:         asset.MimeType,
		Width:          asset.Width,
		Height:         asset.Height,
		Bytes:          asset.SourceBytes,
		StorageKey:     asset.OriginalStorageKey,
		ContentHash:    asset.ChecksumSHA256,
		Status:         "READY",
		CreatedAt:      now,
		UpdatedAt:      now,
	})
}

func detectMediaMime(header []byte) string {
	if len(header) >= 12 && string(header[4:8]) == "ftyp" {
		brand := string(header[8:12])
		switch brand {
		case "heic", "heix", "hevc", "hevx", "mif1", "msf1":
			return "image/heic"
		case "avif", "avis":
			return "image/avif"
		}
	}
	return http.DetectContentType(header)
}

func mediaMimeAllowed(mediaType, declared, detected string) bool {
	expectedPrefix := "image/"
	if mediaType == "VIDEO" {
		expectedPrefix = "video/"
	}
	if !strings.HasPrefix(detected, expectedPrefix) {
		return false
	}
	normalize := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
		if value == "image/jpg" {
			return "image/jpeg"
		}
		if value == "image/heif" {
			return "image/heic"
		}
		return value
	}
	return declared == "" || normalize(declared) == normalize(detected)
}

// ResolveServingPath 把 READY 资产的 storage key 解析为本地文件路径，供
// GET /v1/media/play|thumb/{id} 直接 ServeFile（客户端播 MP4/图片 URL）。
// kind: "play" | "thumb"（thumb 缺失时降级回 playback 文件）。
// fail-closed：非 READY / key 含路径分隔符（防目录穿越）一律拒绝。
func (s *Service) ResolveServingPath(ctx context.Context, id string, kind string) (string, error) {
	asset, err := s.repository.GetAsset(ctx, id)
	if err != nil {
		return "", err
	}
	if asset.ProcessingStatus != "READY" {
		return "", errors.New("media not ready")
	}
	key := asset.PlaybackStorageKey
	if kind == "thumb" {
		if asset.ThumbnailStorageKey != "" {
			key = asset.ThumbnailStorageKey
		}
	}
	if key == "" || strings.ContainsAny(key, "/\\") || strings.Contains(key, "..") {
		return "", errors.New("invalid storage key")
	}
	return filepath.Join(s.storeDir, key), nil
}

func (s *Service) ResolveVariantPath(ctx context.Context, variantID string) (string, error) {
	variant, err := s.repository.GetVariant(ctx, variantID)
	if err != nil {
		return "", err
	}
	if variant.Status != "READY" {
		return "", errors.New("variant not ready")
	}
	if variant.Purpose == "ORIGINAL" {
		return "", errors.New("original variant is not a public delivery resource")
	}
	if variant.StorageKey == "" || strings.ContainsAny(variant.StorageKey, "/\\") || strings.Contains(variant.StorageKey, "..") {
		return "", errors.New("invalid variant storage key")
	}
	return filepath.Join(s.storeDir, variant.StorageKey), nil
}

func (s *Service) ListReadyVariants(ctx context.Context, mediaAssetID string) ([]MediaVariant, error) {
	variants, err := s.repository.ListVariants(ctx, mediaAssetID)
	if err != nil {
		return nil, err
	}
	ready := make([]MediaVariant, 0, len(variants))
	for _, variant := range variants {
		if variant.Status == "READY" {
			ready = append(ready, variant)
		}
	}
	return ready, nil
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateMediaAsset", "CompleteMediaUpload", "ProcessMediaAsset",
		"MarkMediaReady", "GetMediaAsset", "ListMediaAssets":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateMediaAsset":
		return s.createAsset(ctx, e)
	case "CompleteMediaUpload":
		return s.completeUpload(ctx, e)
	case "ProcessMediaAsset":
		return s.processAsset(ctx, e)
	case "MarkMediaReady":
		return s.markReady(ctx, e)
	case "GetMediaAsset":
		return s.getAsset(ctx, e)
	case "ListMediaAssets":
		return s.listAssets(ctx, e)
	default:
		return command.Rejected(e, "MEDIA_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "media.unsupported_command", nil)
	}
}

// ---------- CreateMediaAsset ----------
// 登记上传：拿到 upload URL（dev 返回本地直传路径），资产 = UPLOADING。

type createAssetPayload struct {
	MediaType          string `json:"mediaType"`
	OriginalStorageKey string `json:"originalStorageKey"`
	MimeType           string `json:"mimeType"`
	Width              int    `json:"width"`
	Height             int    `json:"height"`
}

func (s *Service) createAsset(ctx context.Context, e command.Envelope) command.Result {
	var p createAssetPayload
	if !decode(e.Payload, &p) || p.MediaType == "" || p.OriginalStorageKey == "" {
		return command.Rejected(e, "INVALID_MEDIA_ASSET", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_asset", nil)
	}
	if p.MediaType != "IMAGE" && p.MediaType != "VIDEO" {
		return command.Rejected(e, "INVALID_MEDIA_TYPE", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_type", map[string]any{"mediaType": p.MediaType})
	}
	now := s.clock.Now().UTC()
	asset := MediaAsset{
		MediaAssetID:       newID("ma_"),
		OwnerPrincipalType: e.Principal.Type,
		OwnerPrincipalID:   e.Principal.ID,
		MediaType:          p.MediaType,
		OriginalStorageKey: p.OriginalStorageKey,
		MimeType:           p.MimeType,
		Width:              p.Width,
		Height:             p.Height,
		ModerationStatus:   "PENDING",
		VisibilityClass:    "OWNER_ONLY",
		ProcessingStatus:   "UPLOADING",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	domainEvents := []event.DomainEvent{event.New("MediaAssetCreated", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"mediaType": p.MediaType,
		"status":    "UPLOADING",
	})}
	if err := s.repository.CreateAsset(ctx, asset); err != nil {
		return command.Rejected(e, "MEDIA_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.create_failed", nil)
	}
	return acceptedWithPayload(e, "MediaAsset", asset.MediaAssetID, 1, "UPLOADING", map[string]any{
		"mediaAssetId": asset.MediaAssetID,
		"uploadUrl":    "/v1/media/upload/" + asset.MediaAssetID, // dev：本地直传端点
		"status":       "UPLOADING",
	}, domainEvents)
}

// ---------- CompleteMediaUpload ----------
// 上传完成 → PROCESSING（准备处理）。

type completeUploadPayload struct {
	OriginalStorageKey string `json:"originalStorageKey"`
}

func (s *Service) completeUpload(ctx context.Context, e command.Envelope) command.Result {
	var p completeUploadPayload
	if !decode(e.Payload, &p) || p.OriginalStorageKey == "" {
		return command.Rejected(e, "INVALID_COMPLETE_UPLOAD", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_complete_upload", nil)
	}
	asset, err := s.repository.GetAsset(ctx, e.Target.ID)
	if errors.Is(err, ErrAssetNotFound) {
		return command.Rejected(e, "MEDIA_ASSET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.asset_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEDIA_READ_FAILED", "INTERNAL", "SAFE_RETRY", "media.read_failed", nil)
	}
	if asset.OwnerPrincipalID != e.Principal.ID {
		return command.Rejected(e, "MEDIA_NOT_OWNER", "AUTHORIZATION", "AFTER_USER_ACTION", "media.not_owner", nil)
	}
	if asset.ProcessingStatus != "UPLOADING" {
		return command.Rejected(e, "MEDIA_NOT_UPLOADING", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.not_uploading", map[string]any{"status": asset.ProcessingStatus})
	}
	if asset.OriginalStorageKey != p.OriginalStorageKey {
		return command.Rejected(e, "STORAGE_KEY_MISMATCH", "VALIDATION", "AFTER_USER_ACTION", "media.storage_key_mismatch", nil)
	}
	asset.ProcessingStatus = "PROCESSING"
	asset.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("MediaUploadCompleted", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, asset.UpdatedAt, map[string]any{
		"status": "PROCESSING",
	})}
	if err := s.repository.UpdateAsset(ctx, asset, "UPLOADING"); err != nil {
		return command.Rejected(e, "MEDIA_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.update_failed", nil)
	}
	return command.Accepted(e, "MediaAsset", asset.MediaAssetID, 1, "PROCESSING", eventRefs(domainEvents))
}

// ---------- ProcessMediaAsset ----------
// Worker 触发：ffprobe + ffmpeg 标准化 → 标准 MP4 + thumbnail。
// 无 processor 时（dev 无 ffmpeg）跳到 READY。

type processPayload struct {
	OriginalPath string `json:"originalPath"` // dev：本地原文件路径（模拟 Object Storage 取回）
}

func (s *Service) processAsset(ctx context.Context, e command.Envelope) command.Result {
	var p processPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROCESS_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_process", nil)
	}
	// ffmpeg 支持 http:// / concat: / subfile: 等协议输入：客户端可控路径不做
	// 收敛会变成任意文件读取 + SSRF。只接受本地普通文件路径。
	if p.OriginalPath != "" && !isSafeLocalPath(p.OriginalPath) {
		return command.Rejected(e, "UNSAFE_MEDIA_PATH", "VALIDATION", "AFTER_USER_ACTION", "media.unsafe_path", nil)
	}
	asset, err := s.repository.GetAsset(ctx, e.Target.ID)
	if errors.Is(err, ErrAssetNotFound) {
		return command.Rejected(e, "MEDIA_ASSET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.asset_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEDIA_READ_FAILED", "INTERNAL", "SAFE_RETRY", "media.read_failed", nil)
	}
	if asset.OwnerPrincipalID != e.Principal.ID {
		return command.Rejected(e, "MEDIA_NOT_OWNER", "AUTHORIZATION", "AFTER_USER_ACTION", "media.not_owner", nil)
	}
	if asset.ProcessingStatus != "PROCESSING" {
		return command.Rejected(e, "MEDIA_NOT_PROCESSING", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.not_processing", map[string]any{"status": asset.ProcessingStatus})
	}
	if asset.MediaType == "IMAGE" {
		// ORIGINAL 永不覆盖；Feed/Gallery/分享分别使用 recipe-versioned variants。
		originalPath := filepath.Join(s.storeDir, asset.OriginalStorageKey)
		variants, variantErr := generateImageVariants(ctx, originalPath, s.storeDir, asset, s.clock.Now().UTC())
		if variantErr != nil {
			asset.ProcessingStatus = "FAILED"
			asset.UpdatedAt = s.clock.Now().UTC()
			_ = s.repository.UpdateAsset(ctx, asset, "PROCESSING")
			return command.Rejected(e, "IMAGE_VARIANT_PROCESSING_FAILED", "PROVIDER", "SAFE_RETRY", "media.image_variant_failed", map[string]any{"detail": variantErr.Error()})
		}
		for _, variant := range variants {
			if err := s.repository.UpsertVariant(ctx, variant); err != nil {
				return command.Rejected(e, "MEDIA_VARIANT_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.variant_update_failed", nil)
			}
		}
		asset.ProcessingStatus = "READY"
		asset.PlaybackStorageKey = asset.OriginalStorageKey
		asset.ThumbnailStorageKey = variantStorageKey(variants, "FEED_1X", asset.OriginalStorageKey)
		asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
		asset.ThumbnailURL = variantURL(variants, "FEED_1X", "/v1/media/thumb/"+asset.MediaAssetID)
		asset.UpdatedAt = s.clock.Now().UTC()
		domainEvents := []event.DomainEvent{event.New("MediaAssetReady", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, asset.UpdatedAt, map[string]any{
			"status": "READY", "mediaType": "IMAGE",
		})}
		if err := s.repository.UpdateAsset(ctx, asset, "PROCESSING"); err != nil {
			return command.Rejected(e, "MEDIA_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.update_failed", nil)
		}
		return command.Accepted(e, "MediaAsset", asset.MediaAssetID, 1, "READY", eventRefs(domainEvents))
	}
	// VIDEO：走 FFmpeg 处理链
	if s.processor == nil {
		// 无 processor：模拟处理成功（dev 无 ffmpeg 时）
		asset.ProcessingStatus = "READY"
		asset.PlaybackStorageKey = asset.OriginalStorageKey
		asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
		asset.ThumbnailURL = "/v1/media/thumb/" + asset.MediaAssetID
		asset.UpdatedAt = s.clock.Now().UTC()
		domainEvents := []event.DomainEvent{event.New("MediaAssetReady", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, asset.UpdatedAt, map[string]any{
			"status": "READY", "mediaType": "VIDEO", "note": "no processor (dev)",
		})}
		if err := s.repository.UpdateAsset(ctx, asset, "PROCESSING"); err != nil {
			return command.Rejected(e, "MEDIA_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.update_failed", nil)
		}
		return acceptedWithPayload(e, "MediaAsset", asset.MediaAssetID, 1, "READY", map[string]any{
			"mediaAssetId":     asset.MediaAssetID,
			"playbackUrl":      asset.PlaybackURL,
			"processingStatus": "READY",
		}, domainEvents)
	}
	result, err := s.processor.Process(ctx, p.OriginalPath)
	if err != nil {
		// 处理失败 → FAILED（保留原文件，可重试）
		asset.ProcessingStatus = "FAILED"
		asset.UpdatedAt = s.clock.Now().UTC()
		_ = s.repository.UpdateAsset(ctx, asset, "PROCESSING")
		return command.Rejected(e, "MEDIA_PROCESSING_FAILED", "PROVIDER", "SAFE_RETRY", "media.processing_failed", map[string]any{"detail": err.Error()})
	}
	asset.ProcessingStatus = "READY"
	asset.PlaybackStorageKey = result.PlaybackStorageKey
	asset.ThumbnailStorageKey = result.ThumbnailStorageKey
	asset.Width = result.Metadata.Width
	asset.Height = result.Metadata.Height
	asset.DurationMs = result.Metadata.DurationMs
	asset.Codec = result.Metadata.Codec
	asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
	asset.ThumbnailURL = "/v1/media/thumb/" + asset.MediaAssetID
	asset.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("MediaAssetReady", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, asset.UpdatedAt, map[string]any{
		"status":     "READY",
		"mediaType":  "VIDEO",
		"durationMs": result.Metadata.DurationMs,
		"codec":      result.Metadata.Codec,
		"width":      result.Metadata.Width,
		"height":     result.Metadata.Height,
		"note":       "H.264 + AAC MP4 + faststart；只有 READY 可正式播放",
	})}
	if err := s.repository.UpdateAsset(ctx, asset, "PROCESSING"); err != nil {
		return command.Rejected(e, "MEDIA_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.update_failed", nil)
	}
	return acceptedWithPayload(e, "MediaAsset", asset.MediaAssetID, 1, "READY", map[string]any{
		"mediaAssetId":     asset.MediaAssetID,
		"playbackUrl":      asset.PlaybackURL,
		"thumbnailUrl":     asset.ThumbnailURL,
		"durationMs":       asset.DurationMs,
		"width":            asset.Width,
		"height":           asset.Height,
		"codec":            asset.Codec,
		"processingStatus": "READY",
	}, domainEvents)
}

// ---------- MarkMediaReady ----------
// 手动标 READY（外部 worker 已处理完的场景）。API 边界已将其限定为 operator
// 命令；这里仍坚持 PROCESSING 前置，禁止从 UPLOADING 直接跳过处理链。

type markReadyPayload struct {
	PlaybackStorageKey  string `json:"playbackStorageKey"`
	ThumbnailStorageKey string `json:"thumbnailStorageKey"`
	DurationMs          int64  `json:"durationMs"`
	Width               int    `json:"width"`
	Height              int    `json:"height"`
	Codec               string `json:"codec"`
}

func (s *Service) markReady(ctx context.Context, e command.Envelope) command.Result {
	var p markReadyPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_MARK_READY", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_mark_ready", nil)
	}
	asset, err := s.repository.GetAsset(ctx, e.Target.ID)
	if errors.Is(err, ErrAssetNotFound) {
		return command.Rejected(e, "MEDIA_ASSET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.asset_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEDIA_READ_FAILED", "INTERNAL", "SAFE_RETRY", "media.read_failed", nil)
	}
	expectedStatus := asset.ProcessingStatus
	if expectedStatus != "PROCESSING" {
		return command.Rejected(e, "MEDIA_NOT_PROCESSABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.not_processable", map[string]any{"status": asset.ProcessingStatus})
	}
	asset.ProcessingStatus = "READY"
	if p.PlaybackStorageKey != "" {
		asset.PlaybackStorageKey = p.PlaybackStorageKey
	}
	if p.ThumbnailStorageKey != "" {
		asset.ThumbnailStorageKey = p.ThumbnailStorageKey
	}
	asset.DurationMs = p.DurationMs
	asset.Width = p.Width
	asset.Height = p.Height
	asset.Codec = p.Codec
	asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
	asset.ThumbnailURL = "/v1/media/thumb/" + asset.MediaAssetID
	asset.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("MediaAssetReady", "MediaAsset", asset.MediaAssetID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, asset.UpdatedAt, map[string]any{
		"status": "READY", "mediaType": asset.MediaType,
	})}
	if err := s.repository.UpdateAsset(ctx, asset, expectedStatus); err != nil {
		return command.Rejected(e, "MEDIA_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "media.update_failed", nil)
	}
	return command.Accepted(e, "MediaAsset", asset.MediaAssetID, 1, "READY", eventRefs(domainEvents))
}

// ---------- GetMediaAsset / ListMediaAssets ----------
// 只能读自己名下的资产：storage key / URL 是敏感数据，不得跨 principal 泄露。

func (s *Service) getAsset(ctx context.Context, e command.Envelope) command.Result {
	assetID := e.Target.ID
	if assetID == "" {
		var p struct {
			MediaAssetID string `json:"mediaAssetId"`
		}
		if !decode(e.Payload, &p) || p.MediaAssetID == "" {
			return command.Rejected(e, "INVALID_ASSET_QUERY", "VALIDATION", "AFTER_USER_ACTION", "media.invalid_query", nil)
		}
		assetID = p.MediaAssetID
	}
	asset, err := s.repository.GetAsset(ctx, assetID)
	if errors.Is(err, ErrAssetNotFound) {
		return command.Rejected(e, "MEDIA_ASSET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "media.asset_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEDIA_READ_FAILED", "INTERNAL", "SAFE_RETRY", "media.read_failed", nil)
	}
	if asset.OwnerPrincipalID != e.Principal.ID {
		return command.Rejected(e, "MEDIA_NOT_OWNER", "AUTHORIZATION", "AFTER_USER_ACTION", "media.not_owner", nil)
	}
	return acceptedWithPayload(e, "MediaAsset", asset.MediaAssetID, 1, asset.ProcessingStatus, map[string]any{
		"asset":    asset,
		"playable": asset.ProcessingStatus == "READY", // 只有 READY 可正式播放
	}, nil)
}

func (s *Service) listAssets(ctx context.Context, e command.Envelope) command.Result {
	assets, err := s.repository.Snapshot(ctx)
	if err != nil {
		return command.Rejected(e, "MEDIA_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "media.list_failed", nil)
	}
	owned := make([]MediaAsset, 0, len(assets))
	for _, asset := range assets {
		if asset.OwnerPrincipalID == e.Principal.ID {
			owned = append(owned, asset)
		}
	}
	return acceptedWithPayload(e, "MediaAsset", "", 1, "LIST", map[string]any{
		"assets": owned,
	}, nil)
}

// ---------- FFmpeg Processor（本地 dev 实现）----------

// FFmpegProcessor 用本机 ffmpeg/ffprobe 实现处理链：
// ffprobe 读元数据 → ffmpeg 转 H.264+AAC MP4+faststart → thumbnail → 存 media_store。
type FFmpegProcessor struct {
	StoreDir string // 输出目录（模拟 Object Storage）
}

func NewFFmpegProcessor(storeDir string) *FFmpegProcessor {
	return &FFmpegProcessor{StoreDir: storeDir}
}

func (p *FFmpegProcessor) Process(ctx context.Context, originalPath string) (ProcessResult, error) {
	if originalPath == "" {
		return ProcessResult{}, errors.New("original path required")
	}
	if !isSafeLocalPath(originalPath) {
		return ProcessResult{}, errors.New("original path must be a plain local file path")
	}
	if p.StoreDir == "" {
		p.StoreDir = filepath.Join(".", "media_store")
	}
	if err := os.MkdirAll(p.StoreDir, 0o755); err != nil {
		return ProcessResult{}, err
	}
	// 1. ffprobe 读元数据
	metadata, err := probe(ctx, originalPath)
	if err != nil {
		return ProcessResult{}, err
	}
	// 2. 生成输出 key（时间戳随机）
	key := strconv.FormatInt(time.Now().UnixNano(), 36)
	playbackKey := key + "_playback.mp4"
	thumbnailKey := key + "_thumb.jpg"
	playbackPath := filepath.Join(p.StoreDir, playbackKey)
	thumbnailPath := filepath.Join(p.StoreDir, thumbnailKey)
	// 3. ffmpeg 标准化：H.264 + AAC + MP4 + faststart
	if err := transcode(ctx, originalPath, playbackPath); err != nil {
		return ProcessResult{}, err
	}
	// 4. 生成缩略图
	if err := makeThumbnail(ctx, playbackPath, thumbnailPath); err != nil {
		// 缩略图失败不阻塞主链（可降级）
		_ = err
	}
	return ProcessResult{
		PlaybackStorageKey:  playbackKey,
		ThumbnailStorageKey: thumbnailKey,
		Metadata:            metadata,
	}, nil
}

func probe(ctx context.Context, path string) (VideoMetadata, error) {
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "quiet", "-print_format", "json",
		"-show_streams", "-show_format", path)
	out, err := cmd.Output()
	if err != nil {
		return VideoMetadata{}, err
	}
	var info struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &info); err != nil {
		return VideoMetadata{}, err
	}
	meta := VideoMetadata{HasAudio: false}
	for _, stream := range info.Streams {
		if stream.CodecType == "video" {
			meta.Width = stream.Width
			meta.Height = stream.Height
			meta.Codec = stream.CodecName
		}
		if stream.CodecType == "audio" {
			meta.HasAudio = true
		}
	}
	if d, err := strconv.ParseFloat(info.Format.Duration, 64); err == nil {
		meta.DurationMs = int64(d * 1000)
	}
	return meta, nil
}

func transcode(ctx context.Context, input, output string) error {
	// H.264 video + AAC audio + MP4 + faststart（兼容所有播放器）
	args := []string{"-y", "-i", input,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
		"-c:a", "aac", "-b:a", "128k",
		"-movflags", "+faststart",
		"-pix_fmt", "yuv420p",
		output}
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return errors.New("ffmpeg transcode failed: " + clippedOutput(out))
	}
	return nil
}

func makeThumbnail(ctx context.Context, input, output string) error {
	// 第 1 秒缩略图
	args := []string{"-y", "-i", input, "-ss", "1", "-vframes", "1", "-vf", "scale=480:-2", output}
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return errors.New("thumbnail failed: " + clippedOutput(out))
	}
	return nil
}

// clippedOutput 截取 ffmpeg/ffprobe 错误输出前 200 字节。
// 注意：必须在 TrimSpace 之后再按 trim 后长度截断，否则越界 panic。
func clippedOutput(out []byte) string {
	tail := strings.TrimSpace(string(out))
	if len(tail) > 200 {
		tail = tail[:200]
	}
	return tail
}

// isSafeLocalPath 拒绝 ffmpeg 协议输入（http:// / concat: / subfile: / data: 等），
// 避免客户端可控路径变成任意文件读取 / SSRF。
func isSafeLocalPath(path string) bool {
	if strings.Contains(path, "://") {
		return false
	}
	lower := strings.ToLower(path)
	for _, prefix := range []string{"concat:", "subfile:", "data:", "file:", "lavfi:", "color:", "null:"} {
		if strings.HasPrefix(lower, prefix) {
			return false
		}
	}
	return true
}

// probeImage 用 ffprobe 读图片宽高（IMAGE 资产提供 aspect_ratio）。
func probeImage(ctx context.Context, path string) (VideoMetadata, error) {
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "quiet", "-print_format", "json",
		"-show_streams", path)
	out, err := cmd.Output()
	if err != nil {
		return VideoMetadata{}, err
	}
	var info struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &info); err != nil {
		return VideoMetadata{}, err
	}
	meta := VideoMetadata{}
	for _, stream := range info.Streams {
		if stream.CodecType == "video" {
			meta.Width = stream.Width
			meta.Height = stream.Height
			break
		}
	}
	return meta, nil
}

// ---------- helpers ----------

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return false
	}
	return true
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
