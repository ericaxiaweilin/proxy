// Package accountstatus 让举报处置「真的生效」：账号受限 / 封禁在命令边界执行。
//
// 之前举报处置只是记录（"账号已封禁"只是一行字，用户照常登录、发单、接单）。这里补上执行，
// 但刻意做得很窄、可撤销、可举证：
//
//   - 两档。RESTRICTED（受限）：不能发布内容 / 发单 / 报名 / 发消息，其余照常（含完成手上已有的订单、
//     看自己的东西）；SUSPENDED（封禁）：只剩申诉、同意管理、隐私请求（导出 / 删除）、登出这几条路。
//     封禁**不**自动取消进行中的订单——那是需要人工处理的善后，运营页会列出受影响的订单数。
//   - 每次设置 / 解除都是 append-only 的一行，带理由、操作人、关联的举报；「现在是什么状态」由最新一行推出。
//   - 申诉成立只是一个决定，不会自动解除；解除是运营明确的另一个动作（同样留痕）。
//   - 状态读不出来时放行并记日志（fail-open）：这条闸是保护性措施，数据库抖一下不该把所有人锁在外面。
package accountstatus

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

const (
	LevelRestricted = "RESTRICTED"
	LevelSuspended  = "SUSPENDED"
)

// Levels 是受支持的档位。
func Levels() []string { return []string{LevelRestricted, LevelSuspended} }

// 受限时被挡的命令：凡是「向别人发出东西」的。读、完成已有订单、申诉、隐私都不在里面。
var restrictedBlocked = map[string]bool{
	"CreatePost": true, "UpdatePostAudience": true, "CreateNeedFromPost": true,
	"PublishMarketOpportunity": true, "ApplyToMarketOpportunity": true,
	"SendMessage": true, "StartConversation": true,
	"CreateNeedDraft": true, "ConfirmNeedDraft": true,
	"RecommendStore": true,
}

// 封禁时仍然放行的命令：申诉、同意管理、隐私权利、登出。其余一律挡。
var suspendedAllowed = map[string]bool{
	"FileAppeal": true, "RecordPurposeConsent": true, "GetPurposeConsent": true,
	"RequestPrivacyExport": true, "RequestPrivacyDelete": true, "CancelPrivacyRequest": true, "GetPrivacyRequest": true,
	"RevokeSession": true, "ListMyTags": true,
}

// Blocked 报告某个档位下这条命令是否被挡。level 为空（没有限制）永远不挡。
func Blocked(level, commandType string) bool {
	switch level {
	case LevelRestricted:
		return restrictedBlocked[commandType]
	case LevelSuspended:
		return !suspendedAllowed[commandType]
	default:
		return false
	}
}

// Change 是一次设置或解除（append-only）。
type Change struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Action    string    `json:"action"` // SET | LIFT
	Level     string    `json:"level,omitempty"`
	Reason    string    `json:"reason"`
	ReportID  string    `json:"reportId,omitempty"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

// Active 是一个人当前生效的限制。
type Active struct {
	UserID   string    `json:"userId"`
	Level    string    `json:"level"`
	Reason   string    `json:"reason"`
	ReportID string    `json:"reportId,omitempty"`
	ActorID  string    `json:"actorId"`
	Since    time.Time `json:"since"`
}

var (
	ErrInvalidLevel  = errors.New("accountstatus: unknown level")
	ErrReasonNeeded  = errors.New("accountstatus: a reason is required")
	ErrActorNeeded   = errors.New("accountstatus: the operator must be identified")
	ErrNothingToLift = errors.New("accountstatus: this account has no active restriction")
	ErrUserNeeded    = errors.New("accountstatus: user id required")
)

// Store 是存储。Current 返回当前生效的限制（没有则 ok=false）。
type Store interface {
	Append(ctx context.Context, c Change) error
	Current(ctx context.Context, userID string) (Active, bool, error)
	ListActive(ctx context.Context) ([]Active, error)
}

// Service 把规则放在存储前面，并给命令边界一个带短缓存的 LevelOf。
type Service struct {
	Store Store
	Now   func() time.Time
	NewID func() string

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	level string
	at    time.Time
}

const cacheTTL = 5 * time.Second

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) id() string {
	if s.NewID != nil {
		return s.NewID()
	}
	return "acr_" + strings.ReplaceAll(s.now().Format("20060102150405.000000000"), ".", "")
}

func (s *Service) invalidate(userID string) {
	s.mu.Lock()
	delete(s.cache, userID)
	s.mu.Unlock()
}

// Set 设置或升级限制。理由必填、操作人必须署名、档位必须认识。
func (s *Service) Set(ctx context.Context, userID, level, reason, reportID, actorID string) error {
	switch {
	case strings.TrimSpace(userID) == "":
		return ErrUserNeeded
	case level != LevelRestricted && level != LevelSuspended:
		return ErrInvalidLevel
	case strings.TrimSpace(reason) == "":
		return ErrReasonNeeded
	case strings.TrimSpace(actorID) == "":
		return ErrActorNeeded
	}
	err := s.Store.Append(ctx, Change{ID: s.id(), UserID: userID, Action: "SET", Level: level, Reason: strings.TrimSpace(reason), ReportID: reportID, ActorID: actorID, CreatedAt: s.now()})
	s.invalidate(userID)
	return err
}

// Lift 解除限制。没有生效中的限制就拒绝（不写一条没意义的「解除」）。
func (s *Service) Lift(ctx context.Context, userID, reason, actorID string) error {
	switch {
	case strings.TrimSpace(userID) == "":
		return ErrUserNeeded
	case strings.TrimSpace(reason) == "":
		return ErrReasonNeeded
	case strings.TrimSpace(actorID) == "":
		return ErrActorNeeded
	}
	if _, ok, err := s.Store.Current(ctx, userID); err != nil {
		return err
	} else if !ok {
		return ErrNothingToLift
	}
	err := s.Store.Append(ctx, Change{ID: s.id(), UserID: userID, Action: "LIFT", Reason: strings.TrimSpace(reason), ActorID: actorID, CreatedAt: s.now()})
	s.invalidate(userID)
	return err
}

// LevelOf 给命令边界用：返回当前档位（空串 = 没限制）。读不出来返回 error，调用方决定放行。
func (s *Service) LevelOf(ctx context.Context, userID string) (string, error) {
	if s == nil || s.Store == nil || userID == "" {
		return "", nil
	}
	s.mu.Lock()
	if c, ok := s.cache[userID]; ok && s.now().Sub(c.at) < cacheTTL {
		s.mu.Unlock()
		return c.level, nil
	}
	s.mu.Unlock()
	a, ok, err := s.Store.Current(ctx, userID)
	if err != nil {
		return "", err
	}
	level := ""
	if ok {
		level = a.Level
	}
	s.mu.Lock()
	if s.cache == nil {
		s.cache = map[string]cached{}
	}
	s.cache[userID] = cached{level: level, at: s.now()}
	s.mu.Unlock()
	return level, nil
}

func (s *Service) ListActive(ctx context.Context) ([]Active, error) { return s.Store.ListActive(ctx) }

// Memory 是测试 / 没配库时的内存实现。
type Memory struct {
	mu      sync.Mutex
	Changes []Change
}

func (m *Memory) Append(_ context.Context, c Change) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Changes = append(m.Changes, c)
	return nil
}

func (m *Memory) latest(userID string) (Change, bool) {
	var out Change
	found := false
	for _, c := range m.Changes {
		if c.UserID == userID {
			out, found = c, true
		}
	}
	return out, found
}

func (m *Memory) Current(_ context.Context, userID string) (Active, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.latest(userID)
	if !ok || c.Action != "SET" {
		return Active{}, false, nil
	}
	return Active{UserID: userID, Level: c.Level, Reason: c.Reason, ReportID: c.ReportID, ActorID: c.ActorID, Since: c.CreatedAt}, true, nil
}

func (m *Memory) ListActive(ctx context.Context) ([]Active, error) {
	m.mu.Lock()
	seen := map[string]bool{}
	var ids []string
	for _, c := range m.Changes {
		if !seen[c.UserID] {
			seen[c.UserID] = true
			ids = append(ids, c.UserID)
		}
	}
	m.mu.Unlock()
	out := []Active{}
	for _, id := range ids {
		if a, ok, _ := m.Current(ctx, id); ok {
			out = append(out, a)
		}
	}
	return out, nil
}
