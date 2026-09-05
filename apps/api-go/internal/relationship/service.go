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
}

func New() *Service {
	return &Service{clock: clock.System{}}
}

func NewWithRepository(repo Repository) *Service {
	return &Service{repo: repo, clock: clock.System{}}
}

func (s *Service) SetRepository(repo Repository)    { s.repo = repo }
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
	if s.repo == nil {
		return command.Rejected(e, "FRIEND_READ_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.read_failed", nil)
	}
	rows, err := s.repo.ListByUser(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "FRIEND_READ_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.read_failed", nil)
	}
	active := make([]FriendView, 0, len(rows))
	pending := make([]FriendView, 0, len(rows))
	for _, row := range rows {
		other := otherUser(row, e.Actor.ID)
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
			if row.RequesterID == e.Actor.ID {
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
	r := command.Accepted(e, "FriendshipCollection", e.Actor.ID, len(active)+len(pending), "READY", nil)
	raw, _ := json.Marshal(map[string]any{
		"friendships": ListFriendshipsPayload{Active: active, Pending: pending},
	})
	r.OperationRef = string(raw)
	return r
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
	if s.repo == nil {
		return command.Rejected(e, "FRIEND_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "relationship.write_failed", nil)
	}
	a, b := orderPair(e.Actor.ID, targetID)
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
