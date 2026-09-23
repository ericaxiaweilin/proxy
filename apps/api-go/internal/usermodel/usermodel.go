// Package usermodel 是 AI 分身的「用户建模」：小美的物理锚点（身高 / 体重 / 年龄 / 身材 / 肤色 / 发型）
// 和「亚洲人特征锁定」，给 AI 生成她的形象图 / 视频时当约束用（AI-MANAGE-015，
// 用户原型 deepseek_html_20260923_c9c642.html）。
//
// 每一项都记来源：
//   - "ai"：AI 从本人授权的公共图库照片里看出来的（Analyze，走 vision 模型）；
//   - "manual"：本人自己填的 / 改的。本人改过的项，之后 AI 再识别也不覆盖。
//
// 没有的就是没有：没识别出来、本人也没填，就是空，页面显示「待补充」，不编一个数。
// 体重不让 AI 从照片猜（猜不准、也冒犯），只能本人填。
package usermodel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

const (
	SourceAI     = "ai"
	SourceManual = "manual"

	FieldHeight   = "heightCm"
	FieldWeight   = "weightKg"
	FieldAge      = "age"
	FieldBodyType = "bodyType"
	FieldSkinTone = "skinTone"
	FieldHair     = "hair"
)

// Profile 是一个人的用户建模。
type Profile struct {
	OwnerID   string `json:"ownerId"`
	HeightCm  *int   `json:"heightCm,omitempty"`
	WeightKg  *int   `json:"weightKg,omitempty"`
	Age       *int   `json:"age,omitempty"`
	BodyType  string `json:"bodyType,omitempty"`
	SkinTone  string `json:"skinTone,omitempty"`
	Hair      string `json:"hair,omitempty"`
	AsianLock bool   `json:"asianLock"`
	// Sources：字段 -> ai | manual；没有的字段就是还没有值。
	Sources            map[string]string `json:"sources"`
	AnalyzedPhotoCount int               `json:"analyzedPhotoCount"`
	AnalyzedAt         *time.Time        `json:"analyzedAt,omitempty"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

// Empty 是一个还没建模的人：什么都没有，亚洲人特征锁定默认开（原型默认）。
func Empty(ownerID string) Profile {
	return Profile{OwnerID: ownerID, AsianLock: true, Sources: map[string]string{}}
}

var ErrNotFound = errors.New("user model not found")

type Repository interface {
	Get(ctx context.Context, ownerID string) (Profile, error)
	Save(ctx context.Context, p Profile) error
}

type MemoryRepository struct {
	mu       sync.Mutex
	profiles map[string]Profile
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{profiles: map[string]Profile{}}
}

func (r *MemoryRepository) Get(_ context.Context, ownerID string) (Profile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.profiles[ownerID]
	if !ok {
		return Profile{}, ErrNotFound
	}
	return clone(p), nil
}

func (r *MemoryRepository) Save(_ context.Context, p Profile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.profiles[p.OwnerID] = clone(p)
	return nil
}

func clone(p Profile) Profile {
	sources := make(map[string]string, len(p.Sources))
	for k, v := range p.Sources {
		sources[k] = v
	}
	p.Sources = sources
	return p
}

type Service struct {
	repo  Repository
	model modelstack.Port
	now   func() time.Time
}

func NewService(repo Repository, model modelstack.Port) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Service{repo: repo, model: model, now: time.Now}
}

func (s *Service) Get(ctx context.Context, ownerID string) (Profile, error) {
	p, err := s.repo.Get(ctx, ownerID)
	if errors.Is(err, ErrNotFound) {
		return Empty(ownerID), nil
	}
	if p.Sources == nil {
		p.Sources = map[string]string{}
	}
	return p, err
}

// Patch 是本人手动改的部分；nil = 不动。清空一项：数值传 0、文本传 ""（Clear 里列出）。
type Patch struct {
	HeightCm  *int     `json:"heightCm"`
	WeightKg  *int     `json:"weightKg"`
	Age       *int     `json:"age"`
	BodyType  *string  `json:"bodyType"`
	SkinTone  *string  `json:"skinTone"`
	Hair      *string  `json:"hair"`
	AsianLock *bool    `json:"asianLock"`
	Clear     []string `json:"clear"`
}

var ErrInvalid = errors.New("invalid user model value")

// Update 应用本人手动修改；改过的项来源标 manual（之后 AI 不覆盖）。
func (s *Service) Update(ctx context.Context, ownerID string, patch Patch) (Profile, error) {
	p, err := s.Get(ctx, ownerID)
	if err != nil {
		return Profile{}, err
	}
	setInt := func(field string, dst **int, v *int, min, max int) error {
		if v == nil {
			return nil
		}
		if *v < min || *v > max {
			return fmt.Errorf("%w: %s out of range", ErrInvalid, field)
		}
		value := *v
		*dst = &value
		p.Sources[field] = SourceManual
		return nil
	}
	setText := func(field string, dst *string, v *string) {
		if v == nil {
			return
		}
		value := strings.TrimSpace(*v)
		if len([]rune(value)) > 40 {
			value = string([]rune(value)[:40])
		}
		*dst = value
		if value == "" {
			delete(p.Sources, field)
		} else {
			p.Sources[field] = SourceManual
		}
	}
	for _, check := range []error{
		setInt(FieldHeight, &p.HeightCm, patch.HeightCm, 120, 220),
		setInt(FieldWeight, &p.WeightKg, patch.WeightKg, 30, 200),
		setInt(FieldAge, &p.Age, patch.Age, 18, 90),
	} {
		if check != nil {
			return Profile{}, check
		}
	}
	setText(FieldBodyType, &p.BodyType, patch.BodyType)
	setText(FieldSkinTone, &p.SkinTone, patch.SkinTone)
	setText(FieldHair, &p.Hair, patch.Hair)
	for _, field := range patch.Clear {
		switch field {
		case FieldHeight:
			p.HeightCm = nil
		case FieldWeight:
			p.WeightKg = nil
		case FieldAge:
			p.Age = nil
		case FieldBodyType:
			p.BodyType = ""
		case FieldSkinTone:
			p.SkinTone = ""
		case FieldHair:
			p.Hair = ""
		default:
			continue
		}
		delete(p.Sources, field)
	}
	if patch.AsianLock != nil {
		p.AsianLock = *patch.AsianLock
	}
	p.UpdatedAt = s.now().UTC()
	return p, s.repo.Save(ctx, p)
}

// Photo 是一张给模型看的照片（data URI）。只能来自本人授权的图库（调用方负责）。
type Photo struct {
	DataURI string
}

var (
	ErrNoPhotos         = errors.New("no authorised photos to analyse")
	ErrModelUnavailable = errors.New("vision model unavailable")
	ErrUnreadable       = errors.New("model output unreadable")
)

type analysis struct {
	HeightCm *int   `json:"heightCm"`
	Age      *int   `json:"age"`
	BodyType string `json:"bodyType"`
	SkinTone string `json:"skinTone"`
	Hair     string `json:"hair"`
}

const analyzePrompt = `你在帮一位用户给她自己的 AI 分身建模。下面是她本人上传、并授权 AI 使用的照片（同一个人）。
只描述外观特征，不要识别或猜测她是谁。看不清、判断不了的项填 null，不要编。
只输出一个 JSON 对象，不要任何其他文字：
{"heightCm": 整数或null（只有照片里有可靠参照时才估计，否则 null）,
 "age": 整数或null（外观年龄估计）,
 "bodyType": "身材，中文短语，如 匀称型 · Mesomorph / 纤细型 · Ectomorph / 丰满型 · Endomorph" 或 null,
 "skinTone": "肤色，Fitzpatrick 分级 + 底调，如 Fitzpatrick II · 暖金底" 或 null,
 "hair": "发型 · 发色，如 长直发 · 黑色" 或 null}`

// Analyze 让 vision 模型从本人授权的照片里识别外观特征，写成来源 ai 的项；本人手动改过的项不覆盖。
// 返回更新后的建模和这次识别出的特征数。
func (s *Service) Analyze(ctx context.Context, ownerID string, photos []Photo) (Profile, int, error) {
	if len(photos) == 0 {
		return Profile{}, 0, ErrNoPhotos
	}
	if s.model == nil || !s.model.Available() {
		return Profile{}, 0, ErrModelUnavailable
	}
	parts := []modelstack.ContentPart{{Type: "text", Text: analyzePrompt}}
	for _, photo := range photos {
		parts = append(parts, modelstack.ContentPart{Type: "image_url", ImageURL: &modelstack.ImageURL{URL: photo.DataURI}})
	}
	completion, err := s.model.Complete(ctx, "proxy.twin.user_modeling_vision", []modelstack.ChatMessage{{Role: "user", Parts: parts}})
	if err != nil {
		if errors.Is(err, modelstack.ErrTaskNotRoutable) || errors.Is(err, modelstack.ErrUnconfigured) {
			return Profile{}, 0, fmt.Errorf("%w: %v", ErrModelUnavailable, err)
		}
		return Profile{}, 0, err
	}
	found, err := parseAnalysis(completion.Content)
	if err != nil {
		return Profile{}, 0, err
	}
	p, err := s.Get(ctx, ownerID)
	if err != nil {
		return Profile{}, 0, err
	}
	recognised := 0
	manual := func(field string) bool { return p.Sources[field] == SourceManual }
	if v := found.HeightCm; v != nil && *v >= 120 && *v <= 220 {
		recognised++
		if !manual(FieldHeight) {
			value := *v
			p.HeightCm, p.Sources[FieldHeight] = &value, SourceAI
		}
	}
	if v := found.Age; v != nil && *v >= 18 && *v <= 90 {
		recognised++
		if !manual(FieldAge) {
			value := *v
			p.Age, p.Sources[FieldAge] = &value, SourceAI
		}
	}
	for _, item := range []struct {
		field string
		dst   *string
		value string
	}{
		{FieldBodyType, &p.BodyType, found.BodyType},
		{FieldSkinTone, &p.SkinTone, found.SkinTone},
		{FieldHair, &p.Hair, found.Hair},
	} {
		value := strings.TrimSpace(item.value)
		if value == "" || strings.EqualFold(value, "null") {
			continue
		}
		recognised++
		if !manual(item.field) {
			if len([]rune(value)) > 40 {
				value = string([]rune(value)[:40])
			}
			*item.dst, p.Sources[item.field] = value, SourceAI
		}
	}
	now := s.now().UTC()
	p.AnalyzedPhotoCount = len(photos)
	p.AnalyzedAt = &now
	p.UpdatedAt = now
	return p, recognised, s.repo.Save(ctx, p)
}

// parseAnalysis 从模型输出里取出第一个 JSON 对象（模型偶尔会包一层 ```json）。
func parseAnalysis(raw string) (analysis, error) {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return analysis{}, ErrUnreadable
	}
	var found analysis
	if err := json.Unmarshal([]byte(raw[start:end+1]), &found); err != nil {
		return analysis{}, fmt.Errorf("%w: %v", ErrUnreadable, err)
	}
	return found, nil
}
