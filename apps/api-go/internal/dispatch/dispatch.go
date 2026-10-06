// Package dispatch 是快速模式（matchingMode=FAST）的自动派单（DISPATCH-LOOP-001，2026-10-06）。
//
// 以前 FAST 这个字段存了、从来没人读：候选批次排好序以后就停在那里，等需求方自己一个个去发邀约；
// 没人接、被拒、超时，系统都不知道，运营也看不到哪张单卡住了。
//
// 现在一张需求的每个档位一条 Run，按批次的排名一次只给一个人发邀约（2026-10-06 用户定的规则）：
//
//   - 价格：只发给**标价 ≤ 需求方预算**的人，按她的标价成交；需求方发布时勾了
//     「预算内由平台替我发邀约」（autoDispatch）才派 —— 服务者一接就是已确认订单，
//     这是替需求方承诺付钱，没有同意就不做。没填预算（或按小时计价）的 FAST 单不自动派。
//   - 节奏：一次 1 人，邀约 5 分钟有效；被接 ⇒ ASSIGNED；过期 / 被撤 ⇒ 顺延下一位。
//   - 候选用完 ⇒ EXHAUSTED，进运营工作台的「待人工」。**不扩半径、不放宽时间**：
//     30km 骑摩托就是 1 小时，50km 要 2 小时；改时间等于替需求方改需求。
//
// 每一步都写一条 Step（谁、什么时候、为什么跳过），运营看到的是「这张单卡在哪」，不是一个状态码。
//
// MARKET-FAST-001（2026-10-06）：同一个引擎也管**市场发单**的快速模式（Kind = MARKET）。区别只有三处：
//   - 候选不是建单时的一份快照，而是**不断有人报名**：每一轮由 CandidateSource 按撮合排名给出
//     「还没试过的有效报名人」，排在已经试过的那些后面；
//   - 「发邀约」= 以发单方身份**选中**一位报名人，5 分钟内她确认就成单；超时由 Withdrawer 撤回选中、
//     其他报名人恢复可选，再选下一位。价格就是发单价，不比预算；
//   - 试完所有报名人不算终局：有新人报名时 Reopen 把它拉回来。发单方自己动手选了人 ⇒ 停手，不覆盖他。
package dispatch

import (
	"context"
	"errors"
	"time"
)

const (
	KindTask   = "TASK"
	KindMarket = "MARKET"
)

const (
	StatusRunning   = "RUNNING"
	StatusAssigned  = "ASSIGNED"
	StatusExhausted = "EXHAUSTED"
	StatusCancelled = "CANCELLED"
)

// Step kinds.
const (
	StepStarted         = "STARTED"
	StepOfferSent       = "OFFER_SENT"
	StepOfferRefused    = "OFFER_REFUSED" // 发邀约的命令被拒（现金门、档位已满…），detail.code 是原因
	StepExpired         = "EXPIRED"
	StepOfferCancelled  = "OFFER_CANCELLED"
	StepAccepted        = "ACCEPTED"
	StepSkippedBudget   = "SKIPPED_OVER_BUDGET"
	StepSkippedNoPrice  = "SKIPPED_NO_PRICE"
	StepSkippedSibling  = "SKIPPED_SIBLING" // 同一张需求的另一个档位正在找她 / 已经是她
	StepExhausted       = "EXHAUSTED"
	StepOperatorRetry   = "OPERATOR_RETRY"
	StepOperatorAssign  = "OPERATOR_ASSIGN"
	StepOperatorCancel  = "OPERATOR_CANCEL"
	StepSendFailed      = "SEND_FAILED" // 基础设施错误：这一位不算跳过，下一轮重试
	StepWaiting         = "WAITING_APPLICANTS"
	StepNewApplicant    = "NEW_APPLICANT"
	StepOwnerTookOver   = "OWNER_TOOK_OVER"
	OfferTTL            = 5 * time.Minute
	SystemActor         = "dispatch"
	defaultTickBatch    = 50
	maxCandidatesPerRun = 50
)

// Candidate 是批次里排好序的一位（顺序就是派单顺序）。
type Candidate struct {
	AgentID  string `json:"agentId"`
	Price    int64  `json:"price"`
	Currency string `json:"currency,omitempty"`
	// Ref 是这一位在业务里的句柄：市场单里是她的报名 id（选中 / 撤回都按它）。
	Ref string `json:"ref,omitempty"`
}

// Run 是一个档位的派单过程。
type Run struct {
	ID               string      `json:"id"`
	Kind             string      `json:"kind"` // TASK（需求档位）| MARKET（市场发单）
	TaskID           string      `json:"taskId"`
	SlotID           string      `json:"slotId"`
	RequesterID      string      `json:"requesterId"`
	BatchID          string      `json:"batchId"`
	BudgetVND        int64       `json:"budgetVnd"`
	Status           string      `json:"status"`
	Candidates       []Candidate `json:"candidates"`
	Cursor           int         `json:"cursor"` // 下一位要看的候选下标
	CurrentOfferID   string      `json:"currentOfferId,omitempty"`
	CurrentAgentID   string      `json:"currentAgentId,omitempty"`
	CurrentExpiresAt *time.Time  `json:"currentExpiresAt,omitempty"`
	AssignedAgentID  string      `json:"assignedAgentId,omitempty"`
	// Waiting：市场单还没有可选的报名人（已经记过一条 WAITING_APPLICANTS，不再重复记）。
	Waiting   bool       `json:"waiting,omitempty"`
	InvitedAt *time.Time `json:"invitedAt,omitempty"` // 最近一次主动邀请附近服务者报名的时间
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Version   int        `json:"version"`
}

// Step 是一条派单流水。
type Step struct {
	RunID   string         `json:"runId"`
	Kind    string         `json:"kind"`
	AgentID string         `json:"agentId,omitempty"`
	OfferID string         `json:"offerId,omitempty"`
	Actor   string         `json:"actor"`
	Detail  map[string]any `json:"detail,omitempty"`
	At      time.Time      `json:"at"`
}

// OfferPort 是派单对履约的两件事：替需求方发一张邀约、读一张邀约现在的状态。
// 生产实现走 fulfillment 的 CreateSlotOffer / GetOffer 命令（同一套校验：档位主人、现金门）。
type OfferPort interface {
	// Send 返回 refused != "" 表示命令被业务规则拒了（这一位跳过）；err 表示基础设施失败（下一轮重试）。
	Send(ctx context.Context, run Run, c Candidate, ttl time.Duration) (offerID string, expiresAt time.Time, refused string, err error)
	// Status 是 OFFERED / ACCEPTED / EXPIRED / CANCELLED（过期是按 TTL 推出来的）。
	Status(ctx context.Context, run Run, offerID string) (string, error)
}

// Withdrawer 是可选的：OfferPort 实现它，引擎在一张「还在等」的邀约超时后先撤回再顺延
// （市场的「选中」不会自己过期，不撤回她就还能确认，其他报名人也一直是落选状态）。
type Withdrawer interface {
	Withdraw(ctx context.Context, run Run, offerID string) error
}

// CandidateSource 是可选的：给动态候选的 Run（市场单）每一轮重新排「还没试过的」候选。
// stop != "" 表示别再派了（例如发单方自己选了人），引擎把 Run 停掉并记下原因。
type CandidateSource interface {
	Candidates(ctx context.Context, run Run, tried map[string]bool) (fresh []Candidate, stop string, err error)
}

// Repository 存 Run 与 Step。
type Repository interface {
	Create(ctx context.Context, runs []Run, steps []Step) error
	// ProcessDue 逐条锁住 RUNNING 的 Run，交给 fn 推进，并把 fn 返回的新状态与流水落库。
	// 多实例同时跑也不会重复派（PG 实现用 FOR UPDATE SKIP LOCKED）。
	ProcessDue(ctx context.Context, limit int, fn func(Run) (Run, []Step, error)) (int, error)
	Get(ctx context.Context, id string) (Run, []Step, error)
	List(ctx context.Context, statuses []string, limit int) ([]Run, error)
	TaskRuns(ctx context.Context, taskID string) ([]Run, error)
	// Save 按 version 乐观写（运营动作走这条）。
	Save(ctx context.Context, run Run, expectedVersion int, steps []Step) error
}

var (
	ErrNotFound        = errors.New("dispatch run not found")
	ErrVersionConflict = errors.New("dispatch run version conflict")
)

// Engine 推进 Run。
type Engine struct {
	Repo   Repository
	Offers OfferPort
	// Sources 按 Run.Kind 给动态候选；没有的 Kind 用建单时的快照。
	Sources map[string]CandidateSource
	Now     func() time.Time
	NewID   func() string
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

// Task 是建 Run 需要的那几样，来自刚发布的需求与它的候选批次。
type Task struct {
	TaskID       string
	RequesterID  string
	SlotIDs      []string
	MatchingMode string
	AutoDispatch bool
	BudgetVND    int64 // 只认 PER_SLOT_FIXED + VND；其它情况调用方传 0
	BatchID      string
	Candidates   []Candidate
}

// Eligible 说这张需求能不能自动派；不能时给出原因（写进日志，运营排查用）。
func (t Task) Eligible() (bool, string) {
	switch {
	case t.MatchingMode != "FAST":
		return false, "matching_mode_not_fast"
	case !t.AutoDispatch:
		return false, "requester_did_not_authorize_auto_dispatch"
	case t.BudgetVND <= 0:
		return false, "no_fixed_vnd_budget"
	case len(t.SlotIDs) == 0:
		return false, "no_slots"
	case t.BatchID == "":
		return false, "no_candidate_batch"
	}
	return true, ""
}

// Start 为每个档位建一条 Run。批次里没人也建（直接 EXHAUSTED），运营台才看得到这张单缺供给。
func (e *Engine) Start(ctx context.Context, t Task) ([]Run, error) {
	if ok, _ := t.Eligible(); !ok {
		return nil, nil
	}
	now := e.now()
	candidates := t.Candidates
	if len(candidates) > maxCandidatesPerRun {
		candidates = candidates[:maxCandidatesPerRun]
	}
	runs := make([]Run, 0, len(t.SlotIDs))
	steps := []Step{}
	for _, slot := range t.SlotIDs {
		r := Run{
			ID: e.NewID(), Kind: KindTask, TaskID: t.TaskID, SlotID: slot, RequesterID: t.RequesterID, BatchID: t.BatchID,
			BudgetVND: t.BudgetVND, Status: StatusRunning, Candidates: append([]Candidate(nil), candidates...),
			CreatedAt: now, UpdatedAt: now, Version: 1,
		}
		steps = append(steps, Step{RunID: r.ID, Kind: StepStarted, Actor: SystemActor, At: now,
			Detail: map[string]any{"candidates": len(candidates), "budgetVnd": t.BudgetVND, "batchId": t.BatchID}})
		if len(candidates) == 0 {
			r.Status = StatusExhausted
			steps = append(steps, Step{RunID: r.ID, Kind: StepExhausted, Actor: SystemActor, At: now,
				Detail: map[string]any{"reason": "no_eligible_candidates"}})
		}
		runs = append(runs, r)
	}
	return runs, e.Repo.Create(ctx, runs, steps)
}

// StartMarket 为一条快速模式的市场发单建 Run（发单方选「快速」= 同意平台代选）。
// 候选一开始是空的：报名人由 CandidateSource 每一轮现排。
func (e *Engine) StartMarket(ctx context.Context, opportunityID, ownerID string) (Run, error) {
	now := e.now()
	r := Run{ID: e.NewID(), Kind: KindMarket, TaskID: opportunityID, SlotID: "market", RequesterID: ownerID,
		BatchID: "market", Status: StatusRunning, Candidates: []Candidate{}, CreatedAt: now, UpdatedAt: now, Version: 1}
	return r, e.Repo.Create(ctx, []Run{r}, []Step{{RunID: r.ID, Kind: StepStarted, Actor: SystemActor, At: now,
		Detail: map[string]any{"kind": KindMarket}}})
}

// Reopen 在有新人报名时把一条试完了的市场单拉回在派（下一轮就会选她）。
func (e *Engine) Reopen(ctx context.Context, taskID, applicantID string) error {
	runs, err := e.Repo.TaskRuns(ctx, taskID)
	if err != nil {
		return err
	}
	for _, r := range runs {
		if r.Kind != KindMarket || r.Status != StatusExhausted {
			continue
		}
		now := e.now()
		prev := r.Version
		r.Status = StatusRunning
		r = touch(r, now)
		if err := e.Repo.Save(ctx, r, prev, []Step{{RunID: r.ID, Kind: StepNewApplicant, AgentID: applicantID, Actor: SystemActor, At: now}}); err != nil && !errors.Is(err, ErrVersionConflict) {
			return err
		}
	}
	return nil
}

// Tick 推进所有到点的 Run。
func (e *Engine) Tick(ctx context.Context) (int, error) {
	return e.Repo.ProcessDue(ctx, defaultTickBatch, func(r Run) (Run, []Step, error) {
		busy, err := e.siblingAgents(ctx, r)
		if err != nil {
			return r, nil, err
		}
		return e.advance(ctx, r, busy)
	})
}

// siblingAgents 是同一张需求其它档位正在等 / 已经定下的人：一个人不能被同一张需求派两次。
func (e *Engine) siblingAgents(ctx context.Context, r Run) (map[string]bool, error) {
	runs, err := e.Repo.TaskRuns(ctx, r.TaskID)
	if err != nil {
		return nil, err
	}
	busy := map[string]bool{}
	for _, o := range runs {
		if o.ID == r.ID {
			continue
		}
		if o.CurrentAgentID != "" {
			busy[o.CurrentAgentID] = true
		}
		if o.AssignedAgentID != "" {
			busy[o.AssignedAgentID] = true
		}
	}
	return busy, nil
}

// advance 是派单的全部规则（纯逻辑 + 两个端口调用），单元测试直接打它。
func (e *Engine) advance(ctx context.Context, r Run, busy map[string]bool) (Run, []Step, error) {
	now := e.now()
	var steps []Step
	step := func(kind, agent, offer string, detail map[string]any) {
		steps = append(steps, Step{RunID: r.ID, Kind: kind, AgentID: agent, OfferID: offer, Actor: SystemActor, Detail: detail, At: now})
	}
	if r.Status != StatusRunning {
		return r, nil, nil
	}
	if r.CurrentOfferID != "" {
		status, err := e.Offers.Status(ctx, r, r.CurrentOfferID)
		if err != nil {
			return r, nil, err
		}
		switch status {
		case "ACCEPTED":
			r.Status, r.AssignedAgentID = StatusAssigned, r.CurrentAgentID
			step(StepAccepted, r.CurrentAgentID, r.CurrentOfferID, nil)
			r.CurrentExpiresAt = nil
			return touch(r, now), steps, nil
		case "OFFERED":
			if r.CurrentExpiresAt != nil && now.Before(*r.CurrentExpiresAt) {
				return r, nil, nil // 还在等她
			}
			if w, ok := e.Offers.(Withdrawer); ok {
				if err := w.Withdraw(ctx, r, r.CurrentOfferID); err != nil {
					return r, nil, err // 撤不回就不能选下一位（否则两个人同时被选中），下一轮再试
				}
				// 撤回那一刻她恰好确认了：撤回是空操作，按派成处理，绝不再选下一位。
				if again, err := e.Offers.Status(ctx, r, r.CurrentOfferID); err != nil {
					return r, nil, err
				} else if again == "ACCEPTED" {
					r.Status, r.AssignedAgentID = StatusAssigned, r.CurrentAgentID
					step(StepAccepted, r.CurrentAgentID, r.CurrentOfferID, map[string]any{"raced": true})
					r.CurrentExpiresAt = nil
					return touch(r, now), steps, nil
				}
			}
			step(StepExpired, r.CurrentAgentID, r.CurrentOfferID, nil)
		case "CANCELLED":
			step(StepOfferCancelled, r.CurrentAgentID, r.CurrentOfferID, nil)
		default: // EXPIRED 与任何不认识的状态：都不再等
			step(StepExpired, r.CurrentAgentID, r.CurrentOfferID, map[string]any{"status": status})
		}
		r.CurrentOfferID, r.CurrentAgentID, r.CurrentExpiresAt = "", "", nil
	}
	if src, ok := e.Sources[r.Kind]; ok {
		tried := map[string]bool{}
		for _, c := range r.Candidates[:min(r.Cursor, len(r.Candidates))] {
			tried[c.AgentID] = true
		}
		fresh, stop, err := src.Candidates(ctx, r, tried)
		if err != nil {
			return r, steps, err
		}
		if stop != "" {
			r.Status = StatusCancelled
			step(StepOwnerTookOver, "", "", map[string]any{"reason": stop})
			return touch(r, now), steps, nil
		}
		r.Candidates = append(append([]Candidate{}, r.Candidates[:min(r.Cursor, len(r.Candidates))]...), fresh...)
		if r.Cursor >= len(r.Candidates) && r.Cursor == 0 {
			// 还没人报名：保持在派，只在第一次记一条，不刷流水。
			if !r.Waiting {
				r.Waiting = true
				step(StepWaiting, "", "", nil)
				return touch(r, now), steps, nil
			}
			if len(steps) > 0 {
				return touch(r, now), steps, nil
			}
			return r, nil, nil
		}
		r.Waiting = false
	}
	market := r.Kind == KindMarket
	for r.Cursor < len(r.Candidates) {
		c := r.Candidates[r.Cursor]
		switch {
		case !market && c.Price <= 0:
			r.Cursor++
			step(StepSkippedNoPrice, c.AgentID, "", nil)
			continue
		case !market && c.Price > r.BudgetVND:
			r.Cursor++
			step(StepSkippedBudget, c.AgentID, "", map[string]any{"price": c.Price, "budgetVnd": r.BudgetVND})
			continue
		case busy[c.AgentID]:
			r.Cursor++
			step(StepSkippedSibling, c.AgentID, "", nil)
			continue
		}
		offerID, expiresAt, refused, err := e.Offers.Send(ctx, r, c, OfferTTL)
		if err != nil {
			// 不前移游标：下一轮还是她。流水留一条，免得「一直卡在发送」看不出来。
			step(StepSendFailed, c.AgentID, "", map[string]any{"error": err.Error()})
			return touch(r, now), steps, nil
		}
		r.Cursor++
		if refused != "" {
			step(StepOfferRefused, c.AgentID, "", map[string]any{"code": refused})
			continue
		}
		exp := expiresAt.UTC()
		r.CurrentOfferID, r.CurrentAgentID, r.CurrentExpiresAt = offerID, c.AgentID, &exp
		step(StepOfferSent, c.AgentID, offerID, map[string]any{"price": c.Price, "expiresAt": exp.Format(time.RFC3339)})
		return touch(r, now), steps, nil
	}
	r.Status = StatusExhausted
	step(StepExhausted, "", "", map[string]any{"reason": "all_candidates_tried"})
	return touch(r, now), steps, nil
}

func touch(r Run, now time.Time) Run {
	r.UpdatedAt = now
	r.Version++
	return r
}

// ---- 运营动作 ----

// Retry 把一条 EXHAUSTED / CANCELLED 的 Run 从头再派一遍（之前没空的人现在可能有空了）。
func (e *Engine) Retry(ctx context.Context, id, operator, reason string) (Run, error) {
	r, _, err := e.Repo.Get(ctx, id)
	if err != nil {
		return Run{}, err
	}
	if r.Status != StatusExhausted && r.Status != StatusCancelled {
		return r, errors.New("only an exhausted or cancelled run can be retried")
	}
	now := e.now()
	prev := r.Version
	r.Status, r.Cursor = StatusRunning, 0
	r.CurrentOfferID, r.CurrentAgentID, r.CurrentExpiresAt = "", "", nil
	r = touch(r, now)
	return r, e.Repo.Save(ctx, r, prev, []Step{{RunID: r.ID, Kind: StepOperatorRetry, Actor: operator, At: now, Detail: map[string]any{"reason": reason}}})
}

// Cancel 停止自动派单（需求方改主意、运营要人工接管）。已经发出去的那张邀约照常有效到过期。
func (e *Engine) Cancel(ctx context.Context, id, operator, reason string) (Run, error) {
	r, _, err := e.Repo.Get(ctx, id)
	if err != nil {
		return Run{}, err
	}
	if r.Status == StatusAssigned || r.Status == StatusCancelled {
		return r, errors.New("run is already assigned or cancelled")
	}
	now := e.now()
	prev := r.Version
	r.Status = StatusCancelled
	r = touch(r, now)
	return r, e.Repo.Save(ctx, r, prev, []Step{{RunID: r.ID, Kind: StepOperatorCancel, Actor: operator, At: now, Detail: map[string]any{"reason": reason}}})
}

// Assign 让运营点名一位：把她插到下一位，立刻发邀约（规则不变：仍需标价 ≤ 预算）。
func (e *Engine) Assign(ctx context.Context, id string, c Candidate, operator, reason string) (Run, []Step, error) {
	r, _, err := e.Repo.Get(ctx, id)
	if err != nil {
		return Run{}, nil, err
	}
	if r.Status == StatusAssigned {
		return r, nil, errors.New("run is already assigned")
	}
	if r.CurrentOfferID != "" {
		return r, nil, errors.New("an offer is still waiting; cancel or let it expire first")
	}
	// 点名也守同一条规则：替需求方承诺的钱不能超过他给的预算（市场单的价格就是发单价，不比预算）。
	if r.Kind != KindMarket && (c.Price <= 0 || c.Price > r.BudgetVND) {
		return r, nil, errors.New("the chosen agent's price must be within the requester's budget")
	}
	now := e.now()
	prev := r.Version
	r.Status = StatusRunning
	head := append([]Candidate{}, r.Candidates[:r.Cursor]...)
	r.Candidates = append(append(head, c), r.Candidates[r.Cursor:]...)
	pre := Step{RunID: r.ID, Kind: StepOperatorAssign, AgentID: c.AgentID, Actor: operator, At: now, Detail: map[string]any{"reason": reason}}
	busy, err := e.siblingAgents(ctx, r)
	if err != nil {
		return r, nil, err
	}
	next, steps, err := e.advance(ctx, r, busy)
	if err != nil {
		return r, nil, err
	}
	if next.Version == r.Version {
		next = touch(next, now)
	}
	all := append([]Step{pre}, steps...)
	return next, all, e.Repo.Save(ctx, next, prev, all)
}
