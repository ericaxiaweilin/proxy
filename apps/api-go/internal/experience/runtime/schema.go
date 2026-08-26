package runtime

import (
	"fmt"
	"strings"
)

// Primitive allowlist — §4.2 + §9，新增需 Registry 评审
var allowedPrimitives = map[string]bool{
	"text": true, "title": true, "subtitle": true, "image": true, "icon": true, "badge": true, "divider": true, "spacer": true,
	"row": true, "column": true, "stack": true, "grid": true, "list": true, "carousel": true, "section": true, "slot": true,
	"price": true, "distance": true, "eta": true, "countdown": true, "status": true, "progress": true, "score": true, "availability": true, "metric": true, "alert": true,
	"primary_action": true, "secondary_action": true, "choice": true, "chip": true, "toggle": true, "confirm": true, "dismiss": true,
	"map": true, "route": true, "merchant": true, "merchant_list": true, "person": true, "offer": true, "coupon": true, "place": true, "need": true, "reservation": true,
	"input": true, "select": true, "datetime_choice": true, "quantity": true, "location_choice": true,
	"notice": true, "inline_message": true, "warning": true, "success": true, "empty_state": true,
}

type UISchemaNode struct {
	Type     string                 `json:"type"`
	Props    map[string]any         `json:"props,omitempty"`
	Children []UISchemaNode         `json:"children,omitempty"`
	DataRef  string                 `json:"data_ref,omitempty"`
	ActionID string                 `json:"action_id,omitempty"`
}

type UISchema struct {
	SchemaVersion string       `json:"schema_version"`
	Root          UISchemaNode `json:"root"`
}

type SchemaStats struct {
	Depth   int
	Nodes   int
	Actions int
	Images  int
}

func CollectStats(n UISchemaNode, depth int) SchemaStats {
	stats := SchemaStats{Depth: depth, Nodes: 1}
	if n.ActionID != "" {
		stats.Actions = 1
	}
	if n.Type == "image" {
		stats.Images = 1
	}
	for _, c := range n.Children {
		cs := CollectStats(c, depth+1)
		if cs.Depth > stats.Depth {
			stats.Depth = cs.Depth
		}
		stats.Nodes += cs.Nodes
		stats.Actions += cs.Actions
		stats.Images += cs.Images
	}
	return stats
}

func ValidateUISchema(s UISchema) error {
	if s.SchemaVersion == "" {
		return &ValidationError{Code: "SCHEMA_VERSION_MISSING", Message: "schema_version required"}
	}
	if err := validateNode(s.Root); err != nil {
		return err
	}
	stats := CollectStats(s.Root, 1)
	if stats.Depth > 12 {
		return &ValidationError{Code: "SCHEMA_MAX_DEPTH", Message: fmt.Sprintf("depth %d > 12", stats.Depth)}
	}
	if stats.Nodes > 120 {
		return &ValidationError{Code: "SCHEMA_MAX_NODES", Message: fmt.Sprintf("nodes %d > 120", stats.Nodes)}
	}
	if stats.Actions > 8 {
		return &ValidationError{Code: "SCHEMA_MAX_ACTIONS", Message: fmt.Sprintf("actions %d > 8", stats.Actions)}
	}
	if stats.Images > 12 {
		return &ValidationError{Code: "SCHEMA_MAX_IMAGES", Message: fmt.Sprintf("images %d > 12", stats.Images)}
	}
	return nil
}

func validateNode(n UISchemaNode) error {
	if !allowedPrimitives[n.Type] {
		return &ValidationError{Code: "UNKNOWN_PRIMITIVE", Message: fmt.Sprintf("unknown primitive: %s", n.Type)}
	}
	// §17.1 禁止远程可执行代码
	if n.Props != nil {
		serialized := fmt.Sprint(n.Props)
		lower := strings.ToLower(serialized)
		if strings.Contains(lower, "<script") || strings.Contains(lower, "javascript:") {
			return &ValidationError{Code: "REMOTE_CODE_FORBIDDEN", Message: "remote code not allowed"}
		}
	}
	// Action 必须在 Registry
	if n.ActionID != "" {
		if !IsRegisteredAction(n.ActionID) {
			return &ValidationError{Code: "UNKNOWN_ACTION", Message: fmt.Sprintf("unknown action: %s", n.ActionID)}
		}
	}
	for _, c := range n.Children {
		if err := validateNode(c); err != nil {
			return err
		}
	}
	return nil
}
