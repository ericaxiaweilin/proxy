package api

import (
	"context"
	"log"
	"net/http"
	"strconv"

	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// OPS-MATCH-PREVIEW-001（2026-10-08）：撮合预览——「这一单现在邀谁最合适、为什么」。
//
//	GET /v1/operator/match-preview?opportunityId=X&limit=10
//
// 这是辅助小美做好撮合的那一页：运营点开一张还没人接的单，看到平台**此刻**会按什么顺序邀请谁，
// 每个人的撮合分明细（可靠 / 满意 / 距离 / 新人 / 负载 / 共同兴趣），以及「你们都……」的共同标签。
// 它**不发邀约、不改任何状态**，只是把引擎本来要做的事摆出来让人能核对、能纠错。
//
// 候选范围与真邀请一模一样（同一个 nearbyInviter）：30km 内、有接单权限、没报过名的人。
// 看的是具体的人，所以要 MARKETPLACE 权限并留审计，不是谁都能看的分析页。

// MatchPreviewItem 是预览里的一个候选。
type MatchPreviewItem struct {
	Rank      int                 `json:"rank"`
	UserID    string              `json:"userId"`
	Breakdown matching.Breakdown  `json:"breakdown"`
	Affinity  float64             `json:"affinity"`
	Shared    []tagging.SharedTag `json:"sharedTags"`
	TagCount  int                 `json:"tagCount"`
}

// MatchPreviewResult 是整页。
type MatchPreviewResult struct {
	OpportunityID string             `json:"opportunityId"`
	Reason        string             `json:"reason,omitempty"` // 没有候选时说清为什么（没坐标 / 附近没人…）
	OwnerTagCount int                `json:"ownerTagCount"`
	TagFitWeight  float64            `json:"tagFitWeight"` // 当前共同兴趣权重；0 = 标签还没参与排名
	Candidates    []MatchPreviewItem `json:"candidates"`
}

// MatchPreviewFunc 由组合根接线（它需要市场、附近、权限、排名、标签几样东西）。
type MatchPreviewFunc func(ctx context.Context, opportunityID string, limit int) (MatchPreviewResult, error)

func (s *Server) operatorMatchPreview(w http.ResponseWriter, r *http.Request) {
	if s.MatchPreview == nil {
		notConnected("撮合预览（没有配数据库）", personalizationSpec+" §16")(w, r)
		return
	}
	id := r.URL.Query().Get("opportunityId")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "opportunity_id_required"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 30 {
		limit = 10
	}
	res, err := s.MatchPreview(r.Context(), id, limit)
	entry := operatoraudit.Entry{TargetKind: "Opportunity", TargetID: id, Detail: map[string]any{"candidates": len(res.Candidates)}}
	if err != nil {
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = err.Error()
		s.auditWrite(r, "MATCH_PREVIEW_VIEW", string(ScopeMarketplace), entry)
		log.Printf("operator match preview: %v", err)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "opportunity_not_found_or_unreadable"})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	s.auditWrite(r, "MATCH_PREVIEW_VIEW", string(ScopeMarketplace), entry)
	notes := []string{
		"预览不发邀约、不改任何状态：它只是把引擎此刻会做的事摆出来。候选范围与真邀请完全一致（30km 内、有接单权限、没报过名）。",
	}
	if res.TagFitWeight == 0 {
		notes = append(notes, "共同兴趣的权重现在是 0：标签只出现在理由里，还没有参与排名。要让它参与，到「撮合引擎管理」把「共同兴趣满分」调大。")
	}
	if res.OwnerTagCount == 0 {
		notes = append(notes, "发单方还没有标签（没同意浏览、也没做过主动行为），所以没有共同标签可比——这不是「不合」。")
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "preview": res, "notes": notes})
}
