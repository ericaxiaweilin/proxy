// Package matchengine 是撮合引擎的**内部 API**：把 PRD 第 5 章的主链做成一个有明确阶段、可审计、可解释的东西。
//
//	Subject（一张单 / 一个档位）
//	  → Retrieval（候选池，由调用方给）
//	  → Eligibility Gates（硬过滤，逐个 Gate 给出通过 / 不通过 + 原因码）
//	  → Qualified Pool
//	  → Organic Ranking（internal/matching 的公式，旋钮可调）
//	  → Candidate Set Construction（有限集合 + 新人探索位 + 匹配理由）
//	  → Snapshot + Audit（每个候选、每个阶段的结论都落账）
//
// 为什么要有这一层：之前排序公式（matching）和资格判断（散在 supply.evaluateEligibility / 市场邀请里）各自为政，
// 「为什么没邀请她」「为什么排第三」「这次撮合用的是哪一版旋钮」都答不出来，撮合管理无从谈起。
// 这里把它们收成一条主链：硬过滤的每一道门都是独立的 Gate（可增可减、可单测），不通过的人也留记录（带原因码），
// 排名带版本，整次运行是一个 Snapshot，后台能按 snapshot / 单 / 人回放。
//
// 不做的事（PRD 的 P1，先不假装有）：学习排序、团队组合、动态探索预算、赞助调整。
package matchengine

import (
	"context"
	"sort"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

// SubjectKind 区分撮合的对象。
type SubjectKind string

const (
	SubjectOpportunity SubjectKind = "OPPORTUNITY" // 市场发单
	SubjectSlot        SubjectKind = "SLOT"        // 需求档位（task 路径）
)

// Subject 是被撮合的那一件事。
type Subject struct {
	Kind        SubjectKind
	ID          string
	RequesterID string
	Lat, Lng    *float64
	BudgetVND   int64
}

// Candidate 是候选池里的一个人（调用方检索出来的）。
type Candidate struct {
	AgentID string
	Price   int64
	Signals matching.Signals
}

// GateResult 是一道门对一个人的结论。Unknown=true 表示「这道门的依据读不到」——按规则不通过（fail-closed），
// 但原因要和「真的不合格」区分开。
type GateResult struct {
	Pass    bool
	Reason  string // 原因码，Pass 时为空
	Unknown bool
}

// Gate 是一道资格门（PRD 第 5 章 §6–§27 的各类 Eligibility）。
type Gate interface {
	ID() string
	Evaluate(ctx context.Context, s Subject, c Candidate) GateResult
}

// 原因码（PRD §29）。新增原因码要同时进文档和运营页的翻译表。
const (
	ReasonSelf              = "SELF"
	ReasonAlreadyApplied    = "ALREADY_APPLIED"
	ReasonAlreadyInvited    = "ALREADY_INVITED"
	ReasonAccountRestricted = "ACCOUNT_RESTRICTED"
	ReasonSafetyBlocked     = "SAFETY_BLOCKED"
	ReasonNoOrderPermission = "NO_ORDER_PERMISSION"
	ReasonUserBlocked       = "USER_BLOCKED"
	ReasonLocationUnknown   = "LOCATION_UNKNOWN"
	ReasonOutOfRadius       = "OUT_OF_RADIUS"
	ReasonGateUnavailable   = "GATE_UNAVAILABLE"
)

// Ineligible 是一个没过门的人。
type Ineligible struct {
	AgentID string `json:"agentId"`
	Gate    string `json:"gate"`
	Reason  string `json:"reason"`
	Unknown bool   `json:"unknown,omitempty"`
}

// Entry 是候选集里的一个人。
type Entry struct {
	Rank        int                `json:"rank"`
	AgentID     string             `json:"agentId"`
	Price       int64              `json:"price,omitempty"`
	Breakdown   matching.Breakdown `json:"breakdown"`
	Exploration bool               `json:"exploration,omitempty"` // 新人探索位，不是按分数进来的
	Reasons     []string           `json:"reasons"`               // 给人看的匹配理由码，不是黑盒分数
}

// SupplyHealth 回答「这次撮合的供给够不够」：多少人进来、多少人过了、卡在哪。
type SupplyHealth struct {
	Retrieved  int            `json:"retrieved"`
	Qualified  int            `json:"qualified"`
	CandidateN int            `json:"candidateSet"`
	ByReason   map[string]int `json:"ineligibleByReason"`
	Thin       bool           `json:"thin"`  // 合格的人不够填满候选集
	Empty      bool           `json:"empty"` // 一个合格的都没有
}

// Result 是一次运行的全部结论（Snapshot）。
type Result struct {
	SnapshotID   string       `json:"snapshotId"`
	RankVersion  string       `json:"rankVersion"`
	Subject      Subject      `json:"-"`
	CreatedAt    time.Time    `json:"createdAt"`
	Qualified    []Entry      `json:"qualified"`
	CandidateSet []Entry      `json:"candidateSet"`
	Ineligible   []Ineligible `json:"ineligible"`
	Health       SupplyHealth `json:"supplyHealth"`
}

// Decision 是落账的一行：一个人在一次运行里的结论。
type Decision struct {
	SnapshotID  string
	SubjectKind SubjectKind
	SubjectID   string
	AgentID     string
	Eligible    bool
	Gate        string // 没过的那道门；过了为空
	Reason      string
	OrganicRank int // 合格者的名次，从 1 起；不合格 0
	InSet       bool
	Exploration bool
	RankVersion string
	CreatedAt   time.Time
}

// Recorder 把 Decision 落账。失败不影响撮合结果（审计是旁路，但失败要有声音，见 Engine.OnAuditError）。
type Recorder interface {
	Record(ctx context.Context, decisions []Decision) error
}

// Engine 是撮合引擎。Gates 的顺序就是评估顺序，第一道不通过就停（原因码是第一个失败的门）。
type Engine struct {
	Gates []Gate
	// SetSize 是候选集上限（PRD §68：有限集合，不无限下拉）。
	SetSize int
	// Tunables 取旋钮快照；nil = matching.CurrentTunables。
	Tunables func() matching.Tunables
	Recorder Recorder
	NewID    func() string
	Now      func() time.Time
	// OnAuditError 在落账失败时被调用（记日志 / 计数）。
	OnAuditError func(error)
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

// RankVersion 标识这次排名用的公式 + 旋钮：公式版本 + 当前旋钮里和排名相关的数的指纹。
// 同一个版本号 = 同样的输入给出同样的名次，回放时靠它判断「当时的口径还是不是现在的」。
func RankVersion(t matching.Tunables) string {
	h := uint32(2166136261)
	for _, v := range []float64{t.ReliabilityWeight, t.SatisfactionWeight, t.ExperienceWeight, t.ResponseWeight, t.FitPoints, t.DistanceWeight,
		t.RadiusKm, t.NewcomerBoost, t.NewcomerOrders, t.LoadPenaltyPerJob, t.LoadPenaltyCap, t.TagFitWeight} {
		h = (h ^ uint32(int64(v*1000))) * 16777619
	}
	return "rank-v1-" + strconv.FormatUint(uint64(h), 36)
}

// Run 跑一遍主链。candidates 是检索出来的候选池。
func (e *Engine) Run(ctx context.Context, subject Subject, candidates []Candidate) Result {
	tun := matching.CurrentTunables()
	if e.Tunables != nil {
		tun = e.Tunables()
	}
	size := e.SetSize
	if size <= 0 {
		size = 5
	}
	now := e.now()
	res := Result{Subject: subject, CreatedAt: now, RankVersion: RankVersion(tun), Ineligible: []Ineligible{},
		Health: SupplyHealth{Retrieved: len(candidates), ByReason: map[string]int{}}}
	if e.NewID != nil {
		res.SnapshotID = e.NewID()
	} else {
		res.SnapshotID = "ms_" + strconv.FormatInt(now.UnixNano(), 36)
	}

	var qualified []Candidate
	for _, c := range candidates {
		failed := false
		for _, g := range e.Gates {
			r := g.Evaluate(ctx, subject, c)
			if r.Pass {
				continue
			}
			res.Ineligible = append(res.Ineligible, Ineligible{AgentID: c.AgentID, Gate: g.ID(), Reason: r.Reason, Unknown: r.Unknown})
			res.Health.ByReason[r.Reason]++
			failed = true
			break
		}
		if !failed {
			qualified = append(qualified, c)
		}
	}
	res.Health.Qualified = len(qualified)

	// Organic ranking：同一套公式、同一份旋钮快照给整个批次打分。
	ids := make([]string, 0, len(qualified))
	prices := map[string]int64{}
	signals := map[string]matching.Signals{}
	byID := map[string]Candidate{}
	for _, c := range qualified {
		ids = append(ids, c.AgentID)
		prices[c.AgentID] = c.Price
		signals[c.AgentID] = c.Signals
		byID[c.AgentID] = c
	}
	ranked := tun.Rank(ids, prices, signals, subject.BudgetVND)
	for i, r := range ranked {
		res.Qualified = append(res.Qualified, Entry{Rank: i + 1, AgentID: r.AgentID, Price: r.Price, Breakdown: r.Breakdown, Reasons: ReasonsFor(r.Breakdown)})
	}

	res.CandidateSet = buildSet(res.Qualified, byID, tun, size)
	res.Health.CandidateN = len(res.CandidateSet)
	res.Health.Empty = len(qualified) == 0
	res.Health.Thin = len(qualified) < size

	e.record(ctx, res)
	return res
}

// buildSet 取前 size 名；若前 size 里没有任何新人、而合格池里有新人，把最后一名换成分数最高的新人（PRD §48 探索位）。
// 探索位是确定性的（分数最高的新人），不是随机——可复现、可解释。新人的定义见 matching 旋钮 NewcomerOrders。
func buildSet(qualified []Entry, byID map[string]Candidate, tun matching.Tunables, size int) []Entry {
	if len(qualified) <= size {
		return append([]Entry(nil), qualified...)
	}
	set := append([]Entry(nil), qualified[:size]...)
	isNew := func(id string) bool {
		return tun.NewcomerOrders > 0 && float64(byID[id].Signals.Completed) < tun.NewcomerOrders
	}
	for _, en := range set {
		if isNew(en.AgentID) {
			return set // 前面已经有新人了，不需要探索位
		}
	}
	for _, en := range qualified[size:] {
		if isNew(en.AgentID) {
			en.Exploration = true
			en.Reasons = append([]string{"EXPLORATION_SLOT"}, en.Reasons...)
			set[size-1] = en
			break
		}
	}
	for i := range set {
		set[i].Rank = i + 1
	}
	return set
}

// ReasonsFor 把分项变成给人看的匹配理由码（PRD §78 §79：给理由，不给黑盒分数）。取贡献最大的两项。
func ReasonsFor(b matching.Breakdown) []string {
	type part struct {
		code string
		v    float64
	}
	parts := []part{{"RELIABLE", b.Reliability}, {"WELL_RATED", b.Satisfaction}, {"EXPERIENCED", b.Experience}, {"RESPONSIVE", b.Response},
		{"WITHIN_BUDGET", b.Fit}, {"NEARBY", b.Distance}, {"NEWCOMER", b.NewcomerBoost}, {"COMMON_INTERESTS", b.TagFit}}
	sort.SliceStable(parts, func(i, j int) bool { return parts[i].v > parts[j].v })
	out := []string{}
	for _, p := range parts {
		if p.v > 0 && len(out) < 2 {
			out = append(out, p.code)
		}
	}
	return out
}

func (e *Engine) record(ctx context.Context, res Result) {
	if e.Recorder == nil {
		return
	}
	inSet := map[string]Entry{}
	for _, en := range res.CandidateSet {
		inSet[en.AgentID] = en
	}
	var rows []Decision
	for _, en := range res.Qualified {
		set, in := inSet[en.AgentID]
		rows = append(rows, Decision{SnapshotID: res.SnapshotID, SubjectKind: res.Subject.Kind, SubjectID: res.Subject.ID, AgentID: en.AgentID,
			Eligible: true, OrganicRank: en.Rank, InSet: in, Exploration: set.Exploration, RankVersion: res.RankVersion, CreatedAt: res.CreatedAt})
	}
	for _, ig := range res.Ineligible {
		rows = append(rows, Decision{SnapshotID: res.SnapshotID, SubjectKind: res.Subject.Kind, SubjectID: res.Subject.ID, AgentID: ig.AgentID,
			Gate: ig.Gate, Reason: ig.Reason, RankVersion: res.RankVersion, CreatedAt: res.CreatedAt})
	}
	if err := e.Recorder.Record(ctx, rows); err != nil && e.OnAuditError != nil {
		e.OnAuditError(err)
	}
}
