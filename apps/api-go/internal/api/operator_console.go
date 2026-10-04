package api

import (
	"log"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

// OPS-REAL-001（2026-09-23）：运营控制台（apps/market-intelligence-console）的服务端。
//
// 审计结论：17 个 /v1/operator/* 端点里 14 个是写死的数字（「注册 428K」「deep_view 2.75M」
// 「Meal gravity rising」「evaluate_calls_30d 18.6M」），而且**全部没有权限校验** —— 任何人都能调。
// OPS-TELEMETRY-001 只做到了让其中 3 个自报「占位」。现在：
//   - 全部端点走 operatorConsole：会话 + 运营白名单 + ANALYTICS scope（跟逐人浏览明细同一道门）；
//   - 能从库里真实算的（用户构成 / 行为信号）接 opsmetrics；
//   - 算不出来的一律返回 dataSource=NOT_CONNECTED + 缺的是《Personalization & Orchestration
//     Engineering Spec v1》（docs/spec/personalization/）里哪个模块，**不给任何数字**。
//     假的健康度比没有健康度更糟：它让人停止怀疑。
//   - context-field / surface-plans / execution-runtime 真的在跑 runtime（固定快照输入），保留，只加门。

const (
	OperatorLiveSource         = "LIVE"
	OperatorNotConnectedSource = "NOT_CONNECTED"
)

// operatorConsole：控制台读端点的统一门。没配运营门 = 503（fail-closed），不是放行。
func (s *Server) operatorConsole(handler http.HandlerFunc) http.HandlerFunc {
	return s.operatorConsoleMethod(http.MethodGet, handler)
}

// operatorConsoleMethod：同一道门，给少数运营写操作（如「立即重算引力」）用 POST。
func (s *Server) operatorConsoleMethod(method string, handler http.HandlerFunc) http.HandlerFunc {
	return s.operatorConsoleGated(method, ScopeAnalytics, handler)
}

// operatorConsoleAnyScope：是运营就放行，不要求某个具体 scope。
//
// 只给「看自己的权限」这一类端点用（OPS-ACCESS-001）。控制台其余读口一律要 ANALYTICS，
// 那是有道理的 —— 它们给的是逐人浏览明细。但权限页要是也卡在 ANALYTICS 上，一个被
// 收窄成只有 PAYMENTS 的运营连自己有什么权限都看不到，只能去猜；「不知道自己有什么
// 权限」正是权限模型失效的样子。它暴露的是 scope 词汇表和白名单里的 principal id，
// 都是内部标识，不是用户数据。
func (s *Server) operatorConsoleAnyScope(handler http.HandlerFunc) http.HandlerFunc {
	return s.operatorConsoleGated(http.MethodGet, "", handler)
}

func (s *Server) operatorConsoleGated(method string, required OperatorScope, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		if s.Operator == nil || s.Authenticator == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "operator_gate_unavailable"})
			return
		}
		rawToken, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
			return
		}
		auth, err := s.Authenticator.Authenticate(r.Context(), rawToken)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
			return
		}
		if !s.Operator.IsOperator(auth.Actor, auth.Principal, auth.AuthContext) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "operator_privilege_required"})
			return
		}
		if required != "" && !s.Operator.ScopesFor(auth.Actor, auth.Principal, auth.AuthContext)[required] {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "operator_privilege_required"})
			return
		}
		handler(w, r)
	}
}

// operatorIdentity recovers who is acting, for the audit row. The console gate has already
// proved the caller is an operator with ANALYTICS; this only re-reads the token to get the
// ids. Empty when it cannot be read — the row is still written with "unknown", because an
// action whose actor is unknown is worse to drop than to record vaguely.
func (s *Server) operatorIdentity(r *http.Request) (actorID, principalID string) {
	raw, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok || s.Authenticator == nil {
		return "", ""
	}
	auth, err := s.Authenticator.Authenticate(r.Context(), raw)
	if err != nil {
		return "", ""
	}
	return auth.Actor.ID, auth.Principal.ID
}

// auditWrite records one operator action. Safe on a nil receiver / nil Audit: the action
// still happened, and dropping it silently is the exact gap OPS-AUDIT-001 exists to close,
// so Recorder counts the miss instead (see operatoraudit.Recorder).
func (s *Server) auditWrite(r *http.Request, action, scope string, e operatoraudit.Entry) {
	if s.Audit == nil {
		return
	}
	actorID, principalID := s.operatorIdentity(r)
	if actorID == "" {
		actorID = "unknown"
	}
	e.OperatorID = actorID
	e.PrincipalID = principalID
	e.Action = action
	// The scope recorded is the one the console door actually checked (ANALYTICS for every
	// /v1/operator/* route), not the domain the action belongs to — an audit row must name
	// the authority that was exercised, not the authority someone wished had been.
	e.Scope = scope
	e.RequestID = r.Header.Get("X-Request-Id")
	s.Audit.Record(r.Context(), e)
}

// notConnected：这个页面要的数据在规格里有，但后端还没有对应模块。
func notConnected(missing, spec string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"dataSource": OperatorNotConnectedSource,
			"missing":    missing,
			"spec":       spec,
		})
	}
}

const personalizationSpec = "docs/spec/personalization/Proxy_Personalization_Orchestration_Engineering_Spec_v1.md"

var (
	operatorDecisionEngine      = notConnected("决策引擎（/v1/decisions/evaluate 未实现；runtime.Decide 只有一条暴雨规则）", personalizationSpec+" §11 §16 §20")
	operatorClarificationGate   = notConnected("澄清门（intent-service）", personalizationSpec+" §16")
	operatorSupplyHealth        = notConnected("供给健康度（按 segment 的供给/需求比、激活漏斗）", personalizationSpec+" §5 Market Graph")
	operatorFulfillmentAttr     = notConnected("决策 → 曝光 → 结果 归因链（outcome-service）", personalizationSpec+" §17 §18")
	operatorResearch            = notConnected("Geometry Research / 影子流量（experiment-service）", personalizationSpec+" §18 §19")
	operatorTags                = notConnected("标签体系（tag-service / tag-factory）", personalizationSpec+" §3")
	operatorIntentOrchestration = notConnected("意图漏斗 + 引力 / 召回 / 排序 / 编排（gravity-service、retrieval、ranking、orchestration）", personalizationSpec+" §6 §7 §16")
	operatorEngineAPI           = notConnected("引擎 API（/v1/decisions/evaluate 等尚未实现）", personalizationSpec+" §20")
	operatorMerchant            = notConnected("商家与投放指标", personalizationSpec+" §17")
	operatorRetention           = notConnected("留存与复购队列", personalizationSpec+" §17")
	operatorTrust               = notConnected("信任与风险评分（evidence-gate、negative-breaker）", personalizationSpec+" §9 §10")
	operatorQuality             = notConnected("数据治理（曝光谱系 / 污染风险）", personalizationSpec+" §9.1 §9.4")
)

func (s *Server) operatorPopulation(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("用户构成（没有配数据库）", "")(w, r)
		return
	}
	pop, err := s.OpsMetrics.Population(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator population: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "population_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": 30,
		"kpis": map[string]any{
			"注册账号":      pop.Registered,
			"近30天新增":    pop.New30d,
			"近30天活跃":    pop.Active30d,
			"填了主页名字":    pop.WithProfile,
			"近30天发过帖的人": pop.WithPosts30d,
		},
		// 资料里没有性别字段：不是 0，是没采集。
		"gender":        []any{},
		"genderMissing": "资料里没有采集性别",
	})
}

func (s *Server) operatorBehavior(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("行为信号（没有配数据库）", "")(w, r)
		return
	}
	b, err := s.OpsMetrics.Behavior(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator behavior: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "behavior_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": 30,
		"events": map[string]any{
			"exposures":       b.Exposures,
			"deep_view":       b.DeepViews,
			"zooms":           b.Zooms,
			"profile_opens":   b.ProfileOpens,
			"strong_positive": b.StrongPositive,
			"weak_negative":   b.WeakNegative,
			"strong_negative": b.StrongNegative,
		},
		// 兴趣分需要标签体系（spec §3），现在没有：给空，并写明缺什么。
		"top_interests":       []any{},
		"topInterestsMissing": "标签体系（tag-service）未实现，兴趣分无从计算",
	})
}

var _ opsmetrics.Source = (*opsmetrics.Postgres)(nil)
