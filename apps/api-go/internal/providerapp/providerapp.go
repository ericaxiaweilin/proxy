// Package providerapp 是「申请接单权限」（PROVIDER-APPLY-001 → ORDER-PERMISSION-001，2026-09-24）。
//
// 接单资格以前没有申请入口，supply.agent_profiles 只能靠种子 / 手工 SQL 开。选定「申请 + 运营审核」：
// 用户更正：「不是申请成为小美 是申请接单权限 如果只是小美有性别歧视限制」—— 任何人都能申请，性别不是门槛。
//
//	本人提交（实名、≥3 张本人真实照片并承诺为本人、可服务区域 / 语言 / 能力、自我介绍）
//	→ 运营控制台审核（通过 / 拒绝并写原因）
//	→ 通过才开 supply.agent_profiles（ACTIVE）并声明能力（declared —— 审核不等于能力核验，verified 另走核验）。
//
// 资料门跟发帖同一道（POST-PROFILE-GATE-001：用户名 + 平台头像）；照片必须是本人上传、非 AI 生成的图。
// 实名只给运营看：用户侧读模型里不回实名以外的任何别人信息，运营列表才带实名。
package providerapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
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

	MinPhotos   = 3
	MaxPhotos   = 9
	MaxIntro    = 500
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

// Input 是本人提交的表单。
type Input struct {
	RealName       string   `json:"realName"`
	PhotosAttested bool     `json:"photosAttested"`
	City           string   `json:"city"`
	ServiceAreas   []string `json:"serviceAreas"`
	Languages      []string `json:"languages"`
	Capabilities   []string `json:"capabilities"`
	Intro          string   `json:"intro"`
	PhotoAssetIDs  []string `json:"photoAssetIds"`
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
	return s != nil && s.store != nil && s.deps.Missing != nil && s.deps.BadPhotos != nil && s.deps.Activate != nil
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
	in = normalize(in)
	fields := []string{}
	for _, m := range s.deps.Missing(ctx, userAccountID) {
		fields = append(fields, "profile_"+m)
	}
	fields = append(fields, validate(in)...)
	if len(in.PhotoAssetIDs) >= MinPhotos && len(in.PhotoAssetIDs) <= MaxPhotos {
		bad, err := s.deps.BadPhotos(ctx, userAccountID, in.PhotoAssetIDs)
		if err != nil {
			return nil, err
		}
		if len(bad) > 0 {
			fields = append(fields, "photos_not_own_real")
		}
	}
	if len(fields) > 0 {
		return nil, &ValidationError{Fields: fields}
	}
	now := s.now().UTC()
	app := Application{
		ID: newID(), UserAccountID: userAccountID, RealName: in.RealName, PhotosAttested: true,
		City: in.City, ServiceAreas: in.ServiceAreas, Languages: in.Languages, Capabilities: in.Capabilities,
		Intro: in.Intro, PhotoAssetIDs: in.PhotoAssetIDs, Status: StatusSubmitted, Source: "APP",
		CreatedAt: now, UpdatedAt: now,
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
	in.City = strings.TrimSpace(in.City)
	in.Intro = strings.TrimSpace(in.Intro)
	in.ServiceAreas = dedupe(in.ServiceAreas, strings.ToLower)
	in.Languages = dedupe(in.Languages, strings.ToUpper)
	in.Capabilities = dedupe(in.Capabilities, strings.ToUpper)
	in.PhotoAssetIDs = dedupe(in.PhotoAssetIDs, func(s string) string { return strings.TrimPrefix(s, "assets/") })
	return in
}

func validate(in Input) []string {
	fields := []string{}
	if n := utf8.RuneCountInString(in.RealName); n < 2 || n > MaxRealName {
		fields = append(fields, "real_name")
	}
	if !in.PhotosAttested {
		fields = append(fields, "photos_attested")
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
	if !subset(in.Capabilities, AllowedCapabilities) {
		fields = append(fields, "capabilities")
	}
	if n := utf8.RuneCountInString(in.Intro); n < 10 || n > MaxIntro {
		fields = append(fields, "intro")
	}
	if len(in.PhotoAssetIDs) < MinPhotos || len(in.PhotoAssetIDs) > MaxPhotos {
		fields = append(fields, "photos_count")
	}
	return fields
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
