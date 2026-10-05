package matching

import (
	"context"
	"encoding/json"
	"time"
)

// TraceBatch 是一次撮合的留痕：当时有哪些候选、每个人按什么数排在哪。
//
// 为什么这个能是真的：supply.candidate_batches 从建表起就把整份候选快照写进
// candidates JSONB，其中 ranking 就是 Breakdown 全字段（MATCH-RANK-001 加的）。
// 换句话说「引擎当时为什么这么排」一直有落库，只是从来没有一个地方能看到 ——
// 只能等用户投诉撮合不公之后去 psql 里翻 JSON。
//
// 这里**不重算**：读的是当时存下来的那份。事后信号变了、旋钮也变了，重算出来的
// 不是当时那个决定（快照的意义就在于此，见 supply.Candidate 的注释）。
type TraceBatch struct {
	BatchID        string           `json:"batchId"`
	NeedID         string           `json:"needId"`
	MarketID       string           `json:"marketId"`
	CreatedAt      time.Time        `json:"createdAt"`
	Shortage       bool             `json:"shortage"`
	ShortageNote   string           `json:"shortageNote,omitempty"`
	CandidateCount int              `json:"candidateCount"`
	Candidates     []TraceCandidate `json:"candidates"`
}

// TraceCandidate 是快照里的一个候选（只取解释排序需要的字段，不把整份 JSON 摊上去）。
type TraceCandidate struct {
	AgentID        string     `json:"agentId"`
	Name           string     `json:"name"`
	ServiceType    string     `json:"serviceType"`
	ReferencePrice int64      `json:"referencePrice"`
	Currency       string     `json:"currency"`
	RankingReason  string     `json:"rankingReason"`
	Ranking        *Breakdown `json:"ranking,omitempty"`
}

// TraceSummary 是这批留痕的盘子有多大 —— 空表必须说得出「库里到底有几次撮合」，
// 不然运营分不清「这一页没接」和「接了但确实没数据」。
type TraceSummary struct {
	Batches  int       `json:"batches"`
	Newest   time.Time `json:"newest,omitempty"`
	Oldest   time.Time `json:"oldest,omitempty"`
	WithRank int       `json:"batchesWithRanking"`
}

// DecisionTrace 读最近的撮合留痕（运营控制台只读，MARKETPLACE scope）。
func (p *Postgres) DecisionTrace(ctx context.Context, limit int) ([]TraceBatch, TraceSummary, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var summary TraceSummary
	// 「带得分明细」那一项要先确认 candidates 真的是数组：MATCH-RANK-001 之前存的
	// 批次里有过不是数组的形状，`$[*]` 直接怼上去会让整条统计报错，一行的形状问题
	// 不该让整页读不出来（跟「一条坏媒体不能抹掉整个 feed」同一条规矩）。
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MIN(created_at), to_timestamp(0)), COALESCE(MAX(created_at), to_timestamp(0)),
			COUNT(*) FILTER (WHERE jsonb_typeof(candidates) = 'array' AND EXISTS (
				SELECT 1 FROM jsonb_array_elements(candidates) c
				WHERE jsonb_typeof(c) = 'object' AND c ? 'ranking'))
		FROM supply.candidate_batches`).
		Scan(&summary.Batches, &summary.Oldest, &summary.Newest, &summary.WithRank)
	if err != nil {
		return nil, TraceSummary{}, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, need_id, COALESCE(market_id, ''), created_at, COALESCE(shortage, false), COALESCE(shortage_note, ''), candidates
		FROM supply.candidate_batches ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, TraceSummary{}, err
	}
	defer rows.Close()
	var out []TraceBatch
	for rows.Next() {
		var (
			b   TraceBatch
			raw []byte
		)
		if err := rows.Scan(&b.BatchID, &b.NeedID, &b.MarketID, &b.CreatedAt, &b.Shortage, &b.ShortageNote, &raw); err != nil {
			return nil, TraceSummary{}, err
		}
		// 一份 malformed 的候选 JSON 不该把整页抹掉（那是别的批次的事），
		// 但也不能静默吞掉 —— 记成「0 个候选」，界面按快照读不出来显示。
		var stored []TraceCandidate
		if err := json.Unmarshal(raw, &stored); err == nil {
			b.Candidates = stored
			b.CandidateCount = len(stored)
		}
		out = append(out, b)
	}
	return out, summary, rows.Err()
}
