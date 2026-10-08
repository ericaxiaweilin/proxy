package api

import (
	"fmt"
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

// 这一个是**真的没有数据源**的页面（其余各页已建成真读模型，见
// operator_console_pages.go 与 decisions_evaluate.go；引擎 API 页的
// 后端 = POST /v1/decisions/evaluate + 复用的引力状态机）。
//
// 措辞从「模块名」换成了**具体的缺什么**：哪张表没有写入方、哪个键对不上、哪个端点没注册路由。
// 「缺 outcome-service」这种写法看起来是说明，其实什么都没说 —— 运营既不知道差多少，
// 也不知道能不能补。下面每一条都写的是可以**当场验证**的事实。
//
// 已经建起来的五页（决策引擎 / 信任与风险 / 澄清门 / 意图编排 / 标签中心）搬去了
// internal/api/operator_console_pages.go，那里接的是真读模型。
//
// 标签中心是这里唯一「名不副实」的一页：标签体系确实不存在，但库里有 7 个轴今天在
// 当标签用，盘点它们比留一句「未接入」有用 —— 详见那边 operatorTags 的注释。
var (
	// 实验 / 影子流量：连表都没有。
	operatorResearch = notConnected(
		"Geometry Research / 影子流量（experiment-service）：库里没有任何实验或影子流量的表（按 experiment / shadow / abtest 全库查表名为 0 命中）",
		personalizationSpec+" §18 §19")
)

// operatorMerchant：商家管理（OPS-MERCHANT-001）。原来是 notConnected 桩，控制台那页
// 永远停在「未接入」。库里其实有真数（47 个主体 / 46 家店 / 819 张单），所以这一页
// 该显示真数；没有来源的（曝光、成交额、复购）继续走「未接入」而不是编一个。
func (s *Server) operatorMerchant(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("商家与投放指标（没有配数据库）", personalizationSpec+" §17")(w, r)
		return
	}
	m, err := s.OpsMetrics.Merchants(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator merchant: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "merchant_query_failed"})
		return
	}
	notes := []string{
		"曝光 / 投放效果未接入：没有把曝光落到具体门店的链路，所以这里不给「曝光」这一列，不给一个猜的数。",
		"成交额（gross）未接入：支付还没接，金额没有事实来源 —— 显示 0 会被读成「没生意」，所以干脆不给。",
	}
	if m.Totals.Orders30dAll > 0 && m.Totals.Orders30d == 0 {
		// 这就是归因链路没建起来的样子：订单有，但落不到门店。写明白，别让它长得像零。
		notes = append(notes, fmt.Sprintf(
			"近 %d 天有 %d 张订单，其中挂到门店的是 %d —— 不是这些店没单，是订单到门店的归因还没建（fulfillment.orders.store_id 大多为空）。",
			m.WindowDays, m.Totals.Orders30dAll, m.Totals.Orders30d))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": m.WindowDays,
		"totals":     m.Totals,
		"merchants":  m.Merchants,
		"notes":      notes,
	})
}

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
	// TAG-SYSTEM-001：兴趣来自标签层（各兴趣轴最普遍的标签）。少于 5 人的标签整行不出现；
	// 一条都没有时说清为什么，而不是显示一个空榜单。
	topInterests := []any{}
	topInterestsMissing := "标签层没有接入（没有配数据库）"
	if s.Insight != nil {
		topInterestsMissing = "还没有任何兴趣标签达到 5 人：标签只来自同意过浏览的人和主动行为，人数少时不显示（少于 5 人的分群等于在指认个人）。"
		if rows, err := s.Insight.TopInterests(r.Context(), time.Now().UTC(), 20); err != nil {
			log.Printf("operator behavior top interests: %v", err)
			topInterestsMissing = "兴趣标签这次没读出来（库错误）。"
		} else {
			for _, row := range rows {
				topInterests = append(topInterests, map[string]any{"tag": row.Tag, "score": row.Score, "confidence": row.Confidence, "users": row.Users})
			}
		}
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
		"top_interests":       topInterests,
		"topInterestsMissing": topInterestsMissing,
	})
}

var _ opsmetrics.Source = (*opsmetrics.Postgres)(nil)
