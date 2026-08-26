package runtime

import (
	"encoding/json"
	"fmt"
)

// Budget — §23 性能预算原则
// 动态 UI 不能让“前台轻”变成 Runtime 很重
type Budget struct {
	MaxSchemaPayloadBytes int `json:"max_schema_payload_bytes"` // e.g. 16KB
	MaxDeltaPayloadBytes  int `json:"max_delta_payload_bytes"`  // e.g. 4KB
	MaxNodes              int `json:"max_nodes"`
	MaxImages             int `json:"max_images"`
	MaxCompileLatencyMS   int `json:"max_compile_latency_ms"`
}

func DefaultBudget() Budget {
	return Budget{
		MaxSchemaPayloadBytes: 16 * 1024,
		MaxDeltaPayloadBytes:  4 * 1024,
		MaxNodes:              80,
		MaxImages:             12,
		MaxCompileLatencyMS:   200,
	}
}

func (b Budget) CheckSchema(schema UISchema) error {
	data, _ := json.Marshal(schema)
	if len(data) > b.MaxSchemaPayloadBytes {
		return &ValidationError{Code: "BUDGET_SCHEMA_PAYLOAD", Message: fmt.Sprintf("schema %d > %d bytes", len(data), b.MaxSchemaPayloadBytes)}
	}
	stats := CollectStats(schema.Root, 1)
	if stats.Nodes > b.MaxNodes {
		return &ValidationError{Code: "BUDGET_NODES", Message: fmt.Sprintf("nodes %d > %d", stats.Nodes, b.MaxNodes)}
	}
	if stats.Images > b.MaxImages {
		return &ValidationError{Code: "BUDGET_IMAGES", Message: fmt.Sprintf("images %d > %d", stats.Images, b.MaxImages)}
	}
	return nil
}

func (b Budget) CheckDelta(delta SurfaceDelta) error {
	data, _ := json.Marshal(delta)
	if len(data) > b.MaxDeltaPayloadBytes {
		return &ValidationError{Code: "BUDGET_DELTA_PAYLOAD", Message: fmt.Sprintf("delta %d > %d bytes", len(data), b.MaxDeltaPayloadBytes)}
	}
	return nil
}
