// Package providerapp 是「申请接单权限」（PROVIDER-APPLY-001 → ORDER-PERMISSION-001，2026-09-24）。
//
// 接单资格以前没有申请入口，supply.agent_profiles 只能靠种子 / 手工 SQL 开。选定「申请 + 运营审核」：
// 用户更正：「不是申请成为小美 是申请接单权限 如果只是小美有性别歧视限制」—— 任何人都能申请，性别不是门槛。
//
// ORDER-PERMISSION-KYC-001（原型 deepseek_html_20260924_33987c「接单中心 · KYC + 履约管线」）：3 步 KYC
//
//	1 基础信息：头像（用主页头像）、实名、出生日期（精确到日，满 18；用户：「出生如果采集肯定也是日期」）、
//	  手机号 —— KYC 只认人，不收性别（越南 CCCD 第 4 位自带世纪 + 性别，运营看证件时自然知道；系统无任何逻辑消费性别，
//	  所以不采集也不派生）、不收城市 / 服务区域 / 语言（那是接单范围和能力，用户：「把会说的语言也放入了 干什么」）
//	2 手机验证：真的发短信验证码、真的校验（KYC-PHONE-ONLY-001，2026-09-27）
//	3 履约条款：紧急联系人 + 无犯罪声明 + KYC 数据使用同意 + config/provider-terms/terms.json 的全部条款（记录版本）
//	→ 运营控制台审核（通过 / 拒绝并写原因）→ 通过才开 supply.agent_profiles（ACTIVE）并声明语言能力。
//
// KYC-PHONE-ONLY-001（用户：「证件正面 反面 手持自拍的移除在kyc里 越南合规这个隐私数据困难 kyc我们就验证
// 电话号码真实性就好了 签承诺声明不变」）：原第 2 步的 CCCD 正反面 + 手持证件自拍已删除 —— 越南法律下留存
// 身份证件图像 / 生物特征比对属高风险个人数据，运营人工比对也从来不是「验证」，只是「像不像」。KYC 改成只认
// 两件事：手机号是不是真的接得到验证码（真实 OTP，见 PhoneChallengeSender），以及本人签了无犯罪声明 + 数据
// 使用同意 + 履约条款。已提交的老申请如果带证件资产，migration 128 已经把对应 media.media_assets 行删了；
// 磁盘上的原始文件字节目前还没有一条通用的删除管线（同一个已知缺口见
// docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md 里头像媒体字节那条）。
//
// 资料门跟发帖同一道（用户名 + 平台头像）；实名、手机号、紧急联系人只给运营看。
package providerapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	ID            string     `json:"applicationId"`
	UserAccountID string     `json:"userAccountId"`
	DisplayName   string     `json:"displayName"`
	RealName      string     `json:"realName,omitempty"`
	BirthYear     int        `json:"birthYear,omitempty"`
	BirthDate     string     `json:"birthDate,omitempty"`
	Gender        string     `json:"gender,omitempty"`
	Phone         string     `json:"phone,omitempty"`
	PhoneVerified bool       `json:"phoneVerified"`
	NoCrime       bool       `json:"noCrimeDeclared"`
	DataConsent   bool       `json:"dataConsent"`
	Emergency     string     `json:"emergencyContact,omitempty"`
	TermsVersion  string     `json:"termsVersion,omitempty"`
	TermsAccepted []string   `json:"termsAccepted"`
	City          string     `json:"city"`
	ServiceAreas  []string   `json:"serviceAreas"`
	Languages     []string   `json:"languages"`
	Capabilities  []string   `json:"capabilities"`
	Intro         string     `json:"intro"`
	PhotoAssetIDs []string   `json:"photoAssetIds"`
	Status        string     `json:"status"`
	RejectReason  string     `json:"rejectReason,omitempty"`
	ReviewedBy    string     `json:"reviewedBy,omitempty"`
	ReviewedAt    *time.Time `json:"reviewedAt,omitempty"`
	AgentID       string     `json:"agentId,omitempty"`
	Source        string     `json:"source"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

// Input 是本人三步填完后一次提交的表单。
//
// KYC-PHONE-ONLY-001: PhoneChallengeID 是第 2 步真的把验证码验对了之后拿到的那个
// PhoneChallenge.ID —— Submit 会重新查一遍这张挑战单（本人 / VERIFIED / 手机号一致 /
// 没过期太久），不是「客户端说验证过了就信」。
type Input struct {
	RealName         string   `json:"realName"`
	BirthYear        int      `json:"birthYear"`
	BirthDate        string   `json:"birthDate"`
	Gender           string   `json:"gender"`
	Phone            string   `json:"phone"`
	City             string   `json:"city"`
	ServiceAreas     []string `json:"serviceAreas"`
	Languages        []string `json:"languages"`
	PhoneChallengeID string   `json:"phoneChallengeId"`
	NoCrime          bool     `json:"noCrimeDeclared"`
	DataConsent      bool     `json:"dataConsent"`
	Emergency        string   `json:"emergencyContact"`
	TermsVersion     string   `json:"termsVersion"`
	Accepted         []string `json:"termsAccepted"`
}

// PhoneChallenge 是一次「验证这个手机号是不是真的」的真实 OTP 挑战记录 ——
// KYC-PHONE-ONLY-001 用它替代证件照 + 手持自拍。跟 identity 包里登录用的
// LoginChallenge 是同一种形状（Status/Attempts/MaxAttempts/ExpiresAt/ProviderRef），
// 但故意不复用那张表：登录验证的是「这是已登记的登录凭据」，这里验证的是
// 「这个还没登记过的手机号现在真的能收到码」，不要求先有一条 LoginIdentity。
type PhoneChallenge struct {
	ID            string
	UserAccountID string
	Phone         string
	ProviderRef   string
	Status        string // PENDING / VERIFIED / LOCKED
	Attempts      int
	MaxAttempts   int
	RequestedAt   time.Time
	ExpiresAt     time.Time
	VerifiedAt    time.Time
}

const (
	PhoneChallengePending  = "PENDING"
	PhoneChallengeVerified = "VERIFIED"
	PhoneChallengeLocked   = "LOCKED"
)

// PhoneChallengeStore 存 PhoneChallenge（Postgres 实现见 store.go；Memory 实现见下）。
type PhoneChallengeStore interface {
	CreatePhoneChallenge(ctx context.Context, c PhoneChallenge) error
	GetPhoneChallenge(ctx context.Context, id string) (*PhoneChallenge, error)
	UpdatePhoneChallenge(ctx context.Context, c PhoneChallenge) error
}

// PhoneChallengeSender 是这个包需要的最小 OTP 发送/校验接口 —— 由
// identity.LoginChallengeProvider（真实短信厂商，Twilio / eSMS / SpeedSMS 任一个）
// 在 cmd/api 那层适配满足，本包不直接 import identity（跟 Deps 的其它字段
// 同一个纪律：不认识具体是哪个域实现的，只认识这个最小形状）。
type PhoneChallengeSender interface {
	RequestOTP(ctx context.Context, phoneE164, purpose string) (providerRef string, expiresAt time.Time, err error)
	VerifyOTP(ctx context.Context, providerRef, code string) (verified bool, err error)
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
	// Phone 真的发/验 OTP（KYC-PHONE-ONLY-001）。fail-closed：nil 时手机验证
	// 请求直接拒绝，不会有「假装发了」的静默成功。
	Phone PhoneChallengeSender
	// Activate 在审核通过时开 supply 服务者身份，返回 agent_id。
	Activate func(ctx context.Context, app Application) (string, error)
}

var (
	ErrUnavailable      = errors.New("provider_application_unavailable")
	ErrNotFound         = errors.New("provider_application_not_found")
	ErrAlreadyOpen      = errors.New("provider_application_already_open")
	ErrNotReviewable    = errors.New("provider_application_not_reviewable")
	ErrNotWithdrawable  = errors.New("provider_application_not_withdrawable")
	ErrPhoneChallenge   = errors.New("provider_phone_challenge_invalid")
	ErrPhoneProviderGap = errors.New("provider_phone_challenge_provider_not_ready")
)

// ValidationError 列出表单里每一处不合格（客户端逐项提示，不是一句「提交失败」）。
type ValidationError struct {
	Fields []string `json:"fields"`
}

func (e *ValidationError) Error() string {
	return "provider_application_invalid: " + strings.Join(e.Fields, ",")
}

type Service struct {
	store      Store
	phoneStore PhoneChallengeStore
	deps       Deps
	now        func() time.Time
}

func NewService(store Store, phoneStore PhoneChallengeStore, deps Deps) *Service {
	return &Service{store: store, phoneStore: phoneStore, deps: deps, now: time.Now}
}

func (s *Service) ready() bool {
	return s != nil && s.store != nil && s.phoneStore != nil && s.deps.Missing != nil && s.deps.Activate != nil && s.deps.Terms != nil && s.deps.Phone != nil
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
	// KYC-PHONE-ONLY-001: 重新查一遍这张挑战单，不信客户端说"验证过了"——
	// 必须是本人的、状态是 VERIFIED、手机号跟这次提交的一致、而且验证时间
	// 没有久到失去意义（30 分钟，跟登录 OTP 的 5 分钟 TTL 不是一个东西：
	// 那个是"码本身多久过期"，这个是"验证完了但迟迟不提交，还算不算数"）。
	phoneVerified := false
	if in.PhoneChallengeID != "" {
		challenge, err := s.phoneStore.GetPhoneChallenge(ctx, in.PhoneChallengeID)
		if err != nil {
			return nil, err
		}
		if challenge != nil && challenge.UserAccountID == userAccountID && challenge.Status == PhoneChallengeVerified &&
			challenge.Phone == in.Phone && now.Sub(challenge.VerifiedAt) <= 30*time.Minute {
			phoneVerified = true
		}
	}
	fields = append(fields, validate(in, terms, now, phoneVerified)...)
	if len(fields) > 0 {
		return nil, &ValidationError{Fields: fields}
	}
	app := Application{
		ID: newID(), UserAccountID: userAccountID, RealName: in.RealName,
		BirthDate: strings.TrimSpace(in.BirthDate), BirthYear: birthYearOf(in.BirthDate), Gender: in.Gender,
		Phone: in.Phone, PhoneVerified: true,
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
	in.PhoneChallengeID = strings.TrimSpace(in.PhoneChallengeID)
	in.Emergency = strings.TrimSpace(in.Emergency)
	in.Accepted = dedupe(in.Accepted, strings.ToLower)
	return in
}

// birthYearOf 从出生日期派生年份，只写兼容列 birth_year（老行只读）；解析失败返回 0（validate 已拦）。
func birthYearOf(birthDate string) int {
	if birth, err := time.Parse("2006-01-02", strings.TrimSpace(birthDate)); err == nil {
		return birth.Year()
	}
	return 0
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

func validate(in Input, terms Terms, now time.Time, phoneVerified bool) []string {
	fields := []string{}
	if n := utf8.RuneCountInString(in.RealName); n < 2 || n > MaxRealName {
		fields = append(fields, "real_name")
	}
	// KYC-BIRTH-DATE-001：出生日期精确到日，按精确年龄卡 18–90。年份算法有最大 1 年误差，不再用。
	if birth, err := time.Parse("2006-01-02", strings.TrimSpace(in.BirthDate)); err != nil {
		fields = append(fields, "birth_date")
	} else {
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		birthDay := time.Date(birth.Year(), birth.Month(), birth.Day(), 0, 0, 0, 0, time.UTC)
		age := today.Year() - birthDay.Year()
		if today.Month() < birthDay.Month() || (today.Month() == birthDay.Month() && today.Day() < birthDay.Day()) {
			age--
		}
		if birthDay.After(today) || age < MinAge || age > 90 {
			fields = append(fields, "birth_date")
		}
	}
	if in.Gender != "" && in.Gender != "FEMALE" && in.Gender != "MALE" && in.Gender != "OTHER" {
		fields = append(fields, "gender")
	}
	if digits := strings.TrimPrefix(in.Phone, "+"); len(digits) < 8 || len(digits) > 15 || !strings.HasPrefix(in.Phone, "+") {
		fields = append(fields, "phone")
	} else if !phoneVerified {
		// KYC-PHONE-ONLY-001: 手机号格式对不算数，必须真的收到过验证码并验对。
		fields = append(fields, "phone_not_verified")
	}
	// 城市 / 区域 / 语言是可选的旧字段（KYC 不收）；传了就得是认识的值。
	if !subset(in.ServiceAreas, AllowedAreas) {
		fields = append(fields, "service_areas")
	}
	if !subset(in.Languages, AllowedLanguages) {
		fields = append(fields, "languages")
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

func newPhoneChallengeID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "pphc_" + hex.EncodeToString(b[:])
}

// Memory 是无数据库时（和单测）的实现——同时实现 Store 和 PhoneChallengeStore。
type Memory struct {
	mu       sync.Mutex
	apps     map[string]Application
	phoneChs map[string]PhoneChallenge
}

func NewMemory() *Memory { return &Memory{apps: map[string]Application{}, phoneChs: map[string]PhoneChallenge{}} }

func (m *Memory) CreatePhoneChallenge(_ context.Context, c PhoneChallenge) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.phoneChs[c.ID] = c
	return nil
}

func (m *Memory) GetPhoneChallenge(_ context.Context, id string) (*PhoneChallenge, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.phoneChs[id]
	if !ok {
		return nil, nil
	}
	return &c, nil
}

func (m *Memory) UpdatePhoneChallenge(ctx context.Context, c PhoneChallenge) error {
	return m.CreatePhoneChallenge(ctx, c)
}

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

// RequestPhoneVerification：KYC-PHONE-ONLY-001 第 2 步——真的发一条验证码。
// 不要求这个手机号已经注册成任何东西的登录凭据；谁在申请、发到哪个号，
// 由 userAccountID + phone 这一次请求自己定。
func (s *Service) RequestPhoneVerification(ctx context.Context, userAccountID, phone string) (*PhoneChallenge, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	phone = normalizePhone(phone)
	if digits := strings.TrimPrefix(phone, "+"); len(digits) < 8 || len(digits) > 15 || !strings.HasPrefix(phone, "+") {
		return nil, &ValidationError{Fields: []string{"phone"}}
	}
	providerRef, expiresAt, err := s.deps.Phone.RequestOTP(ctx, phone, "PROVIDER_APPLICATION_PHONE_VERIFY")
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPhoneProviderGap, err)
	}
	now := s.now().UTC()
	if expiresAt.IsZero() || !expiresAt.After(now) {
		expiresAt = now.Add(5 * time.Minute)
	}
	challenge := PhoneChallenge{
		ID: newPhoneChallengeID(), UserAccountID: userAccountID, Phone: phone, ProviderRef: providerRef,
		Status: PhoneChallengePending, MaxAttempts: 5, RequestedAt: now, ExpiresAt: expiresAt.UTC(),
	}
	if err := s.phoneStore.CreatePhoneChallenge(ctx, challenge); err != nil {
		return nil, err
	}
	return &challenge, nil
}

// VerifyPhoneVerification：核对验证码。成功后 challenge.Status 变 VERIFIED——
// Submit 会重新查一遍这条记录，不会把"验证过了"这件事托付给客户端自己说。
func (s *Service) VerifyPhoneVerification(ctx context.Context, userAccountID, challengeID, code string) (*PhoneChallenge, error) {
	if !s.ready() {
		return nil, ErrUnavailable
	}
	challenge, err := s.phoneStore.GetPhoneChallenge(ctx, challengeID)
	if err != nil {
		return nil, err
	}
	if challenge == nil || challenge.UserAccountID != userAccountID {
		return nil, ErrNotFound
	}
	now := s.now().UTC()
	if challenge.Status != PhoneChallengePending || challenge.Attempts >= challenge.MaxAttempts || !now.Before(challenge.ExpiresAt) {
		return nil, ErrPhoneChallenge
	}
	verified, err := s.deps.Phone.VerifyOTP(ctx, challenge.ProviderRef, code)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPhoneProviderGap, err)
	}
	if !verified {
		challenge.Attempts++
		if challenge.Attempts >= challenge.MaxAttempts {
			challenge.Status = PhoneChallengeLocked
		}
		if err := s.phoneStore.UpdatePhoneChallenge(ctx, *challenge); err != nil {
			return nil, err
		}
		return nil, ErrPhoneChallenge
	}
	challenge.Status = PhoneChallengeVerified
	challenge.VerifiedAt = now
	if err := s.phoneStore.UpdatePhoneChallenge(ctx, *challenge); err != nil {
		return nil, err
	}
	return challenge, nil
}
