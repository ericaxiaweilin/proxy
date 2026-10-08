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

// OPS-PROVIDER-PROFILE-001（2026-10-08）：小美（服务方）画像——「了解用户、辅助小美做好撮合」的供给侧那一半。
//
//	GET /v1/operator/providers?limit=50            服务方列表，按撮合分排序，带标签数
//	GET /v1/operator/providers/profile?userId=X    一个服务方：撮合分明细 + 标签画像
//
// 看的是具体的人，所以要 MARKETPLACE 权限，详情留审计；列表不含标签内容，只有数量。
// 撮合分用无报价、无坐标的口径（只看这个人自己的履约 / 满意 / 经验 / 响应 / 负载），不掺任何一张单的因素。

type ProviderListItem struct {
	Rank      int                `json:"rank"`
	UserID    string             `json:"userId"`
	Name      string             `json:"name"`
	Handle    string             `json:"handle"`
	City      string             `json:"city"`
	Services  []string           `json:"services"`
	Score     float64            `json:"score"`
	Completed int                `json:"completed"`
	TagCount  int                `json:"tagCount"`
	Breakdown matching.Breakdown `json:"breakdown"`
}

type ProviderProfileResult struct {
	Provider ProviderListItem `json:"provider"`
	Profile  tagging.Profile  `json:"profile"`
}

type ProviderListFunc func(ctx context.Context, limit int) ([]ProviderListItem, error)
type ProviderProfileFunc func(ctx context.Context, userID string) (ProviderProfileResult, bool, error)

func (s *Server) operatorProviders(w http.ResponseWriter, r *http.Request) {
	if s.ProviderList == nil {
		notConnected("小美画像（没有配数据库）", personalizationSpec+" §3 §5")(w, r)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	items, err := s.ProviderList(r.Context(), limit)
	if err != nil {
		log.Printf("operator providers: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "providers_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource, "providers": items,
		"notes": []string{
			"撮合分只看这个人自己的履约、满意、经验、响应和手上的活，不含任何一张单的报价或距离，所以是「她这个人」的底分。",
			"没有完成过单的人分数来自先验（新人当作已有少量中性记录），不是她表现差；看 完成单数 一列区分。",
			"列表里标签只给数量；标签内容在单个服务方的画像页，打开会留审计。",
		},
	})
}

func (s *Server) operatorProviderProfile(w http.ResponseWriter, r *http.Request) {
	if s.ProviderProfile == nil {
		notConnected("小美画像（没有配数据库）", personalizationSpec+" §3 §5")(w, r)
		return
	}
	id := r.URL.Query().Get("userId")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id_required"})
		return
	}
	res, found, err := s.ProviderProfile(r.Context(), id)
	entry := operatoraudit.Entry{TargetKind: "Provider", TargetID: id}
	if err != nil {
		log.Printf("operator provider profile: %v", err)
		entry.Outcome = operatoraudit.OutcomeDenied
		s.auditWrite(r, "PROVIDER_PROFILE_VIEW", string(ScopeMarketplace), entry)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "provider_profile_failed"})
		return
	}
	if !found {
		entry.Outcome = operatoraudit.OutcomeDenied
		s.auditWrite(r, "PROVIDER_PROFILE_VIEW", string(ScopeMarketplace), entry)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "provider_not_found"})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	entry.Detail = map[string]any{"tags": res.Profile.TagCount}
	s.auditWrite(r, "PROVIDER_PROFILE_VIEW", string(ScopeMarketplace), entry)
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "result": res})
}
