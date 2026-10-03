package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func init() { checks["feed-media-urls"] = feedMediaURLs }

// MEDIA-FILE-001, second line of defence. cmd/media-audit --check-files proves
// READY objects have bytes behind them; this proves every URL the feed actually
// hands out can be fetched. They are not the same claim: the read model can be
// wrong, a route can move, auth can block one path.
//
// 2026-09-12 escape: 20 of 25 image URLs in the feed 404'd, and the client
// rendered each failure as a black frame — "every post with pictures is black".
//
// SKIP (exit 0) when the API is not reachable: the gate distinguishes "this
// machine has no running API" from "the URLs are broken".
func feedMediaURLs(root string, _ []string) error {
	base := os.Getenv("PROXY_API_BASE_URL")
	if base == "" {
		base = "http://127.0.0.1:4100"
	}
	client := &http.Client{Timeout: 10 * time.Second}

	var feed struct {
		Posts []json.RawMessage          `json:"posts"`
		Media map[string]json.RawMessage `json:"media"`
	}
	if err := getJSON(client, base+"/v1/feed?limit=50", &feed); err != nil {
		fmt.Printf("SKIP: cannot reach %s (%v)\n", base, err)
		return nil
	}

	var urls []string
	for _, entry := range feed.Media {
		for _, item := range jsonValues(entry) {
			for _, value := range item {
				if text, ok := value.(string); ok && strings.HasPrefix(text, "/v1/") {
					urls = append(urls, text)
				}
			}
		}
	}
	if len(urls) == 0 {
		fmt.Printf("SKIP: feed returned %d posts but no media URLs to probe\n", len(feed.Posts))
		return nil
	}

	// AI persona photos are static files served from a repo path, so they never
	// appear in media.media_variants and the sweep above cannot see them. They
	// 404ed in the normal dev loop because the API resolves them relative to the
	// repo root while launched from apps/api-go — probe them explicitly.
	type persona struct {
		ID string `json:"id"`
	}
	var assistants []persona
	var personaResponse struct {
		Assistants []persona `json:"assistants"`
	}
	if err := getJSON(client, base+"/v1/ai/assistants", &personaResponse); err == nil {
		assistants = personaResponse.Assistants
	}
	for _, assistant := range assistants {
		if assistant.ID != "" {
			urls = append(urls, "/v1/ai/personas/photo/"+assistant.ID)
		}
	}

	var failed []string
	for _, url := range urls {
		response, err := client.Get(base + url)
		if err != nil {
			failed = append(failed, fmt.Sprintf("error %s", url))
			continue
		}
		if response.StatusCode >= 400 {
			failed = append(failed, fmt.Sprintf("%d %s", response.StatusCode, url))
		}
		response.Body.Close()
	}

	fmt.Printf("feed media URLs: posts=%d assistants=%d urls=%d failed=%d\n",
		len(feed.Posts), len(assistants), len(urls), len(failed))
	if len(failed) > 0 {
		shown := failed
		if len(shown) > 20 {
			shown = shown[:20]
		}
		return fmt.Errorf("FAIL: feed advertises media URLs that do not resolve:\n%s\n      A 404 renders as a black frame on the client.\n      See docs/development/MEDIA_STORE_CONSISTENCY.md",
			prefixEach(shown))
	}
	return nil
}

func getJSON(client *http.Client, url string, target any) error {
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, target)
}

// jsonValues flattens one media entry into a list of objects, accepting both the
// array form and the single-object form the wire uses.
func jsonValues(entry json.RawMessage) []map[string]any {
	var list []json.RawMessage
	if err := json.Unmarshal(entry, &list); err == nil {
		var out []map[string]any
		for _, raw := range list {
			var object map[string]any
			if err := json.Unmarshal(raw, &object); err == nil {
				out = append(out, object)
			}
		}
		return out
	}
	var object map[string]any
	if err := json.Unmarshal(entry, &object); err == nil {
		return []map[string]any{object}
	}
	return nil
}
