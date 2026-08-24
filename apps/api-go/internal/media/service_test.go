package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

type failingProcessor struct{ calls int }

func (p *failingProcessor) Process(context.Context, string) (ProcessResult, error) {
	p.calls++
	return ProcessResult{}, errors.New("transcoder unavailable")
}

func TestSaveUploadPersistsOnlyOwnersBytes(t *testing.T) {
	dir := t.TempDir()
	s := New()
	s.SetStoreDir(dir)
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "mobile_photo.jpg", "mimeType": "image/jpeg",
	}, ""))
	var created struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)

	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "another_principal", bytes.NewBufferString("image"), 20); err != ErrMediaNotOwner {
		t.Fatalf("non-owner upload: %v", err)
	}
	jpeg := []byte{0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9}
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewReader(jpeg), 3); err != ErrUploadTooLarge {
		t.Fatalf("oversized upload: %v", err)
	}
	asset, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewReader(jpeg), 20)
	if err != nil {
		t.Fatalf("owner upload: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "mobile_photo.jpg"))
	if err != nil || !bytes.Equal(data, jpeg) {
		t.Fatalf("saved upload differs: %x, %v", data, err)
	}
	wantHash := sha256.Sum256(jpeg)
	if asset.SourceBytes != int64(len(jpeg)) || asset.ChecksumSHA256 != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("integrity metadata = bytes:%d hash:%s", asset.SourceBytes, asset.ChecksumSHA256)
	}
	if asset.MimeType != "image/jpeg" {
		t.Fatalf("sniffed mime = %s", asset.MimeType)
	}
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewReader(jpeg), 20); err != nil {
		t.Fatalf("same-byte retry must be idempotent: %v", err)
	}
	differentJPEG := []byte{0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9}
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewReader(differentJPEG), 20); err != ErrOriginalImmutable {
		t.Fatalf("different bytes must not overwrite original: %v", err)
	}
}

func TestReadTIFFOrientationAndColorSpace(t *testing.T) {
	tiff := testExifTIFF()

	meta := sourceImageMetadata{}
	readTIFFMetadata(tiff, &meta)
	if meta.Orientation != 6 || meta.ColorSpace != "SRGB" {
		t.Fatalf("metadata orientation=%d color=%s", meta.Orientation, meta.ColorSpace)
	}
}

func testExifTIFF() []byte {
	tiff := make([]byte, 56)
	copy(tiff[:2], "II")
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 2)
	// IFD0 Orientation = 6 (90° clockwise).
	binary.LittleEndian.PutUint16(tiff[10:12], 0x0112)
	binary.LittleEndian.PutUint16(tiff[12:14], 3)
	binary.LittleEndian.PutUint32(tiff[14:18], 1)
	binary.LittleEndian.PutUint16(tiff[18:20], 6)
	// Exif IFD pointer = 38.
	binary.LittleEndian.PutUint16(tiff[22:24], 0x8769)
	binary.LittleEndian.PutUint16(tiff[24:26], 4)
	binary.LittleEndian.PutUint32(tiff[26:30], 1)
	binary.LittleEndian.PutUint32(tiff[30:34], 38)
	binary.LittleEndian.PutUint16(tiff[38:40], 1)
	binary.LittleEndian.PutUint16(tiff[40:42], 0xa001)
	binary.LittleEndian.PutUint16(tiff[42:44], 3)
	binary.LittleEndian.PutUint32(tiff[44:48], 1)
	binary.LittleEndian.PutUint16(tiff[48:50], 1)

	return tiff
}

func TestSaveUploadPersistsImageOrientationAndColorSpace(t *testing.T) {
	dir := t.TempDir()
	s := New()
	s.SetStoreDir(dir)
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "portrait.jpg", "mimeType": "image/jpeg",
	}, ""))
	var created struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)
	payload := append([]byte("Exif\x00\x00"), testExifTIFF()...)
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	jpeg = append(jpeg, payload...)
	jpeg = append(jpeg, 0xff, 0xd9)
	asset, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewReader(jpeg), 1024)
	if err != nil {
		t.Fatalf("save exif portrait: %v", err)
	}
	if asset.Orientation != 6 || asset.ColorSpace != "SRGB" {
		t.Fatalf("persisted metadata: orientation=%d color=%s", asset.Orientation, asset.ColorSpace)
	}
}

func TestReadPNGDimensionsAlphaAndSRGB(t *testing.T) {
	pngHeader := make([]byte, 45)
	copy(pngHeader[:8], "\x89PNG\r\n\x1a\n")
	binary.BigEndian.PutUint32(pngHeader[8:12], 13)
	copy(pngHeader[12:16], "IHDR")
	binary.BigEndian.PutUint32(pngHeader[16:20], 1080)
	binary.BigEndian.PutUint32(pngHeader[20:24], 1920)
	pngHeader[24] = 8
	pngHeader[25] = 6 // RGBA
	binary.BigEndian.PutUint32(pngHeader[33:37], 0)
	copy(pngHeader[37:41], "sRGB")
	meta := sourceImageMetadata{}
	readPNGMetadata(pngHeader, &meta)
	if meta.Width != 1080 || meta.Height != 1920 || !meta.HasAlpha || meta.ColorSpace != "SRGB" {
		t.Fatalf("png metadata: %+v", meta)
	}
}

func TestSaveUploadRejectsDeclaredImageWithHTMLBytes(t *testing.T) {
	s := New()
	s.SetStoreDir(t.TempDir())
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "spoofed.jpg", "mimeType": "image/jpeg",
	}, ""))
	var created struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewBufferString("<html>not an image</html>"), 1024); err != ErrMediaTypeMismatch {
		t.Fatalf("spoofed image must be rejected: %v", err)
	}
}

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:         command.Target{Type: "MediaAsset", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func createVideoAsset(t *testing.T, s *Service) string {
	t.Helper()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "VIDEO", "originalStorageKey": "uploads/test_video.mp4", "mimeType": "video/mp4",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
		Status       string `json:"status"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Status != "UPLOADING" {
		t.Fatalf("want UPLOADING, got %s", view.Status)
	}
	return view.MediaAssetID
}

// 状态机：UPLOADING → PROCESSING → READY；只有 READY 可播。
func TestMediaLifecycleAndPlayability(t *testing.T) {
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	id := createVideoAsset(t, s)

	// UPLOADING 不可播
	r := s.Handle(envelopeFor("GetMediaAsset", map[string]any{"mediaAssetId": id}, id))
	var view struct {
		Playable bool `json:"playable"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.Playable {
		t.Fatal("UPLOADING must not be playable")
	}

	// CompleteUpload → PROCESSING
	r = s.Handle(envelopeFor("CompleteMediaUpload", map[string]any{"originalStorageKey": "uploads/test_video.mp4"}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "PROCESSING" {
		t.Fatalf("complete upload: %s/%s", r.Outcome, r.Aggregate.State)
	}

	// Process command only confirms the durable job; expensive work is off-request.
	r = s.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": "/tmp/nonexist.mp4"}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "PROCESSING" {
		t.Fatalf("process: %s/%s (%+v)", r.Outcome, r.Aggregate.State, r.Error)
	}
	worker := Worker{Repository: repository, Service: s, WorkerID: "test-worker"}
	if processed, err := worker.RunOnce(t.Context()); err != nil || processed != 1 {
		t.Fatalf("worker: processed=%d err=%v", processed, err)
	}

	// READY 可播
	r = s.Handle(envelopeFor("GetMediaAsset", map[string]any{"mediaAssetId": id}, id))
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if !view.Playable {
		t.Fatal("READY must be playable")
	}
}

func TestProcessingRunsOnlyInWorkerAndDeadLettersAfterRetries(t *testing.T) {
	repository := NewMemoryRepository()
	processor := &failingProcessor{}
	service := NewWithDependencies(repository, processor)
	id := createVideoAsset(t, service)
	result := service.Handle(envelopeFor("CompleteMediaUpload", map[string]any{"originalStorageKey": "uploads/test_video.mp4"}, id))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("complete: %+v", result.Error)
	}
	result = service.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": "/tmp/ignored.mp4"}, id))
	if result.Aggregate.State != "PROCESSING" || processor.calls != 0 {
		t.Fatalf("API request ran processor: state=%s calls=%d", result.Aggregate.State, processor.calls)
	}
	now := time.Now().UTC().Add(time.Second)
	worker := Worker{Repository: repository, Service: service, WorkerID: "worker-a", MaxAttempts: 2, Clock: func() time.Time { return now }}
	if processed, err := worker.RunOnce(t.Context()); err != nil || processed != 0 || processor.calls != 1 {
		t.Fatalf("first attempt: processed=%d calls=%d err=%v", processed, processor.calls, err)
	}
	asset, _ := repository.GetAsset(t.Context(), id)
	if asset.ProcessingStatus != "PROCESSING" {
		t.Fatalf("transient failure must remain retryable, got %s", asset.ProcessingStatus)
	}
	now = now.Add(2 * time.Second)
	if processed, err := worker.RunOnce(t.Context()); err != nil || processed != 0 || processor.calls != 2 {
		t.Fatalf("second attempt: processed=%d calls=%d err=%v", processed, processor.calls, err)
	}
	asset, _ = repository.GetAsset(t.Context(), id)
	if asset.ProcessingStatus != "FAILED" {
		t.Fatalf("dead letter must surface FAILED, got %s", asset.ProcessingStatus)
	}
}

// 非法状态迁移：UPLOADING 直接 Process → 拒绝。
func TestCannotProcessBeforeUploadComplete(t *testing.T) {
	s := New()
	id := createVideoAsset(t, s)
	r := s.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": "/tmp/x.mp4"}, id))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "MEDIA_NOT_PROCESSING" {
		t.Fatalf("want MEDIA_NOT_PROCESSING, got %s/%+v", r.Outcome, r.Error)
	}
}

// 图片：直接 READY（无转码）。
func TestImageGoesReadyDirectly(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	repository := NewMemoryRepository()
	s := NewWithDependencies(repository, nil)
	s.SetStoreDir(dir)
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "photo.jpg", "mimeType": "image/jpeg",
	}, ""))
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	id := view.MediaAssetID
	var encoded bytes.Buffer
	portrait := image.NewRGBA(image.Rect(0, 0, 80, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 80; x++ {
			portrait.Set(x, y, color.RGBA{R: uint8(x * 3), G: uint8(y * 2), B: 120, A: 255})
		}
	}
	if err := jpeg.Encode(&encoded, portrait, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveUpload(t.Context(), id, "business_001", bytes.NewReader(encoded.Bytes()), 1<<20); err != nil {
		t.Fatalf("save image: %v", err)
	}
	r = s.Handle(envelopeFor("CompleteMediaUpload", map[string]any{"originalStorageKey": "photo.jpg"}, id))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("complete: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": ""}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "PROCESSING" {
		t.Fatalf("image process: %s/%s", r.Outcome, r.Aggregate.State)
	}
	worker := Worker{Repository: repository, Service: s, WorkerID: "test-worker"}
	if processed, err := worker.RunOnce(t.Context()); err != nil || processed != 1 {
		t.Fatalf("image worker: processed=%d err=%v", processed, err)
	}
	variants, err := s.ListReadyVariants(t.Context(), id)
	if err != nil || len(variants) != 6 {
		t.Fatalf("want ORIGINAL + 5 derivatives, got %d: %v", len(variants), err)
	}
	for _, variant := range variants {
		if _, err := os.Stat(filepath.Join(dir, variant.StorageKey)); err != nil {
			t.Fatalf("variant %s missing: %v", variant.Purpose, err)
		}
		if variant.Purpose == "SHARE_OG" && (variant.Width != 1200 || variant.Height != 630) {
			t.Fatalf("share OG dimensions = %dx%d", variant.Width, variant.Height)
		}
		if variant.Purpose == "GALLERY" && (variant.Width > 80 || variant.Height > 120) {
			t.Fatalf("gallery must not upscale small originals: %dx%d", variant.Width, variant.Height)
		}
		if variant.Purpose == "ORIGINAL" {
			if _, err := s.ResolveVariantPath(t.Context(), variant.MediaVariantID); err == nil {
				t.Fatal("ORIGINAL must not be exposed by the public variant route")
			}
		}
	}
	lookup := NewPostMediaLookup(s)
	read, err := lookup.LookupMediaAssets(t.Context(), []string{id})
	if err != nil {
		t.Fatal(err)
	}
	mediaInfo := read[id]
	if mediaInfo.FeedURL == "" || mediaInfo.Feed2xURL == "" || mediaInfo.GalleryURL == "" || mediaInfo.PlaceholderURL == "" || !mediaInfo.OriginalAvailable {
		t.Fatalf("purpose URLs not hydrated: %+v", mediaInfo)
	}
	if path, err := s.ResolveVariantPath(t.Context(), strings.TrimPrefix(mediaInfo.GalleryURL, "/v1/media/variant/")); err != nil || path == "" {
		t.Fatalf("gallery variant route unresolved: %s %v", path, err)
	}
}

// FFmpeg 真实处理链：生成测试视频 → transcode → 验证输出（需本机 ffmpeg）。
func TestFFmpegProcessorRealTranscode(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "src.mp4")
	// 生成 2 秒测试视频（testsrc + sine）
	gen := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:v", "libx264", "-c:a", "aac", "-shortest", src)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("cannot generate test video: %v %s", err, string(out))
	}
	store := filepath.Join(dir, "store")
	p := NewFFmpegProcessor(store)
	result, err := p.Process(t.Context(), src)
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	if result.Metadata.DurationMs < 1500 || result.Metadata.DurationMs > 3000 {
		t.Fatalf("duration out of range: %d", result.Metadata.DurationMs)
	}
	if result.Metadata.Width != 320 || result.Metadata.Height != 240 {
		t.Fatalf("resolution: %dx%d", result.Metadata.Width, result.Metadata.Height)
	}
	if result.Metadata.Codec == "" {
		t.Fatal("codec should be detected")
	}
	playback := filepath.Join(store, result.PlaybackStorageKey)
	if _, err := os.Stat(playback); err != nil {
		t.Fatalf("playback file missing: %v", err)
	}
	// 验证输出是 H.264（ffprobe）
	probeCmd := exec.Command("ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", playback)
	out, _ := probeCmd.Output()
	var info struct {
		Streams []struct {
			CodecName string `json:"codec_name"`
			CodecType string `json:"codec_type"`
		} `json:"streams"`
	}
	_ = json.Unmarshal(out, &info)
	hasH264, hasAAC := false, false
	for _, st := range info.Streams {
		if st.CodecType == "video" && st.CodecName == "h264" {
			hasH264 = true
		}
		if st.CodecType == "audio" && st.CodecName == "aac" {
			hasAAC = true
		}
	}
	if !hasH264 {
		t.Fatal("output must be H.264")
	}
	if !hasAAC {
		t.Fatal("output must be AAC")
	}
}
