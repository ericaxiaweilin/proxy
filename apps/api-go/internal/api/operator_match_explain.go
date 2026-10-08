package api

import (
	"context"
	"log"
	"net/http"
	"strconv"

	"github.com/proxy-app/proxy-api/internal/matchengine"
)

// MatchExplainFunc 读撮合引擎的决策账：某个对象最新一次运行的全部结论，或某个人在各次运行里的结论。
type MatchExplainFunc func(ctx context.Context, kind matchengine.SubjectKind, subjectID, agentID string, limit int) ([]matchengine.Row, error)

// operatorMatchingExplain：GET /v1/operator/matching/explain?kind=OPPORTUNITY&subjectId=…[&agentId=…][&limit=…]
// 回答「为什么她没进候选 / 为什么排第 N」——读 matching.decisions，不重算。
func (s *Server) operatorMatchingExplain(w http.ResponseWriter, r *http.Request) {
	if s.MatchExplain == nil {
		notConnected("撮合决策解释（没有配数据库）", personalizationSpec+" §16.2")(w, r)
		return
	}
	q := r.URL.Query()
	kind := matchengine.SubjectKind(q.Get("kind"))
	if kind != matchengine.SubjectOpportunity && kind != matchengine.SubjectSlot {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_kind"})
		return
	}
	subject := q.Get("subjectId")
	if subject == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "subject_id_required"})
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	rows, err := s.MatchExplain(r.Context(), kind, subject, q.Get("agentId"), limit)
	if err != nil {
		log.Printf("operator matching explain: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "explain_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "rows": rows})
}
