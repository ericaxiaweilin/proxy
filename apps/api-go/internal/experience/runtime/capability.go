package runtime

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var capabilityPattern = regexp.MustCompile(`^[a-z_]+:v\d+$`)

type ClientCapability struct {
	ClientVersion   string   `json:"client_version"`
	Platform        string   `json:"platform"`
	UIRuntimeVersion string  `json:"ui_runtime_version"`
	Capabilities    []string `json:"capabilities"`
	Limits          struct {
		MaxSchemaDepth       int  `json:"max_schema_depth"`
		MaxNodes             int  `json:"max_nodes"`
		SupportsStreamDelta  bool `json:"supports_stream_delta"`
	} `json:"limits"`
}

func (c ClientCapability) Validate() error {
	if c.ClientVersion == "" || c.UIRuntimeVersion == "" {
		return &ValidationError{Code: "CAPABILITY_MISSING_VERSION", Message: "client_version/ui_runtime_version required"}
	}
	if c.Platform != "ios" && c.Platform != "android" && c.Platform != "web" {
		return &ValidationError{Code: "CAPABILITY_PLATFORM_INVALID", Message: "platform must be ios/android/web"}
	}
	for _, cap := range c.Capabilities {
		if !capabilityPattern.MatchString(cap) {
			return &ValidationError{Code: "CAPABILITY_FORMAT_INVALID", Message: fmt.Sprintf("invalid capability: %s", cap)}
		}
	}
	return nil
}

// IsSupported checks if client capabilities satisfy required like "grid:v2"
func (c ClientCapability) IsSupported(required string) bool {
	parts := strings.Split(required, ":v")
	if len(parts) != 2 {
		return false
	}
	reqName, reqVerStr := parts[0], parts[1]
	reqVer, err := strconv.Atoi(reqVerStr)
	if err != nil {
		return false
	}
	for _, cap := range c.Capabilities {
		p := strings.Split(cap, ":v")
		if len(p) != 2 {
			continue
		}
		if p[0] == reqName {
			if v, err := strconv.Atoi(p[1]); err == nil && v >= reqVer {
				return true
			}
		}
	}
	return false
}

func (c ClientCapability) HasDeltaSupport() bool {
	return c.Limits.SupportsStreamDelta
}
