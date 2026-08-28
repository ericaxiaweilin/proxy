package media

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

// MediaReviewDecision 记录每一次 content review 决策的不可篡改审计行。
// R15.18 引入:之前决策只写 asset.LastError 字串,难查。现在持久化到
// media_review_decisions 表 (Postgres) 或 in-memory list (测试),
// operator 透过 ListMediaReviewDecisions 命令查。
//
// 不可变:Append-only,没有 Update / Delete。一旦写入,只能被后续
// 决策 (e.g. unblock) 覆盖语义,不删历史。
type MediaReviewDecision struct {
	DecisionID   string    `json:"decisionId"`
	MediaAssetID string    `json:"mediaAssetId"`
	FromStatus   string    `json:"fromStatus"`            // 来源 ModerationStatus
	ToStatus     string    `json:"toStatus"`              // 目标 ModerationStatus
	Reason       string    `json:"reason"`                // APPROVE / REJECT_NUDITY / ...
	Note         string    `json:"note,omitempty"`        // operator 自由文本
	OperatorID   string    `json:"operatorId"`            // principal.ID 谁点的
	ReviewedAt   time.Time `json:"reviewedAt"`            // server clock, 不可编
}

// ReviewDecisionRepository 由 Service 持有,负责持久化决策行。
// 接口隔离: 跟主 Repository interface 分开,这样 fakes / mock 不必
// 关心决策存储。
type ReviewDecisionRepository interface {
	// AppendReviewDecision 把决策追加到决策日志,失败不阻塞 (只是审计丢失)。
	// 失败原因: 内部 error。调用方应 log 但不 fail the command。
	AppendReviewDecision(ctx context.Context, d MediaReviewDecision) error
	// ListReviewDecisions 按 mediaAssetID 过滤 (空 = 全部),按 reviewedAt 倒序。
	ListReviewDecisions(ctx context.Context, mediaAssetID string, limit int) ([]MediaReviewDecision, error)
}

var (
	ErrReviewDecisionNotFound = errors.New("media review decision not found")
)

// ---------- In-Memory 实现 (单测 / 演示) ----------

type MemoryReviewDecisionRepository struct {
	mu        sync.Mutex
	decisions []MediaReviewDecision
}

func NewMemoryReviewDecisionRepository() *MemoryReviewDecisionRepository {
	return &MemoryReviewDecisionRepository{}
}

func (r *MemoryReviewDecisionRepository) AppendReviewDecision(_ context.Context, d MediaReviewDecision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if d.DecisionID == "" {
		return errors.New("decision id is required")
	}
	if d.MediaAssetID == "" {
		return errors.New("media asset id is required")
	}
	// Append-only: 不允许覆盖,每行 ID 必须唯一。
	for _, existing := range r.decisions {
		if existing.DecisionID == d.DecisionID {
			return errors.New("decision id already exists")
		}
	}
	r.decisions = append(r.decisions, d)
	return nil
}

func (r *MemoryReviewDecisionRepository) ListReviewDecisions(_ context.Context, mediaAssetID string, limit int) ([]MediaReviewDecision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := make([]MediaReviewDecision, 0, len(r.decisions))
	for _, d := range r.decisions {
		if mediaAssetID == "" || d.MediaAssetID == mediaAssetID {
			filtered = append(filtered, d)
		}
	}
	// 倒序 (最新在前)。
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].ReviewedAt.After(filtered[j].ReviewedAt)
	})
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[:limit]
	}
	return filtered, nil
}

// Snapshot 用于 audit 导出 / 测试。
func (r *MemoryReviewDecisionRepository) Snapshot() []MediaReviewDecision {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]MediaReviewDecision, len(r.decisions))
	copy(out, r.decisions)
	return out
}
