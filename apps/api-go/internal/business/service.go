package business

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

// StorePhoto is one entry in a store's album. AssetPath is a Proxy-internal
// reference, never a public URL; the wire contract enforces a non-empty
// ai-personas/ / assets/ / store/ / photo_ prefix.
type StorePhoto struct {
	ID         string    `json:"id"`
	StoreID    string    `json:"storeId"`
	BusinessID string    `json:"businessId"`
	UploadedBy string    `json:"uploadedBy"`
	AssetPath  string    `json:"assetPath"`
	Caption    string    `json:"caption"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
}

// StoreLines is the editable storefront profile. LogoAssetPath follows the
// same asset-path rule as StorePhoto. HoursJSON is a free-form encoded blob
// (UI is the source of truth for the schedule widget).
type StoreLines struct {
	StoreID       string    `json:"storeId"`
	BusinessID    string    `json:"businessId"`
	LogoAssetPath string    `json:"logoAssetPath"`
	Description   string    `json:"description"`
	HoursJSON     string    `json:"hoursJson"`
	ContactPhone  string    `json:"contactPhone"`
	ContactEmail  string    `json:"contactEmail"`
	UpdatedBy     string    `json:"updatedBy"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// MemberDirectory entry carries a display_name projection so the mobile
// "Creator 经营" / "客户" surfaces can show "Linh / Bao / Khoa" without a
// cross-surface user lookup. Directory is updated whenever membership
// changes (Create / Update / Remove).
type MemberDirectory struct {
	BusinessID  string    `json:"businessId"`
	UserID      string    `json:"userId"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	JoinedAt    time.Time `json:"joinedAt"`
}

// SpendDaily is a per-bucket rollup used by the sales center dashboard.
// Hardcoded "12.6tr" / "148 订单" will be replaced by reading from this
// projection. The repository's AddSpend path projects a row here.
type SpendDaily struct {
	BusinessID             string `json:"businessId"`
	BucketDate             string `json:"bucketDate"`
	OrderCount             int    `json:"orderCount"`
	GrossMinor             int64  `json:"grossMinor"`
	NewCustomerCount       int    `json:"newCustomerCount"`
	ReturningCustomerCount int    `json:"returningCustomerCount"`
}

// OperatingHome is the conservative R35 merchant read model. Demand and
// capacity signals are deliberately explicit about being unavailable: the
// service must never turn sales history into invented nearby demand.
type OperatingHome struct {
	BusinessID  string              `json:"businessId"`
	GeneratedAt time.Time           `json:"generatedAt"`
	Outcome     OperatingOutcome    `json:"outcome"`
	Pulse       OperatingPulse      `json:"operatingPulse"`
	Balance     DemandSupplyBalance `json:"demandSupply"`
	Forecast    OperatingForecast   `json:"forecast"`
	Decision    OperatingDecision   `json:"bestNextDecision"`
}

type OperatingOutcome struct {
	WindowDays         int   `json:"windowDays"`
	OrderCount         int   `json:"orderCount"`
	GrossMinor         int64 `json:"grossMinor"`
	NewCustomers       int   `json:"newCustomers"`
	ReturningCustomers int   `json:"returningCustomers"`
}

type OperatingPulse struct {
	State       string `json:"state"`
	StoreCount  int    `json:"storeCount"`
	MemberCount int    `json:"memberCount"`
	Freshness   string `json:"freshness"`
}

type DemandSupplyBalance struct {
	State                  string  `json:"state"`
	Confidence             float64 `json:"confidence"`
	PrivacyThresholdPassed bool    `json:"privacyThresholdPassed"`
	Reason                 string  `json:"reason"`
}

type OperatingForecast struct {
	Status      string   `json:"status"`
	Confidence  float64  `json:"confidence"`
	Version     int      `json:"version"`
	Assumptions []string `json:"assumptions"`
}

type OperatingDecision struct {
	Kind             string `json:"kind"`
	Title            string `json:"title"`
	Reason           string `json:"reason"`
	RequiresApproval bool   `json:"requiresApproval"`
}

type Repository interface {
	CreateAccount(ctx context.Context, a Account) error
	GetAccount(ctx context.Context, id string) (Account, error)
	GetMembership(ctx context.Context, businessID, userID string) (Membership, error)
	ListAccountsForUser(ctx context.Context, userID string) ([]Account, error)
	CreateMembership(ctx context.Context, m Membership) error
	ListMembers(ctx context.Context, businessID string) ([]Membership, error)
	CreateStore(ctx context.Context, s Store) error
	GetStore(ctx context.Context, storeID string) (Store, error)
	ListStores(ctx context.Context, businessID string) ([]Store, error)
	AddSpend(ctx context.Context, businessID, orderID string, amount int64) error
	SpendSummary(ctx context.Context, businessID string) (int64, error)

	// Store photos
	AddStorePhoto(ctx context.Context, p StorePhoto) error
	ListStorePhotos(ctx context.Context, storeID string) ([]StorePhoto, error)
	DeleteStorePhoto(ctx context.Context, storeID, photoID, requesterID string) error
	GetStorePhoto(ctx context.Context, storeID, photoID string) (StorePhoto, error)

	// Store lines (upsert)
	UpsertStoreLines(ctx context.Context, l StoreLines) error
	GetStoreLines(ctx context.Context, storeID string) (StoreLines, error)

	// Store products / menu items (R36.x MENU-001)
	CreateProduct(ctx context.Context, p StoreProduct) error
	GetProduct(ctx context.Context, productID string) (StoreProduct, error)
	UpdateProduct(ctx context.Context, p StoreProduct) error
	ListProducts(ctx context.Context, storeID string) ([]StoreProduct, error)

	// Member directory (upsert + read)
	UpsertMemberDirectory(ctx context.Context, m MemberDirectory) error
	ListMemberDirectory(ctx context.Context, businessID string) ([]MemberDirectory, error)

	// Spend daily rollup (upsert)
	UpsertSpendDaily(ctx context.Context, s SpendDaily) error
	ListSpendDaily(ctx context.Context, businessID string, sinceDays int) ([]SpendDaily, error)
	UpsertAggregatedDemandSignal(ctx context.Context, signal AggregatedDemandSignal) error
	LatestAggregatedDemandSignal(ctx context.Context, businessID string) (AggregatedDemandSignal, error)
	UpsertSceneSupplySnapshot(ctx context.Context, snapshot SceneSupplySnapshot) error
	LatestSceneSupplySnapshot(ctx context.Context, businessID string) (SceneSupplySnapshot, error)
}

type MemoryRepository struct {
	mu              sync.Mutex
	accounts        map[string]Account
	memberships     map[string]map[string]Membership
	stores          map[string]Store
	spends          map[string][]int64
	storePhotos     map[string]map[string]StorePhoto
	storeLines      map[string]StoreLines
	products        map[string]StoreProduct
	memberDirectory map[string]map[string]MemberDirectory
	spendDaily      map[string]map[string]SpendDaily
	demandSignals   map[string]AggregatedDemandSignal
	supplySnapshots map[string]SceneSupplySnapshot
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		accounts:        make(map[string]Account),
		memberships:     make(map[string]map[string]Membership),
		stores:          make(map[string]Store),
		spends:          make(map[string][]int64),
		storePhotos:     make(map[string]map[string]StorePhoto),
		storeLines:      make(map[string]StoreLines),
		products:        make(map[string]StoreProduct),
		memberDirectory: make(map[string]map[string]MemberDirectory),
		spendDaily:      make(map[string]map[string]SpendDaily),
		demandSignals:   make(map[string]AggregatedDemandSignal),
		supplySnapshots: make(map[string]SceneSupplySnapshot),
	}
}
func (r *MemoryRepository) CreateAccount(_ context.Context, a Account) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.accounts[a.ID] = a
	if r.memberships[a.ID] == nil {
		r.memberships[a.ID] = make(map[string]Membership)
	}
	r.memberships[a.ID][a.OwnerUserID] = Membership{BusinessID: a.ID, UserID: a.OwnerUserID, Role: "OWNER", Status: "ACTIVE", CreatedAt: a.CreatedAt}
	if r.memberDirectory[a.ID] == nil {
		r.memberDirectory[a.ID] = make(map[string]MemberDirectory)
	}
	r.memberDirectory[a.ID][a.OwnerUserID] = MemberDirectory{BusinessID: a.ID, UserID: a.OwnerUserID, DisplayName: a.Name, Role: "OWNER", Status: "ACTIVE", JoinedAt: a.CreatedAt}
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
	if r.memberDirectory[m.BusinessID] == nil {
		r.memberDirectory[m.BusinessID] = make(map[string]MemberDirectory)
	}
	// Preserve existing display_name if directory already has one.
	existing := r.memberDirectory[m.BusinessID][m.UserID]
	display := existing.DisplayName
	if display == "" {
		display = m.UserID
	}
	r.memberDirectory[m.BusinessID][m.UserID] = MemberDirectory{BusinessID: m.BusinessID, UserID: m.UserID, DisplayName: display, Role: m.Role, Status: m.Status, JoinedAt: m.CreatedAt}
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

func (r *MemoryRepository) GetStore(_ context.Context, storeID string) (Store, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.stores[storeID]
	if !ok {
		return Store{}, errors.New("store not found")
	}
	return s, nil
}

func (r *MemoryRepository) AddStorePhoto(_ context.Context, p StorePhoto) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.storePhotos[p.StoreID] == nil {
		r.storePhotos[p.StoreID] = make(map[string]StorePhoto)
	}
	r.storePhotos[p.StoreID][p.ID] = p
	return nil
}

func (r *MemoryRepository) ListStorePhotos(_ context.Context, storeID string) ([]StorePhoto, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []StorePhoto{}
	for _, p := range r.storePhotos[storeID] {
		result = append(result, p)
	}
	return result, nil
}

func (r *MemoryRepository) DeleteStorePhoto(_ context.Context, storeID, photoID, requesterID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	photos := r.storePhotos[storeID]
	if photos == nil {
		return errors.New("photo not found")
	}
	photo, ok := photos[photoID]
	if !ok {
		return errors.New("photo not found")
	}
	if photo.UploadedBy != requesterID {
		return errors.New("only the uploader may delete this photo")
	}
	delete(photos, photoID)
	return nil
}

func (r *MemoryRepository) GetStorePhoto(_ context.Context, storeID, photoID string) (StorePhoto, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	photos := r.storePhotos[storeID]
	if photos == nil {
		return StorePhoto{}, errors.New("photo not found")
	}
	photo, ok := photos[photoID]
	if !ok {
		return StorePhoto{}, errors.New("photo not found")
	}
	return photo, nil
}

func (r *MemoryRepository) UpsertStoreLines(_ context.Context, l StoreLines) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.storeLines[l.StoreID] = l
	return nil
}

func (r *MemoryRepository) GetStoreLines(_ context.Context, storeID string) (StoreLines, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.storeLines[storeID]
	if !ok {
		return StoreLines{StoreID: storeID}, nil
	}
	return l, nil
}

func (r *MemoryRepository) UpsertMemberDirectory(_ context.Context, m MemberDirectory) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.memberDirectory[m.BusinessID] == nil {
		r.memberDirectory[m.BusinessID] = make(map[string]MemberDirectory)
	}
	r.memberDirectory[m.BusinessID][m.UserID] = m
	return nil
}

func (r *MemoryRepository) ListMemberDirectory(_ context.Context, businessID string) ([]MemberDirectory, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []MemberDirectory{}
	for _, m := range r.memberDirectory[businessID] {
		result = append(result, m)
	}
	return result, nil
}

func (r *MemoryRepository) UpsertSpendDaily(_ context.Context, s SpendDaily) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.spendDaily[s.BusinessID] == nil {
		r.spendDaily[s.BusinessID] = make(map[string]SpendDaily)
	}
	r.spendDaily[s.BusinessID][s.BucketDate] = s
	return nil
}

func (r *MemoryRepository) ListSpendDaily(_ context.Context, businessID string, sinceDays int) ([]SpendDaily, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []SpendDaily{}
	for _, s := range r.spendDaily[businessID] {
		if sinceDays > 0 {
			t, err := time.Parse("2006-01-02", s.BucketDate)
			if err == nil {
				now := time.Now().UTC()
				cutoff := now.AddDate(0, 0, -sinceDays)
				if t.Before(cutoff) {
					continue
				}
			}
		}
		result = append(result, s)
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

func (r *MemoryRepository) UpsertAggregatedDemandSignal(_ context.Context, signal AggregatedDemandSignal) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.demandSignals[signal.BusinessID] = signal
	return nil
}
func (r *MemoryRepository) LatestAggregatedDemandSignal(_ context.Context, businessID string) (AggregatedDemandSignal, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.demandSignals[businessID]
	if !ok {
		return AggregatedDemandSignal{}, errors.New("demand signal not found")
	}
	return v, nil
}
func (r *MemoryRepository) UpsertSceneSupplySnapshot(_ context.Context, snapshot SceneSupplySnapshot) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.supplySnapshots[snapshot.BusinessID] = snapshot
	return nil
}
func (r *MemoryRepository) LatestSceneSupplySnapshot(_ context.Context, businessID string) (SceneSupplySnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.supplySnapshots[businessID]
	if !ok {
		return SceneSupplySnapshot{}, errors.New("supply snapshot not found")
	}
	return v, nil
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
	case "CreateBusinessAccount", "ListMyBusinessAccounts", "AddBusinessMember",
		"CreateBusinessStore", "ListBusinessStores", "GetBusinessStore", "SpendSummary",
		"AddStorePhoto", "ListStorePhotos", "DeleteStorePhoto",
		"UpsertStoreLines", "GetStoreLines",
		"CreateStoreProduct", "UpdateStoreProduct", "ListStoreProducts", "SetProductAvailability",
		"ListMemberDirectory", "UpsertMemberDirectory",
		"ListSpendDaily", "UpsertSpendDaily", "GetMerchantOperatingHome", "RecordAggregatedDemandSignal", "UpsertSceneSupplySnapshot":
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
	case "GetBusinessStore":
		return s.getStore(ctx, e)
	case "SpendSummary":
		return s.spendSummary(ctx, e)
	case "AddStorePhoto":
		return s.addStorePhoto(ctx, e)
	case "ListStorePhotos":
		return s.listStorePhotos(ctx, e)
	case "DeleteStorePhoto":
		return s.deleteStorePhoto(ctx, e)
	case "UpsertStoreLines":
		return s.upsertStoreLines(ctx, e)
	case "GetStoreLines":
		return s.getStoreLines(ctx, e)
	case "CreateStoreProduct":
		return s.createProduct(ctx, e)
	case "UpdateStoreProduct":
		return s.updateProduct(ctx, e)
	case "ListStoreProducts":
		return s.listProducts(ctx, e)
	case "SetProductAvailability":
		return s.setProductAvailability(ctx, e)
	case "ListMemberDirectory":
		return s.listMemberDirectory(ctx, e)
	case "UpsertMemberDirectory":
		return s.upsertMemberDirectory(ctx, e)
	case "ListSpendDaily":
		return s.listSpendDaily(ctx, e)
	case "UpsertSpendDaily":
		return s.upsertSpendDaily(ctx, e)
	case "GetMerchantOperatingHome":
		return s.getMerchantOperatingHome(ctx, e)
	case "RecordAggregatedDemandSignal":
		return s.recordAggregatedDemandSignal(ctx, e)
	case "UpsertSceneSupplySnapshot":
		return s.upsertSceneSupplySnapshot(ctx, e)
	default:
		return command.Rejected(e, "BUSINESS_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "business.unsupported", nil)
	}
}

func (s *Service) getMerchantOperatingHome(ctx context.Context, e command.Envelope) command.Result {
	businessID := e.Target.ID
	if businessID == "" {
		var p struct {
			BusinessID string `json:"businessId"`
		}
		if !decode(e.Payload, &p) {
			return command.Rejected(e, "INVALID_OPERATING_HOME", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_operating_home", nil)
		}
		businessID = p.BusinessID
	}
	if businessID == "" {
		return command.Rejected(e, "INVALID_OPERATING_HOME", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_operating_home", nil)
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	stores, err := s.repo.ListStores(ctx, businessID)
	if err != nil {
		return command.Rejected(e, "OPERATING_HOME_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.operating_home_read_failed", nil)
	}
	members, err := s.repo.ListMemberDirectory(ctx, businessID)
	if err != nil {
		return command.Rejected(e, "OPERATING_HOME_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.operating_home_read_failed", nil)
	}
	rows, err := s.repo.ListSpendDaily(ctx, businessID, 7)
	if err != nil {
		return command.Rejected(e, "OPERATING_HOME_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.operating_home_read_failed", nil)
	}
	home := OperatingHome{BusinessID: businessID, GeneratedAt: s.clock.Now().UTC()}
	home.Outcome.WindowDays = 7
	for _, row := range rows {
		home.Outcome.OrderCount += row.OrderCount
		home.Outcome.GrossMinor += row.GrossMinor
		home.Outcome.NewCustomers += row.NewCustomerCount
		home.Outcome.ReturningCustomers += row.ReturningCustomerCount
	}
	home.Pulse = OperatingPulse{State: "EMPTY", StoreCount: len(stores), MemberCount: len(members), Freshness: "NO_RECORDED_ACTIVITY"}
	if len(rows) > 0 {
		home.Pulse.State, home.Pulse.Freshness = "ACTIVE", "ROLLING_7_DAYS"
	}
	var demandPtr *AggregatedDemandSignal
	if demand, err := s.repo.LatestAggregatedDemandSignal(ctx, businessID); err == nil {
		demandPtr = &demand
	}
	var supplyPtr *SceneSupplySnapshot
	if supply, err := s.repo.LatestSceneSupplySnapshot(ctx, businessID); err == nil {
		supplyPtr = &supply
	}
	resolved := ResolveOperatingState(demandPtr, supplyPtr)
	home.Balance, home.Forecast, home.Decision = resolved.Balance, resolved.Forecast, resolved.Decision
	return acceptedWithPayload(e, "MerchantOperatingHome", businessID, 1, "READ", map[string]any{"home": home}, nil)
}

func (s *Service) recordAggregatedDemandSignal(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "SYSTEM" {
		return command.Rejected(e, "SYSTEM_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.system_actor_required", nil)
	}
	var p AggregatedDemandSignal
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.TotalMatchingDemand < 0 || p.ConfirmedArrivals < 0 || p.HighProbabilityArrivals < 0 || p.ConfirmedArrivals+p.HighProbabilityArrivals > p.TotalMatchingDemand || p.Confidence <= 0 || p.Confidence > 1 {
		return command.Rejected(e, "INVALID_DEMAND_SIGNAL", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_demand_signal", nil)
	}
	p.RecordedAt = s.clock.Now().UTC()
	if err := s.repo.UpsertAggregatedDemandSignal(ctx, p); err != nil {
		return command.Rejected(e, "DEMAND_SIGNAL_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "business.demand_signal_write_failed", nil)
	}
	return acceptedWithPayload(e, "AggregatedDemandSignal", p.BusinessID, 1, "RECORDED", map[string]any{"signal": p}, nil)
}

func (s *Service) upsertSceneSupplySnapshot(ctx context.Context, e command.Envelope) command.Result {
	var p SceneSupplySnapshot
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.StoreID == "" || p.SceneID == "" || p.CurrentCapacityPct < 0 || p.CurrentCapacityPct > 100 || p.ForecastCapacityPct < 0 || p.ForecastCapacityPct > 100 || p.Confidence <= 0 || p.Confidence > 1 {
		return command.Rejected(e, "INVALID_SUPPLY_SNAPSHOT", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_supply_snapshot", nil)
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil || store.BusinessID != p.BusinessID {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	p.RecordedAt = s.clock.Now().UTC()
	if err := s.repo.UpsertSceneSupplySnapshot(ctx, p); err != nil {
		return command.Rejected(e, "SUPPLY_SNAPSHOT_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "business.supply_snapshot_write_failed", nil)
	}
	return acceptedWithPayload(e, "SceneSupplySnapshot", p.BusinessID, 1, "RECORDED", map[string]any{"snapshot": p}, nil)
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

func (s *Service) getStore(ctx context.Context, e command.Envelope) command.Result {
	storeID := e.Target.ID
	if storeID == "" {
		var p struct {
			StoreID string `json:"storeId"`
		}
		if !decode(e.Payload, &p) || p.StoreID == "" {
			return command.Rejected(e, "INVALID_STORE_ID", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store_id", nil)
		}
		storeID = p.StoreID
	}
	store, err := s.repo.GetStore(ctx, storeID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	return acceptedWithPayload(e, "Store", store.ID, 1, store.Status, map[string]any{"store": store}, nil)
}

func (s *Service) addStorePhoto(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID   string `json:"storeId"`
		AssetPath string `json:"assetPath"`
		Caption   string `json:"caption"`
		SortOrder int    `json:"sortOrder"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" || p.AssetPath == "" {
		return command.Rejected(e, "INVALID_STORE_PHOTO", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store_photo", nil)
	}
	if !isValidAssetPath(p.AssetPath) {
		return command.Rejected(e, "INVALID_ASSET_PATH", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_asset_path", nil)
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	now := s.clock.Now().UTC()
	photo := StorePhoto{ID: newID("photo_"), StoreID: p.StoreID, BusinessID: store.BusinessID, UploadedBy: e.Actor.ID, AssetPath: p.AssetPath, Caption: p.Caption, SortOrder: p.SortOrder, CreatedAt: now}
	if err := s.repo.AddStorePhoto(ctx, photo); err != nil {
		return command.Rejected(e, "STORE_PHOTO_ADD_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_photo_add_failed", nil)
	}
	ev := event.New("StorePhotoAdded", "StorePhoto", photo.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"storeId": p.StoreID, "assetPath": p.AssetPath})
	return acceptedWithPayload(e, "StorePhoto", photo.ID, 1, "ADDED", map[string]any{"photo": photo}, []event.DomainEvent{ev})
}

func (s *Service) listStorePhotos(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID string `json:"storeId"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" {
		p.StoreID = e.Target.ID
		if p.StoreID == "" {
			return command.Rejected(e, "INVALID_STORE_ID", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store_id", nil)
		}
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	photos, err := s.repo.ListStorePhotos(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_PHOTO_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_photo_list_failed", nil)
	}
	return acceptedWithPayload(e, "StorePhotoList", p.StoreID, 1, "LISTED", map[string]any{"photos": photos, "count": len(photos)}, nil)
}

func (s *Service) deleteStorePhoto(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID string `json:"storeId"`
		PhotoID string `json:"photoId"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" || p.PhotoID == "" {
		return command.Rejected(e, "INVALID_PHOTO_DELETE", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_photo_delete", nil)
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	if err := s.repo.DeleteStorePhoto(ctx, p.StoreID, p.PhotoID, e.Actor.ID); err != nil {
		return command.Rejected(e, "STORE_PHOTO_DELETE_DENIED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.store_photo_delete_denied", nil)
	}
	now := s.clock.Now().UTC()
	ev := event.New("StorePhotoDeleted", "StorePhoto", p.PhotoID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"storeId": p.StoreID})
	return command.Accepted(e, "StorePhoto", p.PhotoID, 1, "DELETED", []string{ev.EventID})
}

func (s *Service) upsertStoreLines(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID       string `json:"storeId"`
		LogoAssetPath string `json:"logoAssetPath"`
		Description   string `json:"description"`
		HoursJSON     string `json:"hoursJson"`
		ContactPhone  string `json:"contactPhone"`
		ContactEmail  string `json:"contactEmail"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" {
		return command.Rejected(e, "INVALID_STORE_LINES", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store_lines", nil)
	}
	if p.LogoAssetPath != "" && !isValidAssetPath(p.LogoAssetPath) {
		return command.Rejected(e, "INVALID_ASSET_PATH", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_asset_path", nil)
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	now := s.clock.Now().UTC()
	lines := StoreLines{StoreID: p.StoreID, BusinessID: store.BusinessID, LogoAssetPath: p.LogoAssetPath, Description: p.Description, HoursJSON: p.HoursJSON, ContactPhone: p.ContactPhone, ContactEmail: p.ContactEmail, UpdatedBy: e.Actor.ID, UpdatedAt: now}
	if err := s.repo.UpsertStoreLines(ctx, lines); err != nil {
		return command.Rejected(e, "STORE_LINES_UPSERT_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_lines_upsert_failed", nil)
	}
	ev := event.New("StoreLinesUpdated", "Store", p.StoreID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "StoreLines", p.StoreID, 1, "UPDATED", map[string]any{"lines": lines}, []event.DomainEvent{ev})
}

func (s *Service) getStoreLines(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID string `json:"storeId"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" {
		p.StoreID = e.Target.ID
		if p.StoreID == "" {
			return command.Rejected(e, "INVALID_STORE_ID", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_store_id", nil)
		}
	}
	store, err := s.repo.GetStore(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, store.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	lines, err := s.repo.GetStoreLines(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "STORE_LINES_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.store_lines_read_failed", nil)
	}
	return acceptedWithPayload(e, "StoreLines", p.StoreID, 1, "READ", map[string]any{"lines": lines}, nil)
}

func (s *Service) listMemberDirectory(ctx context.Context, e command.Envelope) command.Result {
	businessID := e.Target.ID
	if businessID == "" {
		var p struct {
			BusinessID string `json:"businessId"`
		}
		if !decode(e.Payload, &p) || p.BusinessID == "" {
			return command.Rejected(e, "INVALID_LIST", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_list", nil)
		}
		businessID = p.BusinessID
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	members, err := s.repo.ListMemberDirectory(ctx, businessID)
	if err != nil {
		return command.Rejected(e, "MEMBER_DIRECTORY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.member_directory_read_failed", nil)
	}
	return acceptedWithPayload(e, "MemberDirectoryList", businessID, 1, "LISTED", map[string]any{"members": members, "count": len(members)}, nil)
}

func (s *Service) upsertMemberDirectory(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID  string `json:"businessId"`
		UserID      string `json:"userId"`
		DisplayName string `json:"displayName"`
		Role        string `json:"role"`
		Status      string `json:"status"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.UserID == "" {
		return command.Rejected(e, "INVALID_MEMBER_DIRECTORY", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_member_directory", nil)
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN") {
		return command.Rejected(e, "BUSINESS_ADMIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.admin_required", nil)
	}
	if p.Role == "" {
		p.Role = "OPERATOR"
	}
	if p.Status == "" {
		p.Status = "ACTIVE"
	}
	now := s.clock.Now().UTC()
	entry := MemberDirectory{BusinessID: p.BusinessID, UserID: p.UserID, DisplayName: p.DisplayName, Role: p.Role, Status: p.Status, JoinedAt: now}
	if err := s.repo.UpsertMemberDirectory(ctx, entry); err != nil {
		return command.Rejected(e, "MEMBER_DIRECTORY_UPSERT_FAILED", "INTERNAL", "SAFE_RETRY", "business.member_directory_upsert_failed", nil)
	}
	ev := event.New("MemberDirectoryUpdated", "BusinessAccount", p.BusinessID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"userId": p.UserID})
	return acceptedWithPayload(e, "MemberDirectory", p.BusinessID, 1, "UPDATED", map[string]any{"entry": entry}, []event.DomainEvent{ev})
}

func (s *Service) listSpendDaily(ctx context.Context, e command.Envelope) command.Result {
	businessID := e.Target.ID
	if businessID == "" {
		var p struct {
			BusinessID string `json:"businessId"`
			SinceDays  int    `json:"sinceDays"`
		}
		if !decode(e.Payload, &p) || p.BusinessID == "" {
			return command.Rejected(e, "INVALID_SUMMARY", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_summary", nil)
		}
		businessID = p.BusinessID
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN") {
		return command.Rejected(e, "BUSINESS_FINANCE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.finance_required", nil)
	}
	var p struct {
		SinceDays int `json:"sinceDays"`
	}
	_ = decode(e.Payload, &p)
	if p.SinceDays <= 0 {
		p.SinceDays = 30
	}
	rows, err := s.repo.ListSpendDaily(ctx, businessID, p.SinceDays)
	if err != nil {
		return command.Rejected(e, "SPEND_DAILY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "business.spend_daily_read_failed", nil)
	}
	var totalGross int64
	var totalOrders int
	for _, r := range rows {
		totalGross += r.GrossMinor
		totalOrders += r.OrderCount
	}
	return acceptedWithPayload(e, "SpendDailyList", businessID, 1, "LISTED", map[string]any{"days": rows, "totalGrossMinor": totalGross, "totalOrders": totalOrders, "sinceDays": p.SinceDays}, nil)
}

func (s *Service) upsertSpendDaily(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BusinessID             string `json:"businessId"`
		BucketDate             string `json:"bucketDate"`
		OrderCount             int    `json:"orderCount"`
		GrossMinor             int64  `json:"grossMinor"`
		NewCustomerCount       int    `json:"newCustomerCount"`
		ReturningCustomerCount int    `json:"returningCustomerCount"`
	}
	if !decode(e.Payload, &p) || p.BusinessID == "" || p.BucketDate == "" {
		return command.Rejected(e, "INVALID_SPEND_DAILY", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_spend_daily", nil)
	}
	if !s.hasRole(ctx, p.BusinessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	row := SpendDaily{BusinessID: p.BusinessID, BucketDate: p.BucketDate, OrderCount: p.OrderCount, GrossMinor: p.GrossMinor, NewCustomerCount: p.NewCustomerCount, ReturningCustomerCount: p.ReturningCustomerCount}
	if err := s.repo.UpsertSpendDaily(ctx, row); err != nil {
		return command.Rejected(e, "SPEND_DAILY_UPSERT_FAILED", "INTERNAL", "SAFE_RETRY", "business.spend_daily_upsert_failed", nil)
	}
	now := s.clock.Now().UTC()
	ev := event.New("SpendDailyUpserted", "BusinessAccount", p.BusinessID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"bucketDate": p.BucketDate})
	return acceptedWithPayload(e, "SpendDaily", p.BusinessID, 1, "UPDATED", map[string]any{"row": row}, []event.DomainEvent{ev})
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

// MerchantPublishIdentity verifies that userID may publish as businessID
// and returns the merchant display name.
//
// MERCHANT-PUBLISH-001: the api layer calls this before routing publish
// commands (PublishMarketOpportunity / PublishActivity). Only OWNER/ADMIN
// members of an ACTIVE account qualify. Services trust ONLY the resulting
// AuthContext annotation ("merchantID"/"merchantName"), never the client
// payload — a forged payload merchantId without membership is rejected
// upstream with MERCHANT_FORBIDDEN.
func (s *Service) MerchantPublishIdentity(ctx context.Context, businessID, userID string) (string, bool) {
	if businessID == "" || userID == "" {
		return "", false
	}
	account, err := s.repo.GetAccount(ctx, businessID)
	if err != nil || account.Status != "ACTIVE" || account.Name == "" {
		return "", false
	}
	if !s.hasRole(ctx, businessID, userID, "OWNER", "ADMIN") {
		return "", false
	}
	return account.Name, true
}

// R16.10-P1-F / Master PRD v1.4 §12: 合规场景分类强制（Category Policy 门禁）
// 防止业务绕合规：付费一对一私人陪伴/喝酒/亲密陪伴等不能因为换文案进入 Opportunity/Invite。
var forbiddenOpportunityCategories = map[string]bool{
	"private_intimate":       true,
	"paid_companion_alcohol": true,
	"paid_private_drink":     true,
}

func (s *Service) enforceCategoryPolicy(category string) bool {
	return !forbiddenOpportunityCategories[category]
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
}

// isValidAssetPath enforces the wire contract for any user-supplied
// asset reference: it must look like a Proxy-internal path, never a
// full external URL or free-text. Guards against free-form input that
// could later be used to render arbitrary content (XSS) or pull a
// public URL that violates the AI-rendered-not-real-photo rule.
func isValidAssetPath(p string) bool {
	if len(p) == 0 || len(p) > 256 {
		return false
	}
	prefixes := []string{"ai-personas/", "assets/", "store/", "photo_"}
	for _, pre := range prefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
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
