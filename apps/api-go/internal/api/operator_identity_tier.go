package api

import (
	"context"
	"log"
	"net/http"

	"github.com/proxy-app/proxy-api/internal/identitytier"
)

// IdentityTierSource 读身份成长体系：积分账本与等级分布。
type IdentityTierSource interface {
	Points(ctx context.Context, k identitytier.Kind, id string) (int, error)
	Distribution(ctx context.Context) ([]identitytier.Bucket, error)
	Recent(ctx context.Context, k identitytier.Kind, id string, limit int) ([]identitytier.Entry, error)
}

// operatorIdentityTiers：GET /v1/operator/identity-tiers[?kind=USER&userId=…]
// 固定部分：等级阶梯 + 积分赚取规则 + 各等级人数；带 userId 时再给这个人的积分和等级。
func (s *Server) operatorIdentityTiers(w http.ResponseWriter, r *http.Request) {
	if s.IdentityTiers == nil {
		notConnected("身份成长体系（没有配数据库）", personalizationSpec+" §16.2")(w, r)
		return
	}
	dist, err := s.IdentityTiers.Distribution(r.Context())
	if err != nil {
		log.Printf("operator identity tiers: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "identity_tiers_query_failed"})
		return
	}
	kinds := []map[string]any{}
	for _, k := range identitytier.Kinds() {
		kinds = append(kinds, map[string]any{"kind": k, "ladder": identitytier.Ladder(k), "earnRules": identitytier.EarnRules(k)})
	}
	out := map[string]any{"dataSource": OperatorLiveSource, "kinds": kinds, "distribution": dist}
	if uid := r.URL.Query().Get("userId"); uid != "" {
		k := identitytier.Kind(r.URL.Query().Get("kind"))
		if k == "" {
			k = identitytier.User
		}
		if !identitytier.Valid(k) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_kind"})
			return
		}
		pts, err := s.IdentityTiers.Points(r.Context(), k, uid)
		if err != nil {
			log.Printf("operator identity tiers points: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "identity_tiers_query_failed"})
			return
		}
		out["subject"] = map[string]any{"kind": k, "userId": uid, "level": identitytier.Resolve(k, pts)}
	}
	writeJSON(w, http.StatusOK, out)
}

// myIdentityTier：GET /v1/me/identity-tier —— 我的等级、积分、怎么赚、最近几笔。
// 没记过分的人是 0 分铜 1，如实说 0，不编。积分不是钱、不能提现。
func (s *Server) myIdentityTier(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.IdentityTiers == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_tier_unavailable"})
		return
	}
	auth, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	id := auth.Actor.ID
	pts, err := s.IdentityTiers.Points(r.Context(), identitytier.User, id)
	if err != nil {
		log.Printf("my identity tier: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "identity_tier_failed"})
		return
	}
	recent, err := s.IdentityTiers.Recent(r.Context(), identitytier.User, id, 10)
	if err != nil {
		recent = []identitytier.Entry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"level": identitytier.Resolve(identitytier.User, pts), "earnRules": identitytier.EarnRules(identitytier.User),
		"ladder": identitytier.Ladder(identitytier.User), "recent": recent,
	})
}
