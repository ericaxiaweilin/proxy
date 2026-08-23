package media

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

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
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewBufferString("too-large"), 3); err != ErrUploadTooLarge {
		t.Fatalf("oversized upload: %v", err)
	}
	if _, err := s.SaveUpload(t.Context(), created.MediaAssetID, "business_001", bytes.NewBufferString("image"), 20); err != nil {
		t.Fatalf("owner upload: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "mobile_photo.jpg"))
	if err != nil || string(data) != "image" {
		t.Fatalf("saved upload: %q, %v", string(data), err)
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
	s := New()
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

	// Process → READY（无 processor，模拟成功）
	r = s.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": "/tmp/nonexist.mp4"}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "READY" {
		t.Fatalf("process: %s/%s (%+v)", r.Outcome, r.Aggregate.State, r.Error)
	}
	var readyView struct {
		PlaybackURL string `json:"playbackUrl"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &readyView)
	if readyView.PlaybackURL == "" {
		t.Fatal("READY must have playback url")
	}

	// READY 可播
	r = s.Handle(envelopeFor("GetMediaAsset", map[string]any{"mediaAssetId": id}, id))
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if !view.Playable {
		t.Fatal("READY must be playable")
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
	s := New()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "uploads/photo.jpg", "mimeType": "image/jpeg",
	}, ""))
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	id := view.MediaAssetID
	r = s.Handle(envelopeFor("CompleteMediaUpload", map[string]any{"originalStorageKey": "uploads/photo.jpg"}, id))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("complete: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("ProcessMediaAsset", map[string]any{"originalPath": ""}, id))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "READY" {
		t.Fatalf("image process: %s/%s", r.Outcome, r.Aggregate.State)
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
