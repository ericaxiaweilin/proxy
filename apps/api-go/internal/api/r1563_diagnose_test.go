package api

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// R15.63 diagnose: 模拟 iPhone 完整 media 上传 + CreatePost 路径.
// 跟 R15.60 同样 user_001 主体, 但这里走真 PNG bytes → upload chunk →
// CompleteMediaUpload → ProcessMediaAsset → CreatePost 带 mediaRefs.
//
// 输出每一歩 status / aggregate / error, 跟 iPhone logcat 形态一致,
// 用来定位 \"log 卡在最后 chunk\" 后 client 静默失败的真因。
func TestR1563DiagnoseIphonePostWithMedia(t *testing.T) {
	dir := t.TempDir()
	mediaService := media.New()
	mediaService.SetStoreDir(dir)
	server := NewServerWithDependenciesAndAuthenticator(
		identity.New(nil), demand.New(nil, nil), citycompanion.New(),
		localnet.New(), localcontext.New(), conversation.New(),
		engagement.New(), fulfillment.New(), supply.New(),
		mediaService, contribution.New(), nil, nil, stubAuthenticator{},
	)
	handler := server.Handler()

	// 生成 1x1 红 PNG (跟 sim-iphone.sh 同, 模拟 iPhone 选图 → upload)
	pngBuf := func() []byte {
		img := image.NewRGBA(image.Rect(0, 0, 1, 1))
		img.Set(0, 0, color.RGBA{R: 255, A: 255})
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}()
	t.Logf("PNG size: %d bytes", len(pngBuf))

	// ---------- 1. CreateMediaAsset ----------
	storageKey := fmt.Sprintf("iphone-test-%d.png", len(pngBuf))
	cmaResp := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreateMediaAsset",
		apiEnvelope("CreateMediaAsset", map[string]any{
			"mediaType":          "IMAGE",
			"originalStorageKey": storageKey,
			"mimeType":           "image/png",
			"width":              1,
			"height":             1,
		}, command.Target{Type: "MediaAsset", ID: "new"}, "idem_r1563_cma"), "access_test")
	if cmaResp.Code != http.StatusOK {
		t.Fatalf("[1] CreateMediaAsset status=%d body=%s", cmaResp.Code, cmaResp.Body.String())
	}
	var cmaResult command.Result
	if err := jsonDecode(cmaResp.Body.Bytes(), &cmaResult); err != nil {
		t.Fatal(err)
	}
	if cmaResult.Outcome != "ACCEPTED" {
		t.Fatalf("[1] CreateMediaAsset outcome=%s error=%+v", cmaResult.Outcome, cmaResult.Error)
	}
	var cmaOp struct {
		MediaAssetID string `json:"mediaAssetId"`
		UploadURL    string `json:"uploadUrl"`
	}
	if err := jsonDecode([]byte(cmaResult.OperationRef), &cmaOp); err != nil {
		t.Fatal(err)
	}
	t.Logf("[1] CreateMediaAsset OK mediaAssetId=%s uploadUrl=%s state=%s", cmaOp.MediaAssetID, cmaOp.UploadURL, cmaResult.Aggregate.State)

	// ---------- 2. Upload chunk ----------
	chunk := pngBuf
	uploadReq := httptest.NewRequest(http.MethodPut, "/v1/media/upload/"+cmaOp.MediaAssetID, bytes.NewReader(chunk))
	uploadReq.Header.Set("Authorization", "Bearer access_test")
	uploadReq.Header.Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(chunk)-1, len(chunk)))
	uploadReq.Header.Set("X-Chunk-SHA256", fmt.Sprintf("%x", sha256.Sum256(chunk)))
	uploadRec := httptest.NewRecorder()
	handler.ServeHTTP(uploadRec, uploadReq)
	if uploadRec.Code != http.StatusAccepted && uploadRec.Code != http.StatusNoContent {
		t.Fatalf("[2] Upload status=%d body=%s", uploadRec.Code, uploadRec.Body.String())
	}
	t.Logf("[2] Upload OK status=%d upload-offset=%s", uploadRec.Code, uploadRec.Header().Get("Upload-Offset"))

	// ---------- 3. CompleteMediaUpload ----------
	cmuResp := requestWithBearer(handler, http.MethodPost, "/v1/commands/CompleteMediaUpload",
		apiEnvelope("CompleteMediaUpload", map[string]any{
			"originalStorageKey": storageKey,
		}, command.Target{Type: "MediaAsset", ID: cmaOp.MediaAssetID}, "idem_r1563_cmu"), "access_test")
	if cmuResp.Code != http.StatusOK {
		t.Fatalf("[3] CompleteMediaUpload status=%d body=%s", cmuResp.Code, cmuResp.Body.String())
	}
	var cmuResult command.Result
	if err := jsonDecode(cmuResp.Body.Bytes(), &cmuResult); err != nil {
		t.Fatal(err)
	}
	if cmuResult.Outcome != "ACCEPTED" {
		t.Fatalf("[3] CompleteMediaUpload outcome=%s errorCode=%s messageKey=%s state=%s",
			cmuResult.Outcome,
			func() string { if cmuResult.Error != nil { return cmuResult.Error.ErrorCode } ; return "" }(),
			func() string { if cmuResult.Error != nil { return cmuResult.Error.MessageKey } ; return "" }(),
			cmuResult.Aggregate.State)
	}
	t.Logf("[3] CompleteMediaUpload OK state=%s", cmuResult.Aggregate.State)

	// ---------- 4. ProcessMediaAsset ----------
	pmaResp := requestWithBearer(handler, http.MethodPost, "/v1/commands/ProcessMediaAsset",
		apiEnvelope("ProcessMediaAsset", map[string]any{
			"originalPath": "", // dev: 空
		}, command.Target{Type: "MediaAsset", ID: cmaOp.MediaAssetID}, "idem_r1563_pma"), "access_test")
	if pmaResp.Code != http.StatusOK {
		t.Fatalf("[4] ProcessMediaAsset status=%d body=%s", pmaResp.Code, pmaResp.Body.String())
	}
	var pmaResult command.Result
	if err := jsonDecode(pmaResp.Body.Bytes(), &pmaResult); err != nil {
		t.Fatal(err)
	}
	if pmaResult.Outcome != "ACCEPTED" {
		t.Fatalf("[4] ProcessMediaAsset outcome=%s errorCode=%s messageKey=%s",
			pmaResult.Outcome,
			func() string { if pmaResult.Error != nil { return pmaResult.Error.ErrorCode } ; return "" }(),
			func() string { if pmaResult.Error != nil { return pmaResult.Error.MessageKey } ; return "" }())
	}
	t.Logf("[4] ProcessMediaAsset OK state=%s", pmaResult.Aggregate.State)

	// ---------- 5. CreatePost 带 mediaRefs ----------
	cpResp := requestWithBearer(handler, http.MethodPost, "/v1/commands/CreatePost",
		apiEnvelope("CreatePost", map[string]any{
			"authorType":        "USER",
			"authorDisplayName": "你",
			"body":              "R15.63 diagnose test",
			"visibility":        "PUBLIC",
			"mediaRefs": []map[string]any{
				{"mediaAssetId": cmaOp.MediaAssetID, "sortOrder": 0},
			},
		}, command.Target{Type: "Post", ID: "new"}, "idem_r1563_cp"), "access_test")
	if cpResp.Code != http.StatusOK {
		t.Fatalf("[5] CreatePost status=%d body=%s", cpResp.Code, cpResp.Body.String())
	}
	var cpResult command.Result
	if err := jsonDecode(cpResp.Body.Bytes(), &cpResult); err != nil {
		t.Fatal(err)
	}
	if cpResult.Outcome != "ACCEPTED" {
		t.Fatalf("[5] CreatePost outcome=%s errorCode=%s messageKey=%s errorCategory=%s",
			cpResult.Outcome,
			func() string { if cpResult.Error != nil { return cpResult.Error.ErrorCode } ; return "" }(),
			func() string { if cpResult.Error != nil { return cpResult.Error.MessageKey } ; return "" }(),
			func() string { if cpResult.Error != nil { return cpResult.Error.Category } ; return "" }())
	}
	t.Logf("[5] CreatePost OK postId=%s state=%s", cpResult.Aggregate.ID, cpResult.Aggregate.State)
}

// jsonDecode 别名 (避免 import json 重名)
func jsonDecode(b []byte, v any) error {
	return jsonUnmarshal(b, v)
}
