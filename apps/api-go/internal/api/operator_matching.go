package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-MATCHING-TUNABLES-001（2026-10-05）：撮合引擎管理（spec §16.2 Ranking）。
//
//	GET  /v1/operator/matching           引擎现在按的那套系数：当前值 / 默认值 / 谁改的 / 什么时候
//	POST /v1/operator/matching/tunables  改系数（MARKETPLACE scope，必填理由，落审计）
//	GET  /v1/operator/matching/trace     真实撮合留痕：那一批候选当时为什么这么排
//
// 为什么这一页必须存在：撮合排序的口径全写在代码里（可靠 40 分、新人按「3 单里完成 2.4 单」
// 起步、引力没算过的人给 0.3 中性分）。运营看不见这些数，也就不可能在「撮合太偏袒便宜」这类
// 反馈之后调口径；而控制台当时的「意图与撮合」页只有引力分布 —— 「谁排在前」的因由一处都看不到。
//
// 为什么三个数一起摆（生效值 / 默认值 / 库里存的）：进程正在用的、下次启动会加载的、出厂的，
// 是三个不同的东西。只摆一个就会骗人：多实例下 A 改了库、B 没重启，B 的页面摆的是 B 自己在用的
// 那套，库里已经是另一套 —— 两份账对不上正是 OPS-REAL-001 那批假数字的成因。对不上就报出来。

// tunableView 是一个旋钮在控制台上的样子。
type tunableView struct {
	Key          string     `json:"key"`
	Value        float64    `json:"value"`
	DefaultValue float64    `json:"defaultValue"`
	Source       string     `json:"source"` // DEFAULT = 没人改过 | OVERRIDE = 库里有记录
	Min          float64    `json:"min"`
	Max          float64    `json:"max"`
	Description  string     `json:"description"`
	StoredValue  *float64   `json:"storedValue,omitempty"`
	UpdatedBy    string     `json:"updatedBy,omitempty"`
	UpdatedAt    *time.Time `json:"updatedAt,omitempty"`
	Version      int        `json:"version,omitempty"`
}

func matchingTunableViews(current matching.Tunables, stored map[string]matching.TunableChange) []tunableView {
	currentValues := current.Values()
	out := make([]tunableView, 0, len(matching.TunableDefs()))
	for _, def := range matching.TunableDefs() {
		v := tunableView{
			Key: def.Key, Value: currentValues[def.Key], DefaultValue: def.Default(),
			Min: def.Min, Max: def.Max, Description: def.Description, Source: "DEFAULT",
		}
		if c, ok := stored[def.Key]; ok {
			storedValue, at := c.Value, c.UpdatedAt
			v.Source = "OVERRIDE"
			v.StoredValue = &storedValue
			v.UpdatedBy = c.UpdatedBy
			v.UpdatedAt = &at
			v.Version = c.Version
		}
		out = append(out, v)
	}
	return out
}

// matchingDivergences 说出生效值与库里存值不一致的地方。两种时候会不同：
// ① 别的实例改了库而这个进程还没重载；② 库里那个值已经越界（换版本后边界收紧），
// 启动时整套退回默认值。第二种**必须**看得见：不然界面摆着一个库里从没生效过的数，
// 而引擎按默认值在跑，谁都对不上这笔账。
func matchingDivergences(views []tunableView) []string {
	var out []string
	for _, v := range views {
		if v.StoredValue != nil && *v.StoredValue != v.Value {
			out = append(out, fmt.Sprintf("引擎现在按 %s=%g 在跑，库里存的是 %g（本进程还没重载，或那个值已越界没通过启动校验）",
				v.Key, v.Value, *v.StoredValue))
		}
	}
	return out
}

// matchingState 给控制台取一份引擎状态（GET 与 POST 成功后共用，两个口摆同一份账）。
func (s *Server) matchingState(r *http.Request) ([]tunableView, []string, error) {
	stored, err := s.Matching.TunableOverrides(r.Context())
	if err != nil {
		log.Printf("operator matching tunables: %v", err)
		return nil, nil, fmt.Errorf("tunables_query_failed")
	}
	current := matching.CurrentTunables()
	return matchingTunableViews(current, stored), current.InvariantWarnings(), nil
}

func (s *Server) operatorMatching(w http.ResponseWriter, r *http.Request) {
	if s.Matching == nil {
		notConnected("撮合排序旋钮（没有配数据库）", personalizationSpec+" §16.2")(w, r)
		return
	}
	views, warnings, err := s.matchingState(r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "tunables_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"tunables":   views,
		"warnings":   append(warnings, matchingDivergences(views)...),
		"notTunableNotes": []string{
			"改完只影响之后的撮合：已存的候选批次快照不重算 —— 那是当时的真实决定，重算就是伪造历史",
			"入格条件（实名 / 能力 / 时间窗 / 预算硬上限）是布尔门，不是权重：这里没有对应旋钮，不是漏了",
			"曝光类信号（浏览 / 点赞 / 粉丝）永远不进撮合排序：PRD R15.2 Popularity ≠ Qualification",
			"引力自己的参数（半衰期 14 天 / 回看 60 天 / 168 个时段桶）在 internal/gravity，不在这一页",
			"多实例部署时，改完在当前进程立刻生效，其他实例要下次启动才加载",
		},
	})
}

func (s *Server) operatorMatchingTunables(w http.ResponseWriter, r *http.Request) {
	if s.Matching == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "matching_store_unavailable"})
		return
	}
	var body struct {
		Tunables map[string]float64 `json:"tunables"`
		Reason   string             `json:"reason"`
	}
	// 理由必填：改引擎口径不留原因，事后没人知道当时为什么把便宜的排在了可靠的前面。
	// 与 093 里「不采纳必须给理由」同一个口径。
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil ||
		len(body.Tunables) == 0 || strings.TrimSpace(body.Reason) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tunables_and_reason_required"})
		return
	}
	before := matching.CurrentTunables()
	next, err := before.With(body.Tunables)
	if err != nil {
		// 被拒的尝试也留痕：有人在试越界的数，本身就是要查得出来的东西。
		s.auditWrite(r, "MATCHING_TUNABLES_UPDATE", string(ScopeMarketplace), operatoraudit.Entry{
			Outcome:    operatoraudit.OutcomeDenied,
			TargetKind: "MatchingTunables",
			Detail:     map[string]any{"reason": body.Reason, "attempted": body.Tunables, "error": err.Error()},
		})
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_tunables", "detail": err.Error()})
		return
	}
	actorID, _ := s.operatorIdentity(r)
	if actorID == "" {
		actorID = "unknown" // 表的 CHECK 不收空串；记一个 unknown 的改动人比丢掉这条更好查
	}
	beforeValues, afterValues := before.Values(), next.Values()
	changed := map[string]any{}
	for key := range body.Tunables {
		changed[key] = map[string]any{"from": beforeValues[key], "to": afterValues[key]}
	}
	versions, err := s.Matching.SetTunableOverrides(r.Context(), body.Tunables, actorID)
	if err != nil {
		log.Printf("operator matching tunables write: %v", err)
		s.auditWrite(r, "MATCHING_TUNABLES_UPDATE", string(ScopeMarketplace), operatoraudit.Entry{
			Outcome:    operatoraudit.OutcomeError,
			TargetKind: "MatchingTunables",
			Detail:     map[string]any{"reason": body.Reason, "attempted": changed, "error": "tunables_write_failed"},
		})
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "tunables_write_failed"})
		return
	}
	// 先落库、后换生效值：反过来会造出「界面说改了、库里其实没东西」的状态。
	matching.SetTunables(next)
	s.auditWrite(r, "MATCHING_TUNABLES_UPDATE", string(ScopeMarketplace), operatoraudit.Entry{
		Outcome:    operatoraudit.OutcomeOK,
		TargetKind: "MatchingTunables",
		Detail:     map[string]any{"reason": body.Reason, "changed": changed, "versions": versions},
	})
	views, warnings, err := s.matchingState(r)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "applied": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource, "applied": true, "tunables": views,
		"warnings": append(warnings, matchingDivergences(views)...),
		"note":     "只影响之后的撮合；已存的候选批次快照不重算。其他实例要下次启动才加载这份。",
	})
}

func (s *Server) operatorMatchingTrace(w http.ResponseWriter, r *http.Request) {
	if s.Matching == nil {
		notConnected("撮合决策轨迹（没有配数据库）", personalizationSpec+" §16.2")(w, r)
		return
	}
	batches, summary, err := s.Matching.DecisionTrace(r.Context(), 10)
	if err != nil {
		log.Printf("operator matching trace: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "trace_query_failed"})
		return
	}
	notes := []string{
		"读的是当时的快照：supply.candidate_batches.candidates 里连得分明细（可靠/满意/经验/响应/适配）一起存的，这里不重算",
		"有限候选集只在需求被派发时生成，所以留痕次数就是真发生过的撮合次数，不是全部需求",
	}
	if summary.Batches == 0 {
		notes = append(notes, "库里现在一次撮合留痕都没有 —— 这一页空白是事实，不是没接线")
	} else {
		notes = append(notes, "库里一共 "+strconv.Itoa(summary.Batches)+" 次留痕，最早 "+
			summary.Oldest.UTC().Format("2006-01-02")+"，最近 "+summary.Newest.UTC().Format("2006-01-02")+
			"；其中带得分明细的 "+strconv.Itoa(summary.WithRank)+" 次（早于 MATCH-RANK-001 的批次没有）")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"summary":    summary,
		"batches":    batches,
		"notes":      notes,
	})
}
