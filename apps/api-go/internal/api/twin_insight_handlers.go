package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/twininsight"
)

// TWIN-INSIGHT-002 — AI 分身「好友洞察」REST 面。
//
// 契约：packages/contracts/src/twin-insight.ts（单一事实源）。
// 客户端：apps/mobile/src/twin-insight-client.ts。
//
//	GET  /v1/ai/twins/{twinId}/insights                       列表（含 thresholds）
//	GET  /v1/ai/twins/{twinId}/insights/{targetId}            单目标
//	POST /v1/ai/twins/{twinId}/targets/{targetId}/operate     observe | operate
//	POST /v1/ai/twins/{twinId}/insights/{targetId}/summary:refresh  重新总结
//
// ── 一处对 PRD 的**刻意偏离**，必须留痕 ──────────────────────────────
// PRD（docs/prd/Proxy_TwinInsight_v1_PRD_API.md §4）把两个读端点标成「匿名」，
// 理由是"沿用 Facet 匿名策略，公开浏览无需登录"。这里**不照做**，四个端点
// 全部要求会话 + 校验分身归属。
//
// 理由：这个 payload 里装的不是公开内容，而是**第三方（我的好友）的行为数据** ——
// 「他 7 天看了我主页 12 次」「他平均在我内容上停 3 分钟」。匿名可读意味着
// 任何人拿一个 twinId 就能读到别人好友的行为轨迹。Facet 的匿名读之所以安全，
// 是因为它读的是公开对象目录；这条 payload 不是那个形状。
// twin_gallery_handlers.go 已经为同类"私有列表"定过调子：
// "A gallery is private; 'list someone else's raw photos by guessing their
// ownerId' must not be possible" —— 那条理由在这里只会更强。
// 客户端本来就走认证通道发这两个读请求（twin-insight-section.tsx 把
// requestPublic 和 request 都指向 authClient.request），所以收紧不影响它。
//
// ── 另一条：这里不产生任何数据 ─────────────────────────────────────
// 列表内容全部来自真实事件表（见 internal/twininsight）。服务端没有洞察
// 可给时返回 insights: []（真空态），不返回编造的好友。原先客户端那份
// 6 个虚构好友的兜底数据（twin-insight-demo.ts）已随本次改动删除。

const twinInsightsPrefix = "/v1/ai/twins/"

func (s *Server) routeTwinInsight(w http.ResponseWriter, r *http.Request) {
	if s.TwinInsight == nil || s.AIPersona == nil || s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "twin_insight_unavailable"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, twinInsightsPrefix)
	parts := strings.Split(rest, "/")
	if len(parts) < 2 || parts[0] == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_path"})
		return
	}
	twinID := parts[0]
	switch parts[1] {
	case "insights":
		switch len(parts) {
		case 2:
			if !methodGuard(w, r, http.MethodGet) {
				return
			}
			s.twinInsightsList(w, r, twinID)
		case 3:
			if !methodGuard(w, r, http.MethodGet) {
				return
			}
			s.twinInsightDetail(w, r, twinID, parts[2])
		case 4:
			if parts[3] != "summary:refresh" {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
				return
			}
			if !methodGuard(w, r, http.MethodPost) {
				return
			}
			s.twinInsightRefreshSummary(w, r, twinID, parts[2])
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		}
	case "targets":
		if len(parts) != 4 || parts[3] != "operate" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		if !methodGuard(w, r, http.MethodPost) {
			return
		}
		s.twinInsightOperate(w, r, twinID, parts[2])
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	}
}

// twinInsightOwner 是四个端点的共同前置：会话 → 分身 → 归属。
// 返回 false 表示已经写过响应，调用方直接 return。
//
// 归属校验不可省：twinId 是客户端传的，不校验就能用别人的分身 id
// 读别人的好友行为数据 / 往别人的审计表里写。
func (s *Server) twinInsightOwner(w http.ResponseWriter, r *http.Request, twinID string) (string, bool) {
	rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return "", false
	}
	authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return "", false
	}
	persona, err := s.AIPersona.GetPersona(r.Context(), twinID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "persona_not_found"})
		return "", false
	}
	if persona.OwnerID != authenticated.Principal.ID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not_persona_owner"})
		return "", false
	}
	return authenticated.Principal.ID, true
}

func (s *Server) twinInsightsList(w http.ResponseWriter, r *http.Request, twinID string) {
	ownerID, ok := s.twinInsightOwner(w, r, twinID)
	if !ok {
		return
	}
	payload, err := s.TwinInsight.ListInsights(r.Context(), twinID, ownerID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "twin_insights_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) twinInsightDetail(w http.ResponseWriter, r *http.Request, twinID, targetID string) {
	ownerID, ok := s.twinInsightOwner(w, r, twinID)
	if !ok {
		return
	}
	insight, err := s.TwinInsight.GetInsight(r.Context(), twinID, ownerID, targetID)
	if err != nil {
		writeTwinInsightError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, insight)
}

func (s *Server) twinInsightOperate(w http.ResponseWriter, r *http.Request, twinID, targetID string) {
	ownerID, ok := s.twinInsightOwner(w, r, twinID)
	if !ok {
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := decodeBodyJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	result, err := s.TwinInsight.RecordOperate(r.Context(), twinID, ownerID, targetID, twininsight.OperateAction(body.Action))
	if err != nil {
		writeTwinInsightError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) twinInsightRefreshSummary(w http.ResponseWriter, r *http.Request, twinID, targetID string) {
	ownerID, ok := s.twinInsightOwner(w, r, twinID)
	if !ok {
		return
	}
	insight, err := s.TwinInsight.RefreshSummary(r.Context(), twinID, ownerID, targetID)
	if err != nil {
		writeTwinInsightError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, insight)
}

// writeTwinInsightError 把域错误翻成 HTTP 语义。
//
// 未成年门禁的三种拒绝（没接查询 / 没年龄证据 / 确认未成年）都翻 403 并带
// 可区分的 code —— 客户端要能告诉用户"去补年龄"而不是"操作失败"。
func writeTwinInsightError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, twininsight.ErrTargetNotAFriend):
		// 不是"查不到"，是"不在你能看的目标集里" —— 两者都翻 404，
		// 不泄漏对方是否存在。
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "target_not_found"})
	case errors.Is(err, twininsight.ErrActionInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_action"})
	case errors.Is(err, aipersona.ErrMinorForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "companion_minor_forbidden"})
	case errors.Is(err, aipersona.ErrNoAgeEvidence):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "companion_age_evidence_required"})
	case errors.Is(err, aipersona.ErrAgeLookupUnavailable),
		errors.Is(err, twininsight.ErrCompanionGateUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "companion_gate_unavailable"})
	case errors.Is(err, twininsight.ErrSummaryUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "summary_unavailable"})
	case errors.Is(err, twininsight.ErrActionLogUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "action_log_unavailable"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "twin_insight_failed", "reason": err.Error()})
	}
}
