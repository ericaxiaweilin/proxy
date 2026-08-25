package business

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type Account struct {
	ID          string    `json:"id"`
	OwnerUserID string    `json:"ownerUserId"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Membership struct {
	BusinessID string    `json:"businessId"`
	UserID     string    `json:"userId"`
	Role       string    `json:"role"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Store struct {
	ID         string    `json:"id"`
	BusinessID string    `json:"businessId"`
	Name       string    `json:"name"`
	Address    string    `json:"address"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Repository interface {
	CreateAccount(ctx context.Context, a Account) error
	GetAccount(ctx context.Context, id string) (Account, error)
	GetMembership(ctx context.Context, businessID, userID string) (Membership, error)
	ListAccountsForUser(ctx context.Context, userID string) ([]Account, error)
	CreateMembership(ctx context.Context, m Membership) error
	ListMembers(ctx context.Context, businessID string) ([]Membership, error)
	CreateStore(ctx context.Context, s Store) error
	ListStores(ctx context.Context, businessID string) ([]Store, error)
	AddSpend(ctx context.Context, businessID, orderID string, amount int64) error
	SpendSummary(ctx context.Context, businessID string) (int64, error)
}

type MemoryRepository struct {
	mu          sync.Mutex
	accounts    map[string]Account
	memberships map[string]map[string]Membership
	stores      map[string]Store
	spends      map[string][]int64
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{accounts: make(map[string]Account), memberships: make(map[string]map[string]Membership), stores: make(map[string]Store), spends: make(map[string][]int64)}
}
func (r *MemoryRepository) CreateAccount(_ context.Context, a Account) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.accounts[a.ID] = a
	if r.memberships[a.ID] == nil {
		r.memberships[a.ID] = make(map[string]Membership)
	}
	r.memberships[a.ID][a.OwnerUserID] = Membership{BusinessID: a.ID, UserID: a.OwnerUserID, Role: "OWNER", Status: "ACTIVE", CreatedAt: a.CreatedAt}
	return nil
}
func (r *MemoryRepository) GetAccount(_ context.Context, id string) (Account, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, ok := r.accounts[id]
	if !ok {
		return Account{}, errors.New("account not found")
	}
	return a, nil
}
func (r *MemoryRepository) GetMembership(_ context.Context, businessID, userID string) (Membership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.memberships[businessID][userID]
	if !ok {
		return Membership{}, errors.New("membership not found")
	}
	return m, nil
}
func (r *MemoryRepository) ListAccountsForUser(_ context.Context, userID string) ([]Account, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Account{}
	for businessID, members := range r.memberships {
		if member, ok := members[userID]; ok && member.Status == "ACTIVE" {
			if account, exists := r.accounts[businessID]; exists {
				result = append(result, account)
			}
		}
	}
	return result, nil
}
func (r *MemoryRepository) CreateMembership(_ context.Context, m Membership) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.memberships[m.BusinessID] == nil {
		r.memberships[m.BusinessID] = make(map[string]Membership)
	}
	r.memberships[m.BusinessID][m.UserID] = m
	return nil
}
func (r *MemoryRepository) ListMembers(_ context.Context, businessID string) ([]Membership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Membership{}
	for _, m := range r.memberships[businessID] {
		result = append(result, m)
	}
	return result, nil
}
func (r *MemoryRepository) CreateStore(_ context.Context, s Store) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stores[s.ID] = s
	return nil
}
func (r *MemoryRepository) ListStores(_ context.Context, businessID string) ([]Store, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Store{}
	for _, s := range r.stores {
		if s.BusinessID == businessID {
			result = append(result, s)
		}
	}
	return result, nil
}
func (r *MemoryRepository) AddSpend(_ context.Context, businessID, orderID string, amount int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.spends[businessID] = append(r.spends[businessID], amount)
	_ = orderID
	return nil
}
func (r *MemoryRepository) SpendSummary(_ context.Context, businessID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total int64
	for _, v := range r.spends[businessID] {
		total += v
	}
	return total, nil
}

type Service struct {
	mu    sync.Mutex
	repo  Repository
	clock clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Service{repo: repo, clock: clock.System{}}
}
func (s *Service) Supports(t string) bool {
	switch t {
	case "CreateBusinessAccount", "ListMyBusinessAccounts", "AddBusinessMember", "CreateBusinessStore", "ListBusinessStores", "SpendSummary":
		return true
	}
	return false
}
func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateBusinessAccount":
		return s.createAccount(ctx, e)
	case "ListMyBusinessAccounts":
		return s.listMyAccounts(ctx, e)
	case "AddBusinessMember":
		return s.addMember(ctx, e)
	case "CreateBusinessStore":
		return s.createStore(ctx, e)
	case "ListBusinessStores":
		return s.listStores(ctx, e)
	case "SpendSummary":
		return s.spendSummary(ctx, e)
	default:
		return command.Rejected(e, "BUSINESS_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "business.unsupported", nil)
	}
}

func (s *Service) createAccount(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Name string `json:"name"`
	}
	if !decode(e.Payload, &p) || p.Name == "" {
		return command.Rejected(e, "INVALID_BUSINESS", "VALIDATION", "AFTER_USER_ACTION", "business.invalid", nil)
	}
	now := s.clock.Now().UTC()
	acc := Account{ID: newID("biz_"), OwnerUserID: e.Actor.ID, Name: p.Name, Status: "ACTIVE", CreatedAt: now}
	if err := s.repo.CreateAccount(ctx, acc); err != nil {
		return command.Rejected(e, "BUSINESS_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.create_failed", nil)
	}
	ev := event.New("BusinessAccountCreated", "BusinessAccount", acc.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"name": p.Name})
	return acceptedWithPayload(e, "BusinessAccount", acc.ID, 1, acc.Status, map[string]any{"businessId": acc.ID, "account": acc}, []event.DomainEvent{ev})
}

func (s *Service) listMyAccounts(ctx context.Context, e command.Envelope) command.Result {
	accounts, err := s.repo.ListAccountsForUser(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "BUSINESS_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "business.list_failed", nil)
	}
	return acceptedWithPayload(e, "BusinessAccountList", e.Actor.ID, 1, "LISTED", map[string]any{"accounts": accounts}, nil)
}

func (s *Service) addMember(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID string `json:"businessId"`
		UserID     string `json:"userId"`
		Role       string `json:"role"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.UserID == "" {
		return command.Rejected(e, "INVALID_MEMBER", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_member", nil)
	}
	if p.Role == "" {
		p.Role = "OPERATOR"
	}
	if p.Role != "ADMIN" && p.Role != "OPERATOR" && p.Role != "VIEWER" {
		return command.Rejected(e, "INVALID_BUSINESS_ROLE", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_role", nil)
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN") {
		return command.Rejected(e, "BUSINESS_ADMIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.admin_required", nil)
	}
	now := s.clock.Now().UTC()
	m := Membership{BusinessID: p.BusinessID, UserID: p.UserID, Role: p.Role, Status: "ACTIVE", CreatedAt: now}
	if err := s.repo.CreateMembership(ctx, m); err != nil {
		return command.Rejected(e, "BUSINESS_MEMBER_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.member_create_failed", nil)
	}
	ev := event.New("BusinessMemberAdded", "BusinessAccount", p.BusinessID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"userId": p.UserID})
	return command.Accepted(e, "BusinessAccount", p.BusinessID, 1, "MEMBER_ADDED", []string{ev.EventID})
}

func (s *Service) createStore(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID string `json:"businessId"`
		Name       string `json:"name"`
		Address    string `json:"address"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.Name == "" {
		return command.Rejected(e, "INVALID_STORE", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store", nil)
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	now := s.clock.Now().UTC()
	store := Store{ID: newID("store_"), BusinessID: p.BusinessID, Name: p.Name, Address: p.Address, Status: "ACTIVE", CreatedAt: now}
	if err := s.repo.CreateStore(ctx, store); err != nil {
		return command.Rejected(e, "BUSINESS_STORE_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_create_failed", nil)
	}
	ev := event.New("BusinessStoreCreated", "Store", store.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "Store", store.ID, 1, store.Status, map[string]any{"storeId": store.ID, "store": store}, []event.DomainEvent{ev})
}

func (s *Service) listStores(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID string `json:"businessId"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" {
		p.BusinessID = e.Target.ID
		if p.BusinessID == "" {
			return command.Rejected(e, "INVALID_LIST", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_list", nil)
		}
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	stores, err := s.repo.ListStores(ctx, p.BusinessID)
	if err != nil {
		return command.Rejected(e, "BUSINESS_STORE_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_list_failed", nil)
	}
	return acceptedWithPayload(e, "StoreList", p.BusinessID, 1, "LISTED", map[string]any{"stores": stores}, nil)
}

func (s *Service) spendSummary(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID string `json:"businessId"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" {
		p.BusinessID = e.Target.ID
		if p.BusinessID == "" {
			return command.Rejected(e, "INVALID_SUMMARY", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_summary", nil)
		}
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN") {
		return command.Rejected(e, "BUSINESS_FINANCE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.finance_required", nil)
	}
	total, err := s.repo.SpendSummary(ctx, p.BusinessID)
	if err != nil {
		return command.Rejected(e, "BUSINESS_SPEND_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.spend_read_failed", nil)
	}
	return acceptedWithPayload(e, "SpendSummary", p.BusinessID, 1, "SUMMARIZED", map[string]any{"totalMinor": total}, nil)
}

func (s *Service) hasRole(ctx context.Context, businessID, userID string, roles ...string) bool {
	membership, err := s.repo.GetMembership(ctx, businessID, userID)
	if err != nil || membership.Status != "ACTIVE" {
		return false
	}
	for _, role := range roles {
		if membership.Role == role {
			return true
		}
	}
	return false
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func newID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + "fallback"
}
func acceptedWithPayload(e command.Envelope, typ, id string, version int, state string, payload map[string]any, events []event.DomainEvent) command.Result {
	r := command.Accepted(e, typ, id, version, state, eventRefs(events))
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}
func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}
