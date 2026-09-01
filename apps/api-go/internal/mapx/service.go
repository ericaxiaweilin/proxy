package mapx

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

// ItemKind is the discriminator for items returned by /v1/map/items.
// Wire format is the lowercase string ("post", "agent", "order").
type ItemKind string

const (
	KindPost  ItemKind = "post"
	KindAgent ItemKind = "agent"
	KindOrder ItemKind = "order"
)

// BBox is the rectangle used for spatial queries. Coordinates are WGS-84.
// SW = south-west (lower-left), NE = north-east (upper-right).
type BBox struct {
	SWLat float64
	SWLng float64
	NELat float64
	NELng float64
}

// ParseBBox reads sw_lat / sw_lng / ne_lat / ne_lng from a query string.
// All four are required and must parse as floats. The result is range
// checked: |lat| ≤ 90, |lng| ≤ 180, and SW must be south-and-west of NE.
func ParseBBox(q map[string][]string) (BBox, error) {
	get := func(name string) (float64, error) {
		v := first(q[name])
		if v == "" {
			return 0, fmt.Errorf("missing %s", name)
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid %s: %v", name, err)
		}
		return f, nil
	}
	swLat, err := get("sw_lat")
	if err != nil {
		return BBox{}, err
	}
	swLng, err := get("sw_lng")
	if err != nil {
		return BBox{}, err
	}
	neLat, err := get("ne_lat")
	if err != nil {
		return BBox{}, err
	}
	neLng, err := get("ne_lng")
	if err != nil {
		return BBox{}, err
	}
	if swLat < -90 || swLat > 90 || neLat < -90 || neLat > 90 {
		return BBox{}, fmt.Errorf("lat out of range: sw=%v ne=%v", swLat, neLat)
	}
	if swLng < -180 || swLng > 180 || neLng < -180 || neLng > 180 {
		return BBox{}, fmt.Errorf("lng out of range: sw=%v ne=%v", swLng, neLng)
	}
	if swLat > neLat {
		return BBox{}, fmt.Errorf("sw_lat (%v) must be <= ne_lat (%v)", swLat, neLat)
	}
	if swLng > neLng {
		return BBox{}, fmt.Errorf("sw_lng (%v) must be <= ne_lng (%v)", swLng, neLng)
	}
	return BBox{SWLat: swLat, SWLng: swLng, NELat: neLat, NELng: neLng}, nil
}

// ParseKinds parses the optional `types` query parameter into a set of
// item kinds. Empty / missing means "all". Duplicates are deduped.
// Invalid kinds cause a 400. Accepts both singular and plural forms
// ("post" or "posts", "agent" or "agents", "order" or "orders") so the
// client can be lazy about pluralization.
func ParseKinds(q map[string][]string) (map[ItemKind]bool, error) {
	raw := first(q["types"])
	if raw == "" {
		return map[ItemKind]bool{KindPost: true, KindAgent: true, KindOrder: true}, nil
	}
	aliases := map[string]ItemKind{
		"post": KindPost, "posts": KindPost,
		"agent": KindAgent, "agents": KindAgent,
		"order": KindOrder, "orders": KindOrder,
	}
	out := make(map[ItemKind]bool)
	for _, p := range splitComma(raw) {
		k, ok := aliases[p]
		if !ok {
			return nil, fmt.Errorf("unknown map item type %q (want post|agent|order)", p)
		}
		out[k] = true
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("types filter resolved to empty set")
	}
	return out, nil
}

// ParseLimit returns the optional `limit` query parameter, clamped to
// [1, 500]. Default 200.
func ParseLimit(q map[string][]string) int {
	raw := first(q["limit"])
	if raw == "" {
		return 200
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 200
	}
	if n > 500 {
		return 500
	}
	return n
}

// PostPin is the projection of a localnet.posts row onto a map pin.
// ID, author and timestamp let the client render an Instagram-style
// "tap pin → bottom sheet preview" without a follow-up fetch.
//
// ThumbnailURL is the best-effort cover image (first media asset's
// thumbnail). Empty when the post has no media or the cover hasn't
// been transcoded yet. The mobile client falls back to a colored
// placeholder in that case.
type PostPin struct {
	Kind         ItemKind `json:"kind"`
	ID           string    `json:"id"`
	Lat          float64   `json:"lat"`
	Lng          float64   `json:"lng"`
	AuthorID     string    `json:"authorId"`
	AuthorName   string    `json:"authorName"`
	CityScope    string    `json:"cityScope"`
	SceneType    string    `json:"sceneType"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"createdAt"`
	MediaCount   int       `json:"mediaCount"`
	MediaType    string    `json:"mediaType,omitempty"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
}

// AgentPin is the projection of a supply.agent_profiles row.
type AgentPin struct {
	Kind         ItemKind `json:"kind"`
	ID           string    `json:"id"`
	Lat          float64   `json:"lat"`
	Lng          float64   `json:"lng"`
	Name         string    `json:"name"`
	Bio          string    `json:"bio"`
	ServiceAreas []string  `json:"serviceAreas"`
	Languages    []string  `json:"languages"`
	PhotoCount   int       `json:"photoCount"`
	Availability string    `json:"availability"`
}

// OrderPin is the projection of a fulfillment.orders row. We surface
// only the bare minimum needed for a map preview (the rest of the
// detail comes from the existing order endpoint).
type OrderPin struct {
	Kind    ItemKind `json:"kind"`
	ID      string    `json:"id"`
	Lat     float64   `json:"lat"`
	Lng     float64   `json:"lng"`
	Title   string    `json:"title"`
	Status  string    `json:"status"`
	Budget  int64     `json:"budget"`
	City    string    `json:"city"`
	Area    string    `json:"area"`
	StartAt time.Time `json:"startAt"`
}

// Payload is the wire response. Fields are omitempty so a `types=posts`
// filter only returns the posts array.
type Payload struct {
	Posts  []PostPin  `json:"posts,omitempty"`
	Agents []AgentPin `json:"agents,omitempty"`
	Orders []OrderPin `json:"orders,omitempty"`
	BBox   BBox       `json:"bbox"`
	Count  int        `json:"count"`
}

// Repository is the storage interface. One method per item kind so the
// queries are independent and the caller's "types" filter maps to a
// subset of method calls.
type Repository interface {
	ListPostsInBBox(ctx context.Context, bbox BBox, limit int) ([]PostPin, error)
	ListAgentsInBBox(ctx context.Context, bbox BBox, limit int) ([]AgentPin, error)
	ListOrdersInBBox(ctx context.Context, bbox BBox, limit int) ([]OrderPin, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func New(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

func (s *Service) Items(ctx context.Context, bbox BBox, kinds map[ItemKind]bool, limit int) (Payload, error) {
	if s.repo == nil {
		// DATABASE_URL is unset. The handler treats this as 503 before
		// reaching us, but guard here too so direct callers see the
		// right behaviour.
		return Payload{BBox: bbox}, nil
	}
	p := Payload{BBox: bbox}
	if kinds[KindPost] {
		ps, err := s.repo.ListPostsInBBox(ctx, bbox, limit)
		if err != nil {
			return Payload{}, fmt.Errorf("list posts: %w", err)
		}
		p.Posts = ps
	}
	if kinds[KindAgent] {
		ag, err := s.repo.ListAgentsInBBox(ctx, bbox, limit)
		if err != nil {
			return Payload{}, fmt.Errorf("list agents: %w", err)
		}
		ag = applyAvailabilityWindows(ctx, ag)
		p.Agents = ag
	}
	if kinds[KindOrder] {
		os, err := s.repo.ListOrdersInBBox(ctx, bbox, limit)
		if err != nil {
			return Payload{}, fmt.Errorf("list orders: %w", err)
		}
		p.Orders = os
	}
	p.Count = len(p.Posts) + len(p.Agents) + len(p.Orders)
	return p, nil
}

// applyAvailabilityWindows is a stub hook — the agent repo already joins
// the most recent availability window, so this is a no-op for now.
// Keeping the seam so R15.32.1 can plug in cross-table enrichment
// (e.g. "online now" overlays) without touching the service.
func applyAvailabilityWindows(_ context.Context, agents []AgentPin) []AgentPin {
	return agents
}

// ---- helpers ----

func first(s []string) string {
	if len(s) == 0 {
		return ""
	}
	return s[0]
}

func splitComma(s string) []string {
	out := []string{}
	cur := ""
	for _, r := range s {
		if r == ',' {
			if cur != "" {
				out = append(out, cur)
				cur = ""
			}
			continue
		}
		if r == ' ' {
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
