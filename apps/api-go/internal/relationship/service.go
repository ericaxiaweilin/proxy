// Package relationship — R18.x FRIEND-001.
//
// The mobile "我的 → 好友与关系" surface (FriendCrmSurface
// in apps/mobile/src/surfaces/friend-crm.tsx) was entirely
// hardcoded mock data: 4 fake friends, 2 fake pending
// requests, 3 fake contact matches, 2 fake social matches.
// Add / accept / ignore all mutated local React state only.
// This package implements the server side so the surface
// can be wired through RelationshipClient like the other
// domain clients (BusinessClient, SocialSettingsClient).
//
// Design notes:
//  - The Friendship type already exists in crm.go (it
//    declared State PENDING / FRIEND / BLOCKED plus the
//    truth-vs-metadata split from Master §9.3). We keep
//    those types and add a Service + Repository.
//  - We model "user IDs" as opaque strings, exactly like
//    the rest of the API. The "display name" comes from a
//    peer fetch; for now the mobile surface will project
//    the user id when a name is missing.
//  - "Send friend request" is symmetric: the requester
//    creates a Friendship row with state=PENDING. The
//    target can Accept (→ FRIEND) or Block (→ BLOCKED).
//  - "List my friends" returns two buckets: pending
//    (incoming — where the actor is UserB), and active
//    (FRIEND state, any direction).
//  - All commands are USER-only; ANONYMOUS is rejected.

package relationship

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type FriendshipStatus string

const (
	FriendshipPending FriendshipStatus = "PENDING"
	FriendshipFriend  FriendshipStatus = "FRIEND"
	FriendshipBlocked FriendshipStatus = "BLOCKED"
)

// FriendshipRecord is the persisted row. UserA is always
// the lexically smaller id so (A,B) and (B,A) collapse to
// a single row. RequesterID is the user who initiated the
// most recent state change; the API rewrites it on accept
// and on a new request after a previous block.
type FriendshipRecord struct {
	ID           string           `json:"id"`
	UserA        string           `json:"userA"`
	UserB        string           `json:"userB"`
	State        FriendshipStatus `json:"state"`
	RequesterID  string           `json:"requesterId"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
}

// DisplayNameHint lets a caller attach a project-side
// display name (from /identity/profile or similar) so the
// list response can include "Mai · PX-482167" without a
// second round-trip. Optional.
type DisplayNameHint struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	City        string `json:"city"`
}

type FriendView struct {
	UserID      string           `json:"userId"`
	Direction   string           `json:"direction"` // OUTGOING | INCOMING | MUTUAL
	State       FriendshipStatus `json:"state"`
	DisplayName string           `json:"displayName"`
	City        string           `json:"city"`
	Since       time.Time        `json:"since"`
}

type ListFriendshipsPayload struct {
	Active  []FriendView `json:"active"`
	Pending []FriendView `json:"pending"`
}

type Repository interface {
	// UpsertFriendship writes the (UserA,UserB) row,
	// overwriting any previous state. Returns the saved row.
	UpsertFriendship(ctx context.Context, rec FriendshipRecord) (FriendshipRecord, error)
	// GetFriendship returns the row for the unordered pair.
	// Returns ErrFriendshipNotFound when no row exists.
	GetFriendship(ctx context.Context, userA, userB string) (FriendshipRecord, error)
	// ListByUser returns every row that includes the user.
	ListByUser(ctx context.Context, userID string) ([]FriendshipRecord, error)
}

type DisplayNameResolver func(ctx context.Context, userID string) (DisplayNameHint, bool)

// ErrFriendshipNotFound is the typed not-found error.
var ErrFriendshipNotFound = errors.New("friendship not found")

type Service struct {
	mu          sync.Mutex
	repo        Repository
	clock       clock.Clock
	resolveName DisplayNameResolver
	// cannotFriendTarget 识别不能成为双向好友的账号（当前是平台 AI）。
	// 注入而不是 relationship import aipersona：好友域不该知道 AI 目录的形状，
	// 它只需要知道"这个目标不能创建 PENDING"。生产接线在 cmd/api/main.go。
	cannotFriendTarget func(targetUserID string) bool
	// targetAccountExists 报告目标账号在 identity 域里是否真实存在。
	// 同样是窄函数注入：好友域只需要知道"这个目标能不能收到申请"，
	// 不需要知道账号表的形状。生产接线在 cmd/api/main.go。
	targetAccountExists func(ctx context.Context, targetUserID string) bool
}

func New() *Service {
	return &Service{clock: clock.System{}}
}

func NewWithRepository(repo Repository) *Service {
	return &Service{repo: repo, clock: clock.System{}}
}

func (s *Service) SetRepository(repo Repository)    { s.repo = repo }
// SetCannotFriendTarget 接上"不能成为双向好友"的账号目录（平台 AI）。
// nil = 不做额外分类；生产必须接（check-regression-contracts.sh 反向钉）。
func (s *Service) SetCannotFriendTarget(fn func(targetUserID string) bool) { s.cannotFriendTarget = fn }

// SetTargetAccountExists 接上"目标账号是否存在"的判定（identity.user_accounts）。
// nil = 不检查；生产必须接（check-regression-contracts.sh 反向钉）。
func (s *Service) SetTargetAccountExists(fn func(ctx context.Context, targetUserID string) bool) {
	s.targetAccountExists = fn
}
func (s *Service) SetDisplayNameResolver(r DisplayNameResolver) {
	s.resolveName = r
}

func (s *Service) Supports(t string) bool {
	switch t {
	case "ListMyFriendships", "SendFriendRequest", "AcceptFriendRequest", "IgnoreFriendRequest", "BlockFriend":
		return true
	}
	return false
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "FRIEND_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "relationship.forbidden", nil)
	}
	switch e.CommandType {
	case "ListMyFriendships":
		return s.listMyFriendships(ctx, e)
	case "SendFriendRequest":
		return s.sendFriendRequest(ctx, e)
	case "AcceptFriendRequest":
		return s.acceptFriendRequest(ctx, e)
	case "IgnoreFriendRequest":
		return s.ignoreFriendRequest(ctx, e)
	case "BlockFriend":
		return s.blockFriend(ctx, e)
	}
	return command.Rejected(e, "RELATIONSHIP_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "relationship.unsupported_command", nil)
}

func (s *Service) listMyFriendships(ctx context.Context, e command.Envelope) command.Result {
	active, pending, err := s.bucketsFor(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "FRIEND_READ_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.read_failed", nil)
	}
	r := command.Accepted(e, "FriendshipCollection", e.Actor.ID, len(active)+len(pending), "READY", nil)
	raw, _ := json.Marshal(map[string]any{
		"friendships": ListFriendshipsPayload{Active: active, Pending: pending},
	})
	r.OperationRef = string(raw)
	return r
}

// ListActiveFriends 是好友集合的**直读**入口（不经 command 信封）。
//
// 为什么需要它：好友洞察（TWIN-INSIGHT-002）要拿"这个人的好友是谁"当作
// 洞察的目标集，但它是一屏 REST 读模型，不该为了拿一份好友名单去构造
// 一个 ListMyFriendships 信封（那条路要 actor/principal/idempotencyKey
// 一整套字段，而这里根本没有"用户在提交一个命令"这件事）。
// 与 twin_gallery_handlers.go 直接调 s.Media.ListPersonaGallery 同一取舍。
//
// 只返回 state=FRIEND 的行；PENDING / BLOCKED 都不算"好友"——
// 洞察的是"可以运营的人"，一个还没通过的好友申请或已拉黑的账号不在其中。
// 调用方必须传**已认证的**账号 id；本方法不做鉴权，读的是别人的好友名单
// 就是越权（见 twininsight 的调用点，ownerID 一律来自会话）。
func (s *Service) ListActiveFriends(ctx context.Context, userID string) ([]FriendView, error) {
	active, _, err := s.bucketsFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	return active, nil
}

// bucketsFor 是 active/pending 分桶的唯一实现，命令路径与直读路径共用，
// 避免两处各写一遍导致好友列表在两条路上不一致。
func (s *Service) bucketsFor(ctx context.Context, userID string) ([]FriendView, []FriendView, error) {
	if s.repo == nil {
		return nil, nil, ErrFriendshipNotFound
	}
	rows, err := s.repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	active := make([]FriendView, 0, len(rows))
	pending := make([]FriendView, 0, len(rows))
	for _, row := range rows {
		other := otherUser(row, userID)
		hint, name := s.resolveNameCtx(ctx, other)
		view := FriendView{
			UserID:      other,
			State:       row.State,
			DisplayName: hint.DisplayName,
			City:        hint.City,
			Since:       row.CreatedAt,
		}
		if hint.DisplayName == "" && other != "" {
			view.DisplayName = other
		}
		_ = name
		switch row.State {
		case FriendshipFriend:
			view.Direction = "MUTUAL"
			active = append(active, view)
		case FriendshipPending:
			if row.RequesterID == userID {
				view.Direction = "OUTGOING"
			} else {
				view.Direction = "INCOMING"
			}
			pending = append(pending, view)
		case FriendshipBlocked:
			// Blocked entries never appear in either bucket;
			// the user explicitly opted out.
		}
	}
	return active, pending, nil
}

func (s *Service) sendFriendRequest(ctx context.Context, e command.Envelope) command.Result {
	targetID, _ := e.Payload["targetUserId"].(string)
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return command.Rejected(e, "FRIEND_TARGET_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "relationship.target_required", nil)
	}
	if targetID == e.Actor.ID {
		return command.Rejected(e, "FRIEND_SELF_FORBIDDEN", "VALIDATION", "AFTER_USER_ACTION", "relationship.self_forbidden", nil)
	}
	// AI-FRIEND-REQUEST-001：平台 AI 账号不会 accept 好友申请。旧客户端 / curl
	// 仍可能直调 SendFriendRequest；只改按钮会继续制造永远 PENDING 的死记录。
	// 服务端必须拒绝，且错误码明确告诉客户端应改走消息链。
	if s.cannotFriendTarget != nil && s.cannotFriendTarget(targetID) {
		return command.Rejected(e, "FRIEND_TARGET_DOES_NOT_ACCEPT_REQUESTS", "BUSINESS_STATE", "AFTER_USER_ACTION", "relationship.target_does_not_accept_requests", nil)
	}
	// FRIEND-TARGET-EXISTS-001（2026-09-23）：目标账号必须真实存在，否则不写行。
	//
	// 首页「真人推荐」rail 曾经把本地 fixture id（u_linh）当 targetUserId 发出来，
	// 落库成 user_a/user_b = u_linh 这种没有账号的行 —— 库里实测攒了 12 条
	// 永远没有真人能同意的 PENDING（见 requester-home-friend-id.test.ts 的注释，
	// 以及 894f256 清掉的那批）。客户端解析已经修好，但旧客户端 / curl 仍能直调，
	// 只改客户端挡不住。
	//
	// 这条和 AI-FRIEND-REQUEST-001 是同一类错误：都是"申请已发出"的假成功。
	// 区别是 AI 账号**存在**（只是不会 accept），所以两条检查不能合并 ——
	// 合并了就没法告诉客户端"这个人不存在"和"这个人不收申请"的区别。
	// 错误码刻意区分：FRIEND_TARGET_NOT_FOUND ≠ FRIEND_TARGET_DOES_NOT_ACCEPT_REQUESTS。
	if s.targetAccountExists != nil && !s.targetAccountExists(ctx, targetID) {
		return command.Rejected(e, "FRIEND_TARGET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "relationship.target_not_found", nil)
	}
	if s.repo == nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	a, b := orderPair(e.Actor.ID, targetID)
	// FRIEND-BLOCK-REENTRY-001（按钮级合规审计 2026-09-22）：BLOCKED 是
	// 防骚扰边界，不是一个可以被下一次 SendFriendRequest 覆盖的展示状态。
	//
	// 旧代码直接 Upsert(PENDING)，所以 A 拉黑 B 后，B 再点一次加好友就把
	// 同一行翻回 PENDING；ListMyFriendships 又隐藏 BLOCKED，于是用户以为
	// 已经挡住了，骚扰者却能让申请重新出现在收件箱。
	//
	// 这里对**任一方向**都拒绝：当前 schema 只有一行 (user_a,user_b)，
	// 没有单独的 blocked_by，历史 BLOCKED 行也无法可靠反推出是谁按的按钮。
	// 宁可保守地要求未来走显式 Unblock（目前没有），也不能把 BLOCKED
	// 偷偷解释成「再发一次请求就自动解除」。错误码刻意不说"对方拉黑了你"，
	// 避免把对方的隐私状态泄漏给骚扰者。
	if existing, getErr := s.repo.GetFriendship(ctx, a, b); getErr == nil {
		if existing.State == FriendshipBlocked {
			return command.Rejected(e, "FRIEND_REQUEST_UNAVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "relationship.request_unavailable", nil)
		}
	} else if !errors.Is(getErr, ErrFriendshipNotFound) {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	now := s.clock.Now().UTC()
	rec, err := s.repo.UpsertFriendship(ctx, FriendshipRecord{
		ID:          newID("fr_"),
		UserA:       a,
		UserB:       b,
		State:       FriendshipPending,
		RequesterID: e.Actor.ID,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	ev := event.New("FriendRequestSent", "Friendship", rec.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"requesterId": e.Actor.ID,
		"targetId":    targetID,
	})
	r := command.Accepted(e, "Friendship", rec.ID, 1, string(FriendshipPending), []string{ev.EventID})
	raw, _ := json.Marshal(map[string]any{"friendship": rec})
	r.OperationRef = string(raw)
	return r
}

func (s *Service) acceptFriendRequest(ctx context.Context, e command.Envelope) command.Result {
	return s.transition(ctx, e, FriendshipFriend, "FriendRequestAccepted", "ACCEPTED")
}

func (s *Service) ignoreFriendRequest(ctx context.Context, e command.Envelope) command.Result {
	// Ignore removes the row entirely (not Block) so the
	// requester can re-send. The audit log records the
	// rejection so the system never silently swallows an
	// invitation.
	return s.delete(ctx, e, "FriendRequestIgnored")
}

func (s *Service) blockFriend(ctx context.Context, e command.Envelope) command.Result {
	return s.transition(ctx, e, FriendshipBlocked, "FriendBlocked", "BLOCKED")
}

func (s *Service) transition(ctx context.Context, e command.Envelope, target FriendshipStatus, eventType, statusLabel string) command.Result {
	targetID, _ := e.Payload["targetUserId"].(string)
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return command.Rejected(e, "FRIEND_TARGET_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "relationship.target_required", nil)
	}
	if s.repo == nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	a, b := orderPair(e.Actor.ID, targetID)
	rec, err := s.repo.GetFriendship(ctx, a, b)
	if err != nil {
		return command.Rejected(e, "FRIEND_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "relationship.not_found", nil)
	}
	// Accept/Block can only be invoked by the receiver
	// (the one who did NOT initiate the most recent
	// request), except Block which the actor can do at any
	// time.
	if eventType == "FriendRequestAccepted" && rec.RequesterID == e.Actor.ID {
		return command.Rejected(e, "FRIEND_NOT_RECEIVER", "AUTHORIZATION", "AFTER_USER_ACTION", "relationship.not_receiver", nil)
	}
	now := s.clock.Now().UTC()
	rec.State = target
	rec.UpdatedAt = now
	saved, err := s.repo.UpsertFriendship(ctx, rec)
	if err != nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	ev := event.New(eventType, "Friendship", saved.ID, 2, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"actorId":  e.Actor.ID,
		"targetId": targetID,
	})
	r := command.Accepted(e, "Friendship", saved.ID, 2, statusLabel, []string{ev.EventID})
	raw, _ := json.Marshal(map[string]any{"friendship": saved})
	r.OperationRef = string(raw)
	return r
}

func (s *Service) delete(ctx context.Context, e command.Envelope, eventType string) command.Result {
	targetID, _ := e.Payload["targetUserId"].(string)
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return command.Rejected(e, "FRIEND_TARGET_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "relationship.target_required", nil)
	}
	if s.repo == nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	a, b := orderPair(e.Actor.ID, targetID)
	rec, err := s.repo.GetFriendship(ctx, a, b)
	if err != nil {
		return command.Rejected(e, "FRIEND_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "relationship.not_found", nil)
	}
	// Delete via UpsertFriendship with State set to a
	// "deleted" marker would change semantics. We
	// introduce a soft-delete column for ignore; the
	// Postgres impl reads the row but treats
	// State=IGNORED_TOMBSTONE as gone. The memory impl
	// removes it from the map entirely.
	now := s.clock.Now().UTC()
	rec.State = "IGNORED_TOMBSTONE"
	rec.UpdatedAt = now
	if _, err := s.repo.UpsertFriendship(ctx, rec); err != nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	ev := event.New(eventType, "Friendship", rec.ID, 2, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"actorId":  e.Actor.ID,
		"targetId": targetID,
	})
	r := command.Accepted(e, "Friendship", rec.ID, 2, "IGNORED", []string{ev.EventID})
	raw, _ := json.Marshal(map[string]any{"deleted": rec.ID})
	r.OperationRef = string(raw)
	return r
}

func (s *Service) resolveNameCtx(ctx context.Context, userID string) (DisplayNameHint, bool) {
	if s.resolveName == nil {
		return DisplayNameHint{}, false
	}
	return s.resolveName(ctx, userID)
}

func otherUser(rec FriendshipRecord, actorID string) string {
	if rec.UserA == actorID {
		return rec.UserB
	}
	return rec.UserA
}

func orderPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

func newID(prefix string) string {
	var raw [10]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

// MemoryRepository is the in-memory Repository used in
// tests. It collapses to a single map keyed by the
// unordered (a,b) pair, so requesting (A,B) and (B,A) is
// the same row.
type MemoryRepository struct {
	mu   sync.Mutex
	rows map[string]FriendshipRecord
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{rows: map[string]FriendshipRecord{}}
}

func (r *MemoryRepository) UpsertFriendship(_ context.Context, rec FriendshipRecord) (FriendshipRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := rec.UserA + "\x00" + rec.UserB
	if existing, ok := r.rows[key]; ok && rec.CreatedAt.IsZero() {
		rec.CreatedAt = existing.CreatedAt
		rec.ID = existing.ID
	}
	r.rows[key] = rec
	return rec, nil
}

func (r *MemoryRepository) GetFriendship(_ context.Context, userA, userB string) (FriendshipRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, b := orderPair(userA, userB)
	rec, ok := r.rows[a+"\x00"+b]
	if !ok || rec.State == "IGNORED_TOMBSTONE" {
		return FriendshipRecord{}, ErrFriendshipNotFound
	}
	return rec, nil
}

func (r *MemoryRepository) ListByUser(_ context.Context, userID string) ([]FriendshipRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]FriendshipRecord, 0, len(r.rows))
	for _, rec := range r.rows {
		if rec.State == "IGNORED_TOMBSTONE" {
			continue
		}
		if rec.UserA == userID || rec.UserB == userID {
			out = append(out, rec)
		}
	}
	return out, nil
}
