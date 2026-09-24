// Package providerapp 是「申请接单权限」（PROVIDER-APPLY-001 → ORDER-PERMISSION-001，2026-09-24）。
//
// 接单资格以前没有申请入口，supply.agent_profiles 只能靠种子 / 手工 SQL 开。选定「申请 + 运营审核」：
// 用户更正：「不是申请成为小美 是申请接单权限 如果只是小美有性别歧视限制」—— 任何人都能申请，性别不是门槛。
//
// ORDER-PERMISSION-KYC-001（原型 deepseek_html_20260924_33987c「接单中心 · KYC + 履约管线」）：3 步 KYC
//
//	1 基础信息：实名、出生年份（满 18）、性别（可选自述，不参与任何判断）、手机号、服务区域、语言
//	2 证件：CCCD（正反面）或护照（正面）+ 手持证件自拍 —— 运营人工比对（用户选定；Face ID 只能证明是手机主人，
//	  不能和证件比对，所以不用它冒充「真人比对通过」）；无犯罪声明；KYC 数据使用同意
//	3 履约条款：紧急联系人 + config/provider-terms/terms.json 的全部条款（记录版本）
//	→ 运营控制台审核（通过 / 拒绝并写原因）→ 通过才开 supply.agent_profiles（ACTIVE）并声明语言能力。
//
// 资料门跟发帖同一道（用户名 + 平台头像）；证件 / 自拍必须是本人上传、非 AI 生成的图，且是 OWNER_ONLY
// 媒体 —— 只有运营控制台能看。实名、证件、手机号、紧急联系人只给运营看。
package providerapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	StatusSubmitted = "SUBMITTED"
	StatusApproved  = "APPROVED"
	StatusRejected  = "REJECTED"
	StatusWithdrawn = "WITHDRAWN"

	MinAge      = 18
	MaxRealName = 40
)

// 可选值写在这里（跟 supply 的能力 / 语言码同一套）。
var (
	AllowedLanguages    = []string{"VI", "ZH", "EN", "KO", "JA"}
	AllowedCapabilities = []string{"CITY_GUIDE", "PHOTOGRAPHY", "TRANSLATION", "DRIVING"}
	AllowedAreas        = []string{"hn", "bn", "hcm", "dn"}
)

type Application struct {
	ID             string     `json:"applicationId"`
	UserAccountID  string     `json:"userAccountId"`
	DisplayName    string     `json:"displayName"`
	RealName       string     `json:"realName,omitempty"`
	PhotosAttested bool       `json:"photosAttested"`
	BirthYear      int        `json:"birthYear,omitempty"`
	Gender         string     `json:"gender,omitempty"`
	Phone          string     `json:"phone,omitempty"`
	PhoneVerified  bool       `json:"phoneVerified"`
	IDType         string     `json:"idType,omitempty"`
	IDFrontAsset   string     `json:"idFrontAsset,omitempty"`
	IDBackAsset    string     `json:"idBackAsset,omitempty"`
	SelfieAsset    string     `json:"selfieAsset,omitempty"`
	NoCrime        bool       `json:"noCrimeDeclared"`
	DataConsent    bool       `json:"dataConsent"`
	Emergency      string     `json:"emergencyContact,omitempty"`
	TermsVersion   string     `json:"termsVersion,omitempty"`
	TermsAccepted  []string   `json:"termsAccepted"`
	City           string     `json:"city"`
	ServiceAreas   []string   `json:"serviceAreas"`
	Languages      []string   `json:"languages"`
	Capabilities   []string   `json:"capabilities"`
	Intro          string     `json:"intro"`
	PhotoAssetIDs  []string   `json:"photoAssetIds"`
	Status         string     `json:"status"`
	RejectReason   string     `json:"rejectReason,omitempty"`
	ReviewedBy     string     `json:"reviewedBy,omitempty"`
	ReviewedAt     *time.Time `json:"reviewedAt,omitempty"`
	AgentID        string     `json:"agentId,omitempty"`
	Source         string     `json:"source"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// Input 是本人三步填完后一次提交的表单。
type Input struct {
	RealName     string   `json:"realName"`
	BirthYear    int      `json:"birthYear"`
	Gender       string   `json:"gender"`
	Phone        string   `json:"phone"`
	City         string   `json:"city"`
	ServiceAreas []string `json:"serviceAreas"`
	Languages    []string `json:"languages"`
	IDType       string   `json:"idType"`
	IDFrontAsset string   `json:"idFrontAsset"`
	IDBackAsset  string   `json:"idBackAsset"`
	SelfieAsset  string   `json:"selfieAsset"`
	NoCrime      bool     `json:"noCrimeDeclared"`
	DataConsent  bool     `json:"dataConsent"`
	Emergency    string   `json:"emergencyContact"`
	TermsVersion string   `json:"termsVersion"`
	Accepted     []string `json:"termsAccepted"`
}

// Terms 是 config/provider-terms/terms.json。
type Terms struct {
	Version string     `json:"version"`
	Items   []TermItem `json:"items"`
}

type TermItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Enforced bool   `json:"enforced"`
}

type Store interface {
	Latest(ctx context.Context, userAccountID string) (*Application, error)
	Get(ctx context.Context, id string) (*Application, error)
	Insert(ctx context.Context, app Application) error
	Update(ctx context.Context, app Application) error
	List(ctx context.Context, status string, limit int) ([]Application, error)
}

// Deps 是跨域依赖，全部在 main.go 接线；缺哪个就 fail-closed。
type Deps struct {
	// Missing 返回资料缺什么（"name" / "avatar"），空 = 齐了。跟发帖同一道门。
	Missing func(ctx context.Context, userAccountID string) []string
	// DisplayName 读本人资料名（申请单上的展示名，跟主页一致）。
	DisplayName func(ctx context.Context, userAccountID string) string
	// Terms 读当前履约条款（文件）。
	Terms func() (Terms, error)
	// BadPhotos 返回不合格的照片 id（不是本人的 / 不是图片 / AI 生成的 / 不存在）。
	BadPhotos func(ctx context.Context, userAccountID string, assetIDs []string) ([]string, error)
	// Activate 在审核通过时开 supply 服务者身份，返回 agent_id。
	Activate func(ctx context.Context, app Application) (string, error)
}

var (
	ErrUnavailable     = errors.New("provider_application_unavailable")
	ErrNotFound        = errors.New("provider_application_not_found")
	ErrAlreadyOpen     = errors.New("provider_application_already_open")
	ErrNotReviewable   = errors.New("provider_application_not_reviewable")
	ErrNotWithdrawable = errors.New("provider_application_not_withdrawable")
)

// ValidationError 列出表单里每一处不合格（客户端逐项提示，不是一句「提交失败」）。
type ValidationError struct {
	Fields []string `json:"fields"`
}

func (e *ValidationError) Error() string {
	return "provider_application_invalid: " + strings.Join(e.Fields, ",")
}

type Service struct {
	store Store
	deps  Deps
	now   func() time.Time
}

func NewService(store Store, deps Deps) *Service {
	return &Service{store: store, deps: deps, now: time.Now}
}

func (s *Service) ready() bool {
	return s != nil && s.store != nil && s.deps.Missing != nil && s.deps.BadPhotos != nil && s.deps.Activate != nil && s.deps.Terms != nil
}

// Mine：本人最近一份申请（没有 = nil）。
func (s *Service) Mine(ctx context.Context, userAccountID string) (*Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	return s.store.Latest(ctx, userAccountID)
}

func (s *Service) Submit(ctx context.Context, userAccountID string, in Input) (*Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	latest, err := s.store.Latest(ctx, userAccountID)
	if err != nil {
		return nil, err
	}
	if latest != nil && (latest.Status == StatusSubmitted || latest.Status == StatusApproved) {
		return nil, ErrAlreadyOpen
	}
	terms, err := s.deps.Terms()
	if err != nil {
		return nil, err
	}
	in = normalize(in)
	now := s.now().UTC()
	fields := []string{}
	for _, m := range s.deps.Missing(ctx, userAccountID) {
		fields = append(fields, "profile_"+m)
	}
	fields = append(fields, validate(in, terms, now.Year())...)
	if docs := documentIDs(in); len(docs) > 0 {
		bad, err := s.deps.BadPhotos(ctx, userAccountID, docs)
		if err != nil {
			return nil, err
		}
		if len(bad) > 0 {
			fields = append(fields, "documents_not_own_real")
		}
	}
	if len(fields) > 0 {
		return nil, &ValidationError{Fields: fields}
	}
	app := Application{
		ID: newID(), UserAccountID: userAccountID, RealName: in.RealName, PhotosAttested: true,
		BirthYear: in.BirthYear, Gender: in.Gender, Phone: in.Phone,
		IDType: in.IDType, IDFrontAsset: in.IDFrontAsset, IDBackAsset: in.IDBackAsset, SelfieAsset: in.SelfieAsset,
		NoCrime: true, DataConsent: true, Emergency: in.Emergency, TermsVersion: terms.Version, TermsAccepted: in.Accepted,
		City: in.City, ServiceAreas: in.ServiceAreas, Languages: in.Languages, Capabilities: []string{},
		PhotoAssetIDs: []string{}, Status: StatusSubmitted, Source: "APP", CreatedAt: now, UpdatedAt: now,
	}
	if s.deps.DisplayName != nil {
		app.DisplayName = s.deps.DisplayName(ctx, userAccountID)
	}
	if err := s.store.Insert(ctx, app); err != nil {
		return nil, err
	}
	return &app, nil
}

func (s *Service) Withdraw(ctx context.Context, userAccountID string) (*Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	latest, err := s.store.Latest(ctx, userAccountID)
	if err != nil {
		return nil, err
	}
	if latest == nil || latest.Status != StatusSubmitted {
		return nil, ErrNotWithdrawable
	}
	latest.Status = StatusWithdrawn
	latest.UpdatedAt = s.now().UTC()
	if err := s.store.Update(ctx, *latest); err != nil {
		return nil, err
	}
	return latest, nil
}

// List：运营列表（status 为空 = 全部）。
func (s *Service) List(ctx context.Context, status string, limit int) ([]Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	return s.store.List(ctx, status, limit)
}

// Review：运营审核。拒绝必须写原因（用户看得到，才知道改什么）。
func (s *Service) Review(ctx context.Context, id, reviewer string, approve bool, reason string) (*Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	app, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if app == nil {
		return nil, ErrNotFound
	}
	if app.Status != StatusSubmitted {
		return nil, ErrNotReviewable
	}
	reason = strings.TrimSpace(reason)
	if !approve && reason == "" {
		return nil, &ValidationError{Fields: []string{"reject_reason"}}
	}
	now := s.now().UTC()
	if approve {
		agentID, err := s.deps.Activate(ctx, *app)
		if err != nil {
			return nil, err
		}
		app.Status, app.AgentID = StatusApproved, agentID
	} else {
		app.Status, app.RejectReason = StatusRejected, reason
	}
	app.ReviewedBy, app.ReviewedAt, app.UpdatedAt = reviewer, &now, now
	if err := s.store.Update(ctx, *app); err != nil {
		return nil, err
	}
	return app, nil
}

// ForApplicant 是给申请人本人看的视图：不回运营内部字段（审核人）。
func ForApplicant(app *Application) *Application {
	if app == nil {
		return nil
	}
	out := *app
	out.ReviewedBy = ""
	return &out
}

func normalize(in Input) Input {
	in.RealName = strings.TrimSpace(in.RealName)
	in.Gender = strings.ToUpper(strings.TrimSpace(in.Gender))
	in.Phone = normalizePhone(in.Phone)
	in.City = strings.TrimSpace(in.City)
	in.ServiceAreas = dedupe(in.ServiceAreas, strings.ToLower)
	in.Languages = dedupe(in.Languages, strings.ToUpper)
	in.IDType = strings.ToUpper(strings.TrimSpace(in.IDType))
	trimAsset := func(v string) string { return strings.TrimPrefix(strings.TrimSpace(v), "assets/") }
	in.IDFrontAsset, in.IDBackAsset, in.SelfieAsset = trimAsset(in.IDFrontAsset), trimAsset(in.IDBackAsset), trimAsset(in.SelfieAsset)
	if in.IDType == "PASSPORT" {
		in.IDBackAsset = "" // 护照没有反面
	}
	in.Emergency = strings.TrimSpace(in.Emergency)
	in.Accepted = dedupe(in.Accepted, strings.ToLower)
	return in
}

// normalizePhone 只留数字和开头的 +；越南本地写法 0xxxxxxxxx → +84xxxxxxxxx。
func normalizePhone(v string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(v) {
		if (r >= '0' && r <= '9') || (r == '+' && i == 0) {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if strings.HasPrefix(out, "0") && len(out) >= 9 {
		out = "+84" + out[1:]
	}
	return out
}

func documentIDs(in Input) []string {
	out := []string{}
	for _, id := range []string{in.IDFrontAsset, in.IDBackAsset, in.SelfieAsset} {
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

func validate(in Input, terms Terms, year int) []string {
	fields := []string{}
	if n := utf8.RuneCountInString(in.RealName); n < 2 || n > MaxRealName {
		fields = append(fields, "real_name")
	}
	if age := year - in.BirthYear; in.BirthYear == 0 || age < MinAge || age > 90 {
		fields = append(fields, "birth_year")
	}
	if in.Gender != "" && in.Gender != "FEMALE" && in.Gender != "MALE" && in.Gender != "OTHER" {
		fields = append(fields, "gender")
	}
	if digits := strings.TrimPrefix(in.Phone, "+"); len(digits) < 8 || len(digits) > 15 || !strings.HasPrefix(in.Phone, "+") {
		fields = append(fields, "phone")
	}
	if in.City == "" {
		fields = append(fields, "city")
	}
	if len(in.ServiceAreas) == 0 || !subset(in.ServiceAreas, AllowedAreas) {
		fields = append(fields, "service_areas")
	}
	if len(in.Languages) == 0 || !subset(in.Languages, AllowedLanguages) {
		fields = append(fields, "languages")
	}
	if in.IDType != "CCCD" && in.IDType != "PASSPORT" {
		fields = append(fields, "id_type")
	}
	if in.IDFrontAsset == "" || (in.IDType == "CCCD" && in.IDBackAsset == "") {
		fields = append(fields, "id_documents")
	}
	if in.SelfieAsset == "" {
		fields = append(fields, "selfie")
	}
	if !in.NoCrime {
		fields = append(fields, "no_crime_declared")
	}
	if !in.DataConsent {
		fields = append(fields, "data_consent")
	}
	if n := utf8.RuneCountInString(in.Emergency); n < 4 || n > 80 {
		fields = append(fields, "emergency_contact")
	}
	if in.TermsVersion != terms.Version {
		fields = append(fields, "terms_outdated")
	} else {
		for _, item := range terms.Items {
			if !contains(in.Accepted, item.ID) {
				fields = append(fields, "terms_accepted")
				break
			}
		}
	}
	return fields
}

func contains(values []string, v string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}

func dedupe(values []string, norm func(string) string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range values {
		v = norm(strings.TrimSpace(v))
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func subset(values, allowed []string) bool {
	for _, v := range values {
		ok := false
		for _, a := range allowed {
			if v == a {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "papp_" + hex.EncodeToString(b[:])
}

// Memory 是无数据库时（和单测）的实现。
type Memory struct {
	mu   sync.Mutex
	apps map[string]Application
}

func NewMemory() *Memory { return &Memory{apps: map[string]Application{}} }

func (m *Memory) Latest(_ context.Context, userAccountID string) (*Application, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var best *Application
	for _, a := range m.apps {
		if a.UserAccountID != userAccountID {
			continue
		}
		if best == nil || a.CreatedAt.After(best.CreatedAt) {
			picked := a
			best = &picked
		}
	}
	return best, nil
}

func (m *Memory) Get(_ context.Context, id string) (*Application, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.apps[id]
	if !ok {
		return nil, nil
	}
	return &a, nil
}

func (m *Memory) Insert(_ context.Context, app Application) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.apps[app.ID] = app
	return nil
}

func (m *Memory) Update(ctx context.Context, app Application) error { return m.Insert(ctx, app) }

func (m *Memory) List(_ context.Context, status string, limit int) ([]Application, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Application{}
	for _, a := range m.apps {
		if status == "" || a.Status == status {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// LoadTerms 读履约条款文件（每次读，运营改文件即时生效）。条款不能为空、id 不能重复。
func LoadTerms(path string) (Terms, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Terms{}, err
	}
	var t Terms
	if err := json.Unmarshal(raw, &t); err != nil {
		return Terms{}, err
	}
	seen := map[string]bool{}
	for _, item := range t.Items {
		if item.ID == "" || seen[item.ID] {
			return Terms{}, errors.New("provider terms: empty or duplicate item id")
		}
		seen[item.ID] = true
	}
	if t.Version == "" || len(t.Items) == 0 {
		return Terms{}, errors.New("provider terms: version and items are required")
	}
	return t, nil
}

// Granted：这个人有没有接单权限（最近一份申请已通过）。AI 分身只对有接单权限的人开（ORDER-PERMISSION-TWIN-001）。
func (s *Service) Granted(ctx context.Context, userAccountID string) (bool, error) {
	if !s.ready() {
		return false, ErrUnavailable
	}
	latest, err := s.store.Latest(ctx, userAccountID)
	if err != nil {
		return false, err
	}
	return latest != nil && latest.Status == StatusApproved, nil
}

// StatsStore 是可选能力（Postgres 实现；内存实现没有订单数据 → 全 0）。
type StatsStore interface {
	Stats(ctx context.Context, userAccountID string) (ProviderStats, error)
}

// Stats：本人作为服务者的履约记录（「我的订单」顶部接单面板）。
func (s *Service) Stats(ctx context.Context, userAccountID string) (ProviderStats, error) {
	if !s.ready() {
		return ProviderStats{}, ErrUnavailable
	}
	if source, ok := s.store.(StatsStore); ok {
		return source.Stats(ctx, userAccountID)
	}
	return ProviderStats{}, nil
}

// Get：运营按 id 读一份申请。
func (s *Service) Get(ctx context.Context, id string) (*Application, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	return s.store.Get(ctx, id)
}

// Documents：这份申请里运营可以看的图（证件、自拍、旧版申请照片）。
func (a Application) Documents() []string {
	out := []string{}
	for _, id := range append([]string{a.IDFrontAsset, a.IDBackAsset, a.SelfieAsset}, a.PhotoAssetIDs...) {
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}
