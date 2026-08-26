package runtime

import (
	"sort"
	"strings"
	"sync"
)

// PatternRegistry — §19 Primitive → Pattern → Native 晋升机制
// 动态组合不是永久形态，稳定高频结构可晋升为 Native Experience Component

type PatternSignature string // e.g. "alert+eta+grid:2+merchant_list+primary_action"

type PatternStats struct {
	RenderCount     int64
	UniqueUsers     int64
	SchemaStability float64 // 0..1
	NodeVariance    float64
	InteractionRate float64
	FulfillmentLift float64
}

type PromotionCandidate struct {
	Signature PatternSignature
	Stats     PatternStats
	Example   UISchema
}

type PatternRegistry struct {
	mu       sync.Mutex
	patterns map[PatternSignature]*PatternStats
	examples map[PatternSignature]UISchema
	promoted map[PatternSignature]string // signature → NativeComponent name
}

func NewPatternRegistry() *PatternRegistry {
	return &PatternRegistry{
		patterns: make(map[PatternSignature]*PatternStats),
		examples: make(map[PatternSignature]UISchema),
		promoted: make(map[PatternSignature]string),
	}
}

func SignatureOf(schema UISchema) PatternSignature {
	parts := []string{}
	var walk func(n UISchemaNode)
	walk = func(n UISchemaNode) {
		parts = append(parts, n.Type)
		for _, c := range n.Children {
			walk(c)
		}
	}
	walk(schema.Root)
	sort.Strings(parts)
	return PatternSignature(strings.Join(parts, "+"))
}

func (r *PatternRegistry) Record(schema UISchema) {
	sig := SignatureOf(schema)
	r.mu.Lock()
	defer r.mu.Unlock()
	stats, ok := r.patterns[sig]
	if !ok {
		stats = &PatternStats{}
		r.patterns[sig] = stats
		r.examples[sig] = schema
	}
	stats.RenderCount++
	// naive stability: render count ↑ → stability ↑
	if stats.RenderCount > 100 {
		stats.SchemaStability = 0.95
	} else {
		stats.SchemaStability = float64(stats.RenderCount) / 100 * 0.9
	}
}

func (r *PatternRegistry) Candidates(minRenders int64, minStability float64) []PromotionCandidate {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []PromotionCandidate
	for sig, stats := range r.patterns {
		if stats.RenderCount >= minRenders && stats.SchemaStability >= minStability {
			if _, already := r.promoted[sig]; already {
				continue
			}
			out = append(out, PromotionCandidate{Signature: sig, Stats: *stats, Example: r.examples[sig]})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Stats.RenderCount > out[j].Stats.RenderCount })
	return out
}

func (r *PatternRegistry) Promote(sig PatternSignature, nativeName string) {
	r.mu.Lock()
	r.promoted[sig] = nativeName
	r.mu.Unlock()
}

func (r *PatternRegistry) IsPromoted(sig PatternSignature) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name, ok := r.promoted[sig]
	return name, ok
}

var GlobalPatternRegistry = NewPatternRegistry()
