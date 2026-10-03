package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// socialSmoke is the port of scripts/smoke-social-media.mjs: the one check that walks
// the whole image-post path against a live API — anonymous session, CreateMediaAsset,
// chunked PUT upload, CompleteMediaUpload, ProcessMediaAsset, waiting for READY,
// CreatePost with a media ref, ListFeedPosts hydration, and finally fetching the
// rendered feed URL.
//
// It exists because every layer below it can be green while the wire is broken: unit
// tests pass with a memory repository, the SQL read model passes with rows written by
// seed, and neither of those proves that an upload becomes a picture in someone's
// feed. The assertion that matters is the last one — the browser-visible URL actually
// returns non-empty bytes.
//
// It creates a real post and a real media asset under a throwaway anonymous session.
// That is deliberate: the path under test is the write path, and there is no
// read-only version of it. Nothing here deletes anything afterwards (AGENTS.md: no
// code-side deletes of business data) — the rows stay as evidence and are prefixed
// smoke_ so they are identifiable.
const smokeActorID = "social_media_smoke"

// smokeFixture is the picture uploaded. 900x1600 matches the width/height sent to
// CreateMediaAsset; changing one without the other makes the aspect-ratio check the
// read model does disagree with the upload, which is a different failure than the one
// this script is for.
const smokeFixture = "architecture/fixtures/social-media/matrix/single-portrait-full-9x16.jpg"

type socialSmoke struct {
	base   string
	client *http.Client
	seq    int
}

func runSocialSmoke(ctx context.Context, out io.Writer) error {
	s := &socialSmoke{
		base: apiBase(),
		// Proxy: nil is the Go equivalent of curl --noproxy '*' — a dev API on
		// 127.0.0.1 must never be handed to an inherited HTTP proxy.
		client: &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{Proxy: nil}},
	}
	fmt.Fprintf(out, "=== social media smoke · %s ===\n", s.base)

	image, err := readSmokeFixture()
	if err != nil {
		return err
	}

	credential := sha256.Sum256([]byte(s.id("credential")))
	anonymous, err := s.command(ctx, "CreateAnonymousSession",
		map[string]any{"type": "Session", "id": "new"},
		map[string]any{
			"deviceId":         s.id("device"),
			"platform":         "IOS",
			"deviceCredential": hex.EncodeToString(credential[:]),
			"dateOfBirth":      "1990-01-01",
			"consents":         map[string]any{"terms": true, "privacy": true},
			"legalDocVersion":  "1.1",
		}, nil)
	if err != nil {
		return fmt.Errorf("CreateAnonymousSession: %w", err)
	}
	auth, _ := anonymous["auth"].(map[string]any)
	token, _ := auth["accessToken"].(string)
	if token == "" {
		return fmt.Errorf("anonymous auth token missing: %s", jsonLine(anonymous))
	}

	storageKey := s.id("image") + ".jpg"
	created, err := s.command(ctx, "CreateMediaAsset",
		map[string]any{"type": "MediaAsset", "id": "new"},
		map[string]any{
			"mediaType":          "IMAGE",
			"originalStorageKey": storageKey,
			"mimeType":           "image/jpeg",
			"width":              900,
			"height":             1600,
		}, auth)
	if err != nil {
		return fmt.Errorf("CreateMediaAsset: %w", err)
	}
	operation := parseOperationRef(created)
	mediaAssetID, _ := operation["mediaAssetId"].(string)
	uploadURL, _ := operation["uploadUrl"].(string)
	if mediaAssetID == "" || uploadURL == "" {
		return fmt.Errorf("CreateMediaAsset gave no upload target: %s", jsonLine(operation))
	}

	digest := sha256.Sum256(image)
	uploadReq, err := http.NewRequestWithContext(ctx, http.MethodPut, s.base+uploadURL, bytes.NewReader(image))
	if err != nil {
		return fmt.Errorf("build upload request: %w", err)
	}
	uploadReq.Header.Set("Authorization", "Bearer "+token)
	uploadReq.Header.Set("Content-Type", "image/jpeg")
	uploadReq.Header.Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(image)-1, len(image)))
	uploadReq.Header.Set("X-Chunk-SHA256", hex.EncodeToString(digest[:]))
	uploadResp, err := s.client.Do(uploadReq)
	if err != nil {
		return fmt.Errorf("upload to %s: %w", uploadURL, err)
	}
	uploadBody, _ := io.ReadAll(uploadResp.Body)
	uploadResp.Body.Close()
	if uploadResp.StatusCode < 200 || uploadResp.StatusCode >= 300 {
		return fmt.Errorf("upload %d: %s", uploadResp.StatusCode, snippet(string(uploadBody)))
	}

	if _, err := s.command(ctx, "CompleteMediaUpload",
		map[string]any{"type": "MediaAsset", "id": mediaAssetID},
		map[string]any{"originalStorageKey": storageKey}, auth); err != nil {
		return fmt.Errorf("CompleteMediaUpload: %w", err)
	}
	if _, err := s.command(ctx, "ProcessMediaAsset",
		map[string]any{"type": "MediaAsset", "id": mediaAssetID},
		map[string]any{"originalPath": ""}, auth); err != nil {
		return fmt.Errorf("ProcessMediaAsset: %w", err)
	}

	// READY is produced by the worker, not by the API request, so this loop is where a
	// worker that is not running (or that does not share the API's repository) shows up.
	//
	// The Node version polled 60×250ms = 15s, which was tuned for a worker in the same
	// process. Against a containerised worker the derivation is 5 ffmpeg passes plus a
	// watermark and a composition analysis, and 15s reported "stuck at PROCESSING" for a
	// job that then succeeded — a false red. 240×500ms = 2min, and FAILED short-circuits
	// below so a genuinely broken pipeline still reports fast.
	lastStatus := "unknown"
	ready := false
	for attempt := 0; attempt < 240; attempt++ {
		result, err := s.command(ctx, "GetMediaAsset",
			map[string]any{"type": "MediaAsset", "id": mediaAssetID},
			map[string]any{"mediaAssetId": mediaAssetID}, auth)
		if err != nil {
			return fmt.Errorf("GetMediaAsset: %w", err)
		}
		asset, _ := parseOperationRef(result)["asset"].(map[string]any)
		if status, _ := asset["processingStatus"].(string); status != "" {
			lastStatus = status
		}
		switch lastStatus {
		case "READY":
			ready = true
		case "FAILED":
			// A dead-lettered job says why in media.processing_jobs.last_error — the
			// status alone would send the reader to the wrong place (this is how the
			// ffmpeg `-autorotate` bug got blamed on the uploader).
			return fmt.Errorf("media processing FAILED (asset %s): 读 media.processing_jobs.last_error / last_status，那里有 worker 记下的真因", mediaAssetID)
		}
		if ready {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	if !ready {
		return fmt.Errorf("media did not become READY (stuck at %s; the worker must drain the processing queue — with MemoryRepository the worker has to share the API process)", lastStatus)
	}

	// POST-PROFILE-GATE-001: a USER cannot publish until the profile has a name and a
	// deliverable avatar (`assets/<mediaAssetId>`), so the smoke has to satisfy the same
	// precondition a real user goes through. It used to post straight away and 409 with
	// PROFILE_INCOMPLETE missing:["name","avatar"] — invisible for as long as no worker
	// turned the upload READY, which was the case on every dev machine.
	//
	// handle must be sent too: identity.profiles' upsert is a full overwrite
	// (name=EXCLUDED.name, handle=EXCLUDED.handle, …), so omitting it would blank it.
	// The profile belongs to whoever the token authenticates as — the command reads
	// e.Actor.ID, not an id from the payload, so the aggregate ref here is "self".
	const smokeDisplayName = "Smoke Tester"
	smokeHandle := "smoke" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	if _, err := s.command(ctx, "UpdateProfile",
		map[string]any{"type": "Profile", "id": "self"},
		map[string]any{
			"name":       smokeDisplayName,
			"handle":     smokeHandle,
			"city":       "Hà Nội",
			"avatarPath": "assets/" + mediaAssetID,
		}, auth); err != nil {
		return fmt.Errorf("UpdateProfile: %w", err)
	}

	post, err := s.command(ctx, "CreatePost",
		map[string]any{"type": "Post", "id": "new"},
		map[string]any{
			"authorType":        "USER",
			"authorDisplayName": smokeDisplayName,
			"body":              "图文发布端到端验证",
			"mediaRefs":         []any{map[string]any{"mediaAssetId": mediaAssetID, "sortOrder": 0}},
			"visibility":        "PUBLIC",
			"cityScope":         "hn",
		}, auth)
	if err != nil {
		return fmt.Errorf("CreatePost: %w", err)
	}
	aggregate, _ := post["aggregate"].(map[string]any)
	postID, _ := aggregate["id"].(string)
	if postID == "" {
		return fmt.Errorf("CreatePost returned no aggregate id: %s", jsonLine(post))
	}

	feed, err := s.command(ctx, "ListFeedPosts",
		map[string]any{"type": "Feed", "id": "local"}, map[string]any{}, auth)
	if err != nil {
		return fmt.Errorf("ListFeedPosts: %w", err)
	}
	read := parseOperationRef(feed)
	if !feedHasPost(read, postID) {
		return fmt.Errorf("feed hydration failed for %s", postID)
	}
	media := hydrateMedia(read, postID)
	if len(media) != 1 {
		return fmt.Errorf("feed hydration failed for %s (media items: %d)", postID, len(media))
	}
	feedURL, _ := media[0]["feedUrl"].(string)
	if feedURL == "" {
		return fmt.Errorf("hydrated media carries no feedUrl: %s", jsonLine(media[0]))
	}

	body, status, err := s.fetch(ctx, feedURL)
	if err != nil {
		return fmt.Errorf("GET %s: %w", feedURL, err)
	}
	if status < 200 || status >= 300 || len(body) == 0 {
		return fmt.Errorf("feed image file is unavailable (status %d, %d bytes)", status, len(body))
	}

	// One malformed media item must not erase the whole feed, so the hydration checks
	// above are separate from the byte check: "the list is right" and "the file is
	// served" fail differently and the messages must not collapse into each other.
	// A struct keeps the field order the Node version printed (map marshalling would
	// sort it, and this line is read by eye when a media pipeline breaks).
	result := struct {
		OK               bool   `json:"ok"`
		PostID           string `json:"postId"`
		MediaAssetID     string `json:"mediaAssetId"`
		MediaCount       int    `json:"mediaCount"`
		ProcessingStatus any    `json:"processingStatus"`
		ModerationStatus any    `json:"moderationStatus"`
		UploadedBytes    int    `json:"uploadedBytes"`
		ServedBytes      int    `json:"servedBytes"`
	}{true, postID, mediaAssetID, len(media), media[0]["processingStatus"], media[0]["moderationStatus"], len(image), len(body)}
	encoded, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode result: %w", err)
	}
	fmt.Fprintf(out, "%s\n", encoded)
	return nil
}

func (s *socialSmoke) id(prefix string) string {
	s.seq++
	return fmt.Sprintf("smoke_%s_%s_%d", prefix, time.Now().UTC().Format("20060102150405.000"), s.seq)
}

func (s *socialSmoke) command(ctx context.Context, commandType string, target, payload, auth map[string]any) (map[string]any, error) {
	envelope := map[string]any{
		"commandId":      s.id("command"),
		"commandType":    commandType,
		"commandVersion": 1,
		"target":         target,
		"idempotencyKey": s.id("idem"),
		"purpose":        "social_media_e2e_smoke",
		"correlationId":  s.id("correlation"),
		"requestedAt":    time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"payload":        payload,
	}
	switch {
	case auth != nil:
		envelope["actor"] = map[string]any{"type": "USER", "id": auth["userAccountId"]}
		if principal, ok := auth["principal"]; ok && principal != nil {
			envelope["principal"] = principal
		} else {
			envelope["principal"] = map[string]any{"type": "INDIVIDUAL", "id": smokeActorID}
		}
		envelope["authContext"] = map[string]any{"sessionId": auth["sessionId"]}
	default:
		envelope["actor"] = map[string]any{"type": "USER", "id": smokeActorID}
		envelope["principal"] = map[string]any{"type": "INDIVIDUAL", "id": smokeActorID}
		envelope["authContext"] = map[string]any{}
	}

	encoded, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("encode envelope: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/v1/commands/%s", s.base, commandType), strings.NewReader(string(encoded)))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token, _ := auth["accessToken"].(string); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", commandType, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s: read body: %w", commandType, err)
	}
	// The status code is read from the response, never guessed out of the body — the
	// bug the Node-era scripts kept hitting was scraping a number that looked like one.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s %d: %s", commandType, resp.StatusCode, snippet(string(raw)))
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("%s: decode response: %w", commandType, err)
	}
	if outcome, _ := result["outcome"].(string); outcome == "REJECTED" {
		return nil, fmt.Errorf("%s rejected: %s", commandType, jsonLine(result))
	}
	return result, nil
}

func (s *socialSmoke) fetch(ctx context.Context, path string) ([]byte, int, error) {
	url := path
	if strings.HasPrefix(path, "/") {
		url = s.base + path
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func readSmokeFixture() ([]byte, error) {
	// go -C apps/api-go run ./cmd/devdata changes the process cwd, so the fixture is
	// resolved against the repo root as well as the cwd.
	for _, candidate := range []string{
		filepath.Join(repoRoot(), smokeFixture),
		smokeFixture,
		filepath.Join("..", smokeFixture),
	} {
		body, err := os.ReadFile(candidate)
		if err == nil {
			return body, nil
		}
	}
	return nil, fmt.Errorf("读不到上传用的图片 %s —— 端到端冒烟必须有真实字节", smokeFixture)
}

func parseOperationRef(result map[string]any) map[string]any {
	ref, _ := result["operationRef"].(string)
	var decoded map[string]any
	if ref == "" || json.Unmarshal([]byte(ref), &decoded) != nil {
		return map[string]any{}
	}
	return decoded
}

func feedHasPost(read map[string]any, postID string) bool {
	posts, _ := read["posts"].([]any)
	for _, item := range posts {
		post, _ := item.(map[string]any)
		if id, _ := post["postId"].(string); id == postID {
			return true
		}
	}
	return false
}

// hydrateMedia reads the sidecar map the feed read returns: media is keyed by post id,
// so a post that rendered without its media shows up as an empty slice here rather than
// silently dropping off the feed list.
func hydrateMedia(read map[string]any, postID string) []map[string]any {
	media, _ := read["media"].(map[string]any)
	items, _ := media[postID].([]any)
	decoded := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if entry, _ := item.(map[string]any); entry != nil {
			decoded = append(decoded, entry)
		}
	}
	return decoded
}

func jsonLine(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return snippet(string(encoded))
}

func snippet(text string) string {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) > 400 {
		return trimmed[:400] + "…"
	}
	return trimmed
}

func apiBase() string {
	for _, name := range []string{"PROXY_API_BASE_URL", "PROXY_API_BASE"} {
		if value := os.Getenv(name); value != "" {
			return strings.TrimRight(value, "/")
		}
	}
	return "http://127.0.0.1:4100"
}
