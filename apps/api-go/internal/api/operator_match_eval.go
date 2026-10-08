package api

import (
	"context"
	"log"
	"net/http"
	"sort"
	"time"

	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/matching"
)

// OPS-MATCH-EVAL-001：撮合引擎怎么验证——离线回放。
//
//	GET /v1/operator/matching-eval?days=90
//
// 问的问题：发单方在多个报名人里**自己挑**的那个人，引擎会把他排第几？
//
//	· top-1 一致率：引擎排第一的人 = 发单方挑的人，占比多少；
//	· 平均倒数名次（MRR）：挑中的人在引擎排序里的名次倒数的均值（1 = 总是排第一）；
//	· 中位名次。
//
// 这不等于「引擎好」——发单方可能受照片、聊天等引擎看不到的东西影响，一致率 100% 反而可疑。
// 它是**对账**：一致率很低说明引擎看重的和人看重的差得远，值得去看是哪一项分在拖；很高才说明排序没有离谱。
//
// 诚实的局限（写进响应，页面照着显示）：
//  1. 用的是**此刻**的信号重算名次，不是当时选人那一刻的快照（市场路径没有快照）；
//  2. 只统计有 ≥2 个仍有效的报名、且已经选定了人的单；
//  3. 样本少于 MinSample 时不给任何百分比——几条记录的比例没有意义。
const evalMinSample = 30

type EvalCase = insight.EvalCase

type MatchEvalSource interface {
	Cases(ctx context.Context, since time.Time, limit int) ([]EvalCase, error)
	Rank(ctx context.Context, c EvalCase) ([]matching.Ranked, error)
}

type MatchEval struct {
	WindowDays    int      `json:"windowDays"`
	Evaluated     int      `json:"evaluated"`
	MinSample     int      `json:"minSample"`
	Enough        bool     `json:"enough"`
	Top1Agreement *float64 `json:"top1Agreement"`
	MRR           *float64 `json:"meanReciprocalRank"`
	MedianRank    *float64 `json:"medianRank"`
	// RankHistogram[i] = 挑中的人在引擎里排第 i+1 名的单数（最多到第 5 名，其后归入 6+）。
	RankHistogram []int `json:"rankHistogram"`
}

// ComputeMatchEval 是纯函数：给每个案例的名次，算指标。
func ComputeMatchEval(ranks []int, days int) MatchEval {
	ev := MatchEval{WindowDays: days, Evaluated: len(ranks), MinSample: evalMinSample, RankHistogram: make([]int, 6)}
	for _, r := range ranks {
		idx := r - 1
		if idx > 5 {
			idx = 5
		}
		ev.RankHistogram[idx]++
	}
	if len(ranks) < evalMinSample {
		return ev
	}
	ev.Enough = true
	var top1, rr float64
	sorted := append([]int(nil), ranks...)
	sort.Ints(sorted)
	for _, r := range ranks {
		if r == 1 {
			top1++
		}
		rr += 1 / float64(r)
	}
	n := float64(len(ranks))
	round := func(v float64) *float64 { x := float64(int(v*1000+0.5)) / 1000; return &x }
	ev.Top1Agreement, ev.MRR = round(top1/n), round(rr/n)
	mid := float64(sorted[len(sorted)/2])
	if len(sorted)%2 == 0 {
		mid = float64(sorted[len(sorted)/2-1]+sorted[len(sorted)/2]) / 2
	}
	ev.MedianRank = round(mid)
	return ev
}

func (s *Server) operatorMatchingEval(w http.ResponseWriter, r *http.Request) {
	if s.MatchEval == nil {
		notConnected("撮合评估（没有配数据库）", personalizationSpec+" §16 §18")(w, r)
		return
	}
	days := 90
	cases, err := s.MatchEval.Cases(r.Context(), time.Now().UTC().Add(-time.Duration(days)*24*time.Hour), 500)
	if err != nil {
		log.Printf("operator matching eval: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "matching_eval_failed"})
		return
	}
	ranks := make([]int, 0, len(cases))
	for _, c := range cases {
		ranked, err := s.MatchEval.Rank(r.Context(), c)
		if err != nil {
			continue
		}
		for i, rk := range ranked {
			if rk.AgentID == c.Chosen {
				ranks = append(ranks, i+1)
				break
			}
		}
	}
	ev := ComputeMatchEval(ranks, days)
	notes := []string{
		"这是对账，不是打分：发单方挑的人 vs 引擎排第几。一致率低说明引擎看重的和人看重的差得远；高也不代表引擎就对——人也会受引擎看不到的东西影响。",
		"名次用的是此刻的信号重算的，不是当时选人那一刻的快照（市场路径没有快照）；只统计至少有 2 个有效报名且已经选定了人的单。",
	}
	if !ev.Enough {
		notes = append(notes, "样本不足（少于 30 单）：不给百分比，几条记录算出来的比例没有意义。等有更多「多人报名、已选定」的单再看。")
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "eval": ev, "notes": notes})
}
