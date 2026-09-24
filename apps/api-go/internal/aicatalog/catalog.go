// Package aicatalog 读运营维护的 AI 目录文件（config/ai-catalog/catalog.json + logos/*.svg）：
// 出图厂商、模型、价格、logo、免费额度、聊天 Token 由谁付费。
//
// AI-MANAGE-007（2026-09-23，用户：「价格 logo 数字…肯定加载专门的文件 别写在代码里 token 的费用
// 属于高度变化的 后期运营了 直接对接 自动更新就好了」）：这些数据不进代码。运营 / 同步任务直接
// 覆盖目录里的文件，服务端按文件修改时间自动重载，不用发版、不用重启。
//
// 坏文件不会把线上打挂：新文件解析或校验失败时继续用上一份好的，并打日志。
package aicatalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Price struct {
	Label    string   `json:"label"`
	Currency string   `json:"currency,omitempty"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Unit     string   `json:"unit"` // image | month | metered
}

type Model struct {
	Name         string `json:"name"`
	Price        Price  `json:"price"`
	Tag          string `json:"tag,omitempty"`
	Subscription bool   `json:"subscription,omitempty"`
}

type Rank struct {
	Quality float64 `json:"quality"`
	Price   float64 `json:"price"`
	Popular float64 `json:"popular"`
}

type Vendor struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Desc      string  `json:"desc"`
	Logo      string  `json:"logo"`              // 文件里：logos/ 下的相对路径
	LogoSVG   string  `json:"logoSvg,omitempty"` // 下发时：内联 SVG 内容
	LogoBg    string  `json:"logoBg"`
	Recommend bool    `json:"recommend,omitempty"`
	Pinned    bool    `json:"pinned,omitempty"`
	Rank      Rank    `json:"rank"`
	Models    []Model `json:"models"`
}

type ImageBilling struct {
	Payer              string `json:"payer"`
	FreeImagesPerMonth int    `json:"freeImagesPerMonth"`
	FreeVendor         string `json:"freeVendor"`
	PriceNotice        string `json:"priceNotice"`
}

type ChatBilling struct {
	Payer            string   `json:"payer"`
	PricePer1kTokens *float64 `json:"pricePer1kTokens"`
}

type Catalog struct {
	Version      string       `json:"version"`
	ImageBilling ImageBilling `json:"imageBilling"`
	ChatBilling  ChatBilling  `json:"chatBilling"`
	Vendors      []Vendor     `json:"vendors"`
	LoadedAt     time.Time    `json:"loadedAt"`
}

// Load 读目录并把 logo 内联进 Vendor.LogoSVG。
func Load(dir string) (Catalog, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "catalog.json"))
	if err != nil {
		return Catalog{}, err
	}
	var catalog Catalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return Catalog{}, fmt.Errorf("catalog.json: %w", err)
	}
	if err := validate(catalog); err != nil {
		return Catalog{}, err
	}
	for i := range catalog.Vendors {
		logoPath := filepath.Clean(filepath.Join(dir, catalog.Vendors[i].Logo))
		if !strings.HasPrefix(logoPath, filepath.Clean(dir)+string(filepath.Separator)) {
			return Catalog{}, fmt.Errorf("vendor %s: logo path escapes the catalog dir", catalog.Vendors[i].ID)
		}
		svg, err := os.ReadFile(logoPath)
		if err != nil {
			return Catalog{}, fmt.Errorf("vendor %s logo: %w", catalog.Vendors[i].ID, err)
		}
		catalog.Vendors[i].LogoSVG = strings.TrimSpace(string(svg))
	}
	catalog.LoadedAt = time.Now().UTC()
	return catalog, nil
}

func validate(c Catalog) error {
	if strings.TrimSpace(c.Version) == "" {
		return errors.New("catalog: version is required")
	}
	if c.ImageBilling.FreeImagesPerMonth < 0 {
		return errors.New("catalog: freeImagesPerMonth must be >= 0")
	}
	if len(c.Vendors) == 0 {
		return errors.New("catalog: at least one vendor is required")
	}
	seen := map[string]bool{}
	for _, v := range c.Vendors {
		if v.ID == "" || v.Name == "" || v.Logo == "" {
			return fmt.Errorf("catalog: vendor needs id, name and logo: %+v", v.ID)
		}
		if seen[v.ID] {
			return fmt.Errorf("catalog: duplicate vendor %s", v.ID)
		}
		seen[v.ID] = true
		for _, m := range v.Models {
			if m.Name == "" || m.Price.Label == "" {
				return fmt.Errorf("catalog: vendor %s has a model without name or price label", v.ID)
			}
		}
	}
	return nil
}

// Store 缓存当前目录，文件（catalog.json 或任何 logo）修改后下次读取时自动重载。
type Store struct {
	dir      string
	mu       sync.Mutex
	current  *Catalog
	stamp    string
	lastErr  error
	statFunc func(string) (os.FileInfo, error)
}

func NewStore(dir string) *Store {
	return &Store{dir: dir, statFunc: os.Stat}
}

func (s *Store) Dir() string { return s.dir }

// fingerprint = catalog.json 与 logos/ 下每个文件的修改时间 + 大小。
func (s *Store) fingerprint() string {
	var b strings.Builder
	if info, err := s.statFunc(filepath.Join(s.dir, "catalog.json")); err == nil {
		fmt.Fprintf(&b, "%d:%d;", info.ModTime().UnixNano(), info.Size())
	}
	entries, _ := os.ReadDir(filepath.Join(s.dir, "logos"))
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil {
			fmt.Fprintf(&b, "%s:%d:%d;", entry.Name(), info.ModTime().UnixNano(), info.Size())
		}
	}
	return b.String()
}

// Current 返回当前目录；文件变了就重载，重载失败继续用上一份好的。
func (s *Store) Current() (Catalog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stamp := s.fingerprint()
	if s.current != nil && stamp == s.stamp {
		return *s.current, nil
	}
	loaded, err := Load(s.dir)
	if err != nil {
		if s.current != nil {
			if s.lastErr == nil || s.lastErr.Error() != err.Error() {
				log.Printf("ai catalog: reload failed, keeping version %s: %v", s.current.Version, err)
			}
			s.lastErr = err
			s.stamp = stamp
			return *s.current, nil
		}
		return Catalog{}, err
	}
	if s.current == nil || s.current.Version != loaded.Version {
		log.Printf("ai catalog: loaded version %s (%d vendors) from %s", loaded.Version, len(loaded.Vendors), s.dir)
	}
	s.current, s.stamp, s.lastErr = &loaded, stamp, nil
	return loaded, nil
}
