package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

type realitySceneRecord struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Area        string  `json:"area"`
	Type        string  `json:"type"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Quality     int     `json:"quality"`
	Best        string  `json:"best"`
	Posts       int     `json:"posts"`
	Creators    int     `json:"creators"`
	Activities  int     `json:"activities"`
	Invites     int     `json:"invites"`
	Active      bool    `json:"active"`
	Description string  `json:"description"`
}

// Server-owned launch catalog from the approved R15.16 Reality Layer design.
// It deliberately lives outside the mobile package; a PostgreSQL projection can
// replace this source without changing the public response contract.
var realitySceneLaunchCatalog = []realitySceneRecord{
	{ID: "trucbach", Name: "Trúc Bạch 湖边", Area: "Ba Đình", Type: "湖边 · 夜景", Latitude: 21.0454, Longitude: 105.8361, Quality: 93, Best: "17:20–19:10", Posts: 86, Creators: 31, Activities: 8, Invites: 22, Active: true, Description: "湖边步行、夜景与小型聚会密度高。第一次去的内容产出率明显高于复访。"},
	{ID: "westlake", Name: "West Lake Sunset Loop", Area: "Tây Hồ", Type: "骑行 · 日落", Latitude: 21.0669, Longitude: 105.8192, Quality: 96, Best: "16:30–18:40", Posts: 214, Creators: 72, Activities: 21, Invites: 48, Description: "高复访路线。适合骑行、散步和摄影，不同季节仍有新的场景价值。"},
	{ID: "phunghung", Name: "Phùng Hưng Mural Street", Area: "Hoàn Kiếm", Type: "街区 · 摄影", Latitude: 21.034, Longitude: 105.8442, Quality: 88, Best: "08:00–10:30", Posts: 102, Creators: 45, Activities: 4, Invites: 13, Description: "第一次探索价值高，适合街拍、壁画和老城主题内容。"},
	{ID: "train", Name: "Hanoi Train Street", Area: "Hoàn Kiếm", Type: "街区 · 体验", Latitude: 21.0292, Longitude: 105.8426, Quality: 84, Best: "15:00–17:30", Posts: 167, Creators: 64, Activities: 3, Invites: 18, Description: "游客内容密度高。Proxy 只记录公开场景，不展示任何人的实时位置。"},
	{ID: "complex01", Name: "Complex 01", Area: "Đống Đa", Type: "空间 · 活动", Latitude: 21.0062, Longitude: 105.8284, Quality: 91, Best: "14:00–21:00", Posts: 74, Creators: 39, Activities: 14, Invites: 19, Active: true, Description: "近期活动密度高，适合作为 Creator 联动和公开小型活动节点。"},
	{ID: "manzi", Name: "Manzi Art Space", Area: "Ba Đình", Type: "艺术 · 展览", Latitude: 21.0395, Longitude: 105.846, Quality: 89, Best: "10:00–18:00", Posts: 43, Creators: 22, Activities: 5, Invites: 9, Description: "内容质量高但低频，展览更新时重新获得未探索价值。"},
	{ID: "banana", Name: "Red River Banana Island", Area: "Long Biên", Type: "自然 · 骑行", Latitude: 21.054, Longitude: 105.868, Quality: 87, Best: "06:30–09:00", Posts: 58, Creators: 26, Activities: 7, Invites: 17, Description: "适合重复骑行和自然内容，共同出行转化率较高。"},
	{ID: "bonsaidon", Name: "Bonsaidon · Tây Hồ", Area: "Tây Hồ", Type: "商家 · 社交", Latitude: 21.0621, Longitude: 105.8256, Quality: 90, Best: "14:00–20:30", Posts: 119, Creators: 41, Activities: 17, Invites: 32, Active: true, Description: "公开活动、Creator 到店与内容可归因；商业赞助不改变自然场景质量。"},
}

func (s *Server) publicRealityScenes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":public_reality_scenes") {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	payload, err := json.Marshal(map[string]any{"scenes": realitySceneLaunchCatalog, "privacy": "historical_public_not_live"})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "scene_projection_failed"})
		return
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(payload))
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}
