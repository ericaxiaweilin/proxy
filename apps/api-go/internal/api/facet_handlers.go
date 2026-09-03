package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/facet"
)

// facetObjects 列出当前用户的所有 FACET 对象（R15.25 Phase 1）。
//
// Phase 1 = 静态 mock 三条数据（与 Proxy_COMPLETE_FiveRoot_FACET_v11.html
// prototype 的 facetObjects 一致）：
//   - ken  = 重点关系 (BUILDING_TRUST)
//   - linh = 朋友     (SHARED_INTEREST)
//   - spa  = 合作     (CREATOR_COLLAB)
//
// 行为契约：
//   - GET only, 其它方法 → 405
//   - 不需要 auth（Phase 1 不做持久化）
//   - 返回 ListFacetObjectsPayload（{ objects, totalObjects, freshAssets, shownAssets }）
//   - Phase 1 NOT-IN-SCOPE：图片 URL 永远 = ""（UI 显示 placeholder）；
//     不做 LIBRARY / OBJECTS / OBJECT DETAIL / 关系规则引擎 / 真实持久化。
//
// 后端 facade shape 必须跟 packages/contracts/src/facet.ts 严格对齐：
// schema rename 一旦发生, 编译期会爆 (zod 解析)。
// R15.25.1 起：数据来自 facet.Service（PG持久化或内存seed），不再hardcode mock，
// 但 wire shape 与mock完全一致，保证前端zod不漂。
func (s *Server) facetObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	payload, err := s.Facet.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_list_failed"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// facetSideSpace 处理 R15.43 副空间 CRUD：
//
//	GET    /v1/facet/objects/:id/side-space/posts
//	POST   /v1/facet/objects/:id/side-space/posts   body: { postId }
//	DELETE /v1/facet/objects/:id/side-space/posts/:postId
//
// 设计：仅 CREATOR_COLLAB 关系能添加。post 必须在 catalog 里。
// 完整 catalog 走 GET /v1/facet/side-space/catalog（Phase 1 mock）。
func (s *Server) facetSideSpace(w http.ResponseWriter, r *http.Request) {
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	// 解析 path: /v1/facet/objects/:id/side-space/posts[/postId]
	rest := strings.TrimPrefix(r.URL.Path, "/v1/facet/objects/")
	parts := strings.Split(rest, "/")
	// 合法 shape: parts 长度 >= 3 且 [0]=objectID [1]="side-space" [2]="posts"
	// 可选: parts[3] = postID (DELETE path param)
	if len(parts) < 3 || parts[1] != "side-space" || parts[2] != "posts" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	objectID := parts[0]
	pathPostID := ""
	if len(parts) >= 4 && parts[3] != "" {
		pathPostID = parts[3]
	}
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet:
		posts, err := s.Facet.ListSideSpacePosts(ctx, objectID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_sidespace_list_failed"})
			return
		}
		if posts == nil {
			posts = []facet.SideSpacePost{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
	case http.MethodPost:
		// POST: postID 来自 request body { postId }, pathPostID 不需要
		var body struct {
			PostID string `json:"postId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		if body.PostID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "post_id_required"})
			return
		}
		post, err := s.Facet.AddSideSpacePost(ctx, objectID, body.PostID)
		if err != nil {
			switch {
			case errors.Is(err, facet.ErrSideSpaceAlreadyAdded):
				writeJSON(w, http.StatusConflict, map[string]string{"error": "already_added"})
			case errors.Is(err, facet.ErrSideSpaceInvalidKind):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_kind"})
			default:
				if strings.HasPrefix(err.Error(), "side_space: object not found") {
					writeJSON(w, http.StatusNotFound, map[string]string{"error": "object_not_found"})
				} else if strings.HasPrefix(err.Error(), "side_space: object is not CREATOR_COLLAB") {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "object_not_creator_collab"})
				} else if strings.HasPrefix(err.Error(), "side_space: post not in catalog") {
					writeJSON(w, http.StatusNotFound, map[string]string{"error": "post_not_in_catalog"})
				} else {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_sidespace_add_failed"})
				}
			}
			return
		}
		writeJSON(w, http.StatusOK, post)
	case http.MethodDelete:
		if pathPostID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "post_id_required"})
			return
		}
		if err := s.Facet.RemoveSideSpacePost(ctx, objectID, pathPostID); err != nil {
			if errors.Is(err, facet.ErrSideSpaceNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_in_sidespace"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_sidespace_remove_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

// facetSideSpaceCatalog 返回 R15.43 全局 catalog（Phase 1 mock 5 条）。
//
// GET /v1/facet/side-space/catalog
func (s *Server) facetSideSpaceCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	posts := s.Facet.ListSideSpaceCatalog()
	if posts == nil {
		posts = []facet.SideSpaceCatalogPost{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

// facetConfig 处理 R15.51 运营阈值 CRUD:
//
//	GET   /v1/facet/config     → 返当前 FacetConfig
//	POST  /v1/facet/config     body: { expectedVersion, patch } → 更新 + 返新 config
//
// 设计: GET 匿名可读 (跟 ListFacetObjects 一致); POST 需要更新人
// (UpdatedBy 必填) — 匿名返回 401。 Phase 1.5 匿名能 POST, 不出生产。
// 乐观锁 expectedVersion 跟 repo.Update 一致, 不匹配返 409.
func (s *Server) facetConfig(w http.ResponseWriter, r *http.Request) {
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.Facet.ListFacetConfig(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_config_get_failed"})
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPost:
		var req struct {
			ExpectedVersion int                    `json:"expectedVersion"`
			Patch           facet.FacetConfigPatch `json:"patch"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		if req.Patch.UpdatedBy == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "updated_by_required"})
			return
		}
		updated, err := s.Facet.UpdateFacetConfig(r.Context(), req.ExpectedVersion, req.Patch)
		if err != nil {
			if errors.Is(err, facet.ErrConfigVersionMismatch) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "config_version_mismatch"})
				return
			}
			if errors.Is(err, facet.ErrConfigInvalidValue) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "config_invalid_value"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_config_update_failed"})
			return
		}
		writeJSON(w, http.StatusOK, updated)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

// facetSideSpaceSuggestions 返回 R15.52 server 推送的副空间推荐.
//
//	GET /v1/facet/side-space/suggestions?limit=3
//
// 返 { suggestions: { [objectId]: SideSpaceSuggestions } }.
// 不需要的 objectId (如已满足 / 非合作方) 返空 posts (client 跳过).
func (s *Server) facetSideSpaceSuggestions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	limit := 3
	if v := r.URL.Query().Get("limit"); v != "" {
		// 简单 parse (Phase 1.5 信任输入; Phase 2 加 zod / 严格)
		var parsed int
		if _, err := fmt.Sscanf(v, "%d", &parsed); err == nil && parsed > 0 && parsed <= 10 {
			limit = parsed
		}
	}
	suggestions, err := s.Facet.SideSpaceSuggestionsForAll(r.Context(), limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_suggestions_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": suggestions})
}
