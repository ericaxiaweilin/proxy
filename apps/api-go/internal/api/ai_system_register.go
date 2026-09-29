package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/aisystem"
)

// operatorAISystemRegister handles GET /v1/operator/ai/systems.
//
// 为什么需要这个读口：Điều 10.1 要求提供方在投入使用前**自行分级**并留存
// 分级档案，Điều 10.3 要求中/高风险系统的分级结果在投入使用前报送科技部。
// 在 internal/aisystem 之前，这个仓里没有任何一处能回答「我们一共跑了几个
// AI 系统、各自什么等级、该有哪些措施、现在缺哪些」—— 分级这个动作本身
// 没有产物。有了读口，运维与审计才能把「带缺口在跑」当成一个**可查的状态**
// 而不是一个传闻。
//
// 运维专用（requireOperator）：登记册里含各系统的保护措施缺口清单，
// 属于内部合规信息，不是公开面。低风险系统的「鼓励公开」是 Điều 10.3 对
// **系统本身基本信息**的鼓励，不等于把缺口清单公开。
//
// 返回体刻意把三件事分开，不许糊成一个 "failed"：
//   - 系统不在登记册里（found=false）
//   - 系统在册但没分级（tier="UNCLASSIFIED"）
//   - 系统已分级但带着具体缺口（tier 为法定等级 + blockers）
func (s *Server) operatorAISystemRegister(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if !s.requireOperator(w, r) {
		return
	}

	assessments := aisystem.AssessAll()
	summary := aisystem.Summarize(assessments)

	systems := make([]map[string]any, 0, len(assessments))
	for _, a := range assessments {
		systems = append(systems, aiSystemAssessmentView(a))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"systems": systems,
		"summary": map[string]any{
			"total":                  summary.Total,
			"readyForUse":            summary.ReadyForUse,
			"blocked":                summary.Blocked,
			"unclassified":           summary.Unclassified,
			"notifiedToMoST":         summary.NotifiedToMoST,
			"requiredProtectionGaps": summary.RequiredProtectionGaps,
		},
		// 报送受理机关与门户写在响应里，避免运维去翻代码。
		"notificationAuthority": aisystem.NotificationAuthority,
		"checkedAt":             time.Now().UTC().Format(time.RFC3339),
	})
}

// operatorAISystemItem handles GET /v1/operator/ai/systems/{id}.
//
// 单系统查询。**查不到这个系统**与**系统有问题**返回的是两种不同的东西：
// 前者 404 + NOT_REGISTERED，后者 200 + 带 blockers 的体检结果。
// 把它们合并成同一个「读失败」正是本仓反复强调不要做的那种事。
//
// 路径参数用 TrimPrefix 手工解析，**不要用 r.PathValue**：本仓的
// http.NewServeMux 上没有任何带 {name} 的 pattern（见 server.go 的路由注册），
// PathValue 恒为空串。operatorKillSwitchRearm 就是踩了这个坑 —— 见
// COMP-KILLSWITCH-REARM-001。
func (s *Server) operatorAISystemItem(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if !s.requireOperator(w, r) {
		return
	}
	raw := strings.TrimPrefix(r.URL.Path, "/v1/operator/ai/systems/")
	id := aisystem.SystemID(strings.TrimSpace(raw))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "system_id_required"})
		return
	}
	assessment := aisystem.Assess(id)
	if !assessment.Found {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error":     "ai_system_not_registered",
			"systemId":  string(id),
			"blockers":  aiSystemBlockerViews(assessment.Blockers),
			"checkedAt": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"system":    aiSystemAssessmentView(assessment),
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

func aiSystemAssessmentView(a aisystem.Assessment) map[string]any {
	out := map[string]any{
		"id":    string(a.ID),
		"name":  a.Name,
		"found": a.Found,
		"tier":  string(a.Tier),
		// tierIsLegal 与 tier 分开给：UNCLASSIFIED 不是 Điều 9.1 的第三级，
		// 它是「没有记录」。客户端不要靠比较字符串来推断这件事。
		"tierIsLegal":  a.Tier.IsLegalTier(),
		"basis":        string(a.Basis),
		"basisLaw":     a.Basis.Law(),
		"basisNote":    a.BasisNote,
		"factors":      stringSlice(a.Factors),
		"capabilities": stringSlice(a.Capabilities),
		"required":     protectionStrings(a.Required),
		"implemented":  protectionStrings(a.Implemented),
		"missing":      protectionStrings(a.Missing),
		"readyForUse":  a.ReadyForUse,
		"blockers":     aiSystemBlockerViews(a.Blockers),
		"notification": map[string]any{
			"status":    string(a.Notification.Status),
			"authority": a.Notification.Authority,
			"portal":    a.Notification.Portal,
			"filedAt":   a.Notification.FiledAt,
			"reference": a.Notification.Reference,
		},
	}
	return out
}

func aiSystemBlockerViews(blockers []aisystem.Blocker) []map[string]any {
	out := make([]map[string]any, 0, len(blockers))
	for _, b := range blockers {
		view := map[string]any{
			"code":   string(b.Code),
			"law":    b.Law,
			"detail": b.Detail,
		}
		if len(b.Missing) > 0 {
			view["missing"] = protectionStrings(b.Missing)
			// 每条缺失措施都带上条文，运维不必再查代码。
			laws := make(map[string]string, len(b.Missing))
			for _, p := range b.Missing {
				laws[string(p)] = p.Law()
			}
			view["missingLaws"] = laws
		}
		out = append(out, view)
	}
	return out
}

func protectionStrings(list []aisystem.Protection) []string {
	out := make([]string, 0, len(list))
	for _, p := range list {
		out = append(out, string(p))
	}
	return out
}

func stringSlice[T ~string](list []T) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		out = append(out, string(v))
	}
	return out
}
