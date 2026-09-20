package api

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Merchant publish annotation keys. Set on envelope.AuthContext by
// resolveMerchantPublish after membership verification. Services read
// ONLY these keys — never payload.merchantId — so a forged client value
// without membership cannot escalate (MERCHANT-PUBLISH-001).
const (
	merchantAuthKeyID   = "merchantID"
	merchantAuthKeyName = "merchantName"
)

// merchantPublishCommands is the closed set of commands that accept an
// optional merchant identity. Adding a command here requires the owning
// service to stamp from the annotation (never the payload).
var merchantPublishCommands = map[string]bool{
	"PublishMarketOpportunity": true,
	"PublishActivity":          true,
	// VOUCHER-ISSUE-001: 商户发行券定义。merchant_id 只从标注取，
	// 见 voucher.issueDefinition；伪造 payload 到不了 service。
	"IssueVoucherDefinition": true,
}

// resolveMerchantPublish verifies an optional payload merchantId for
// publish commands and annotates the envelope on success. It returns a
// non-nil rejection (already shaped for writeResult) when the claim is
// present but invalid. Absent claim → nil (plain PERSON path, unchanged).
//
// Must run after authentication: envelope.Actor is the server-owned
// session identity at this point, so membership is checked against the
// real user, not a client hint.
func (s *Server) resolveMerchantPublish(ctx context.Context, envelope *command.Envelope) *command.Result {
	if !merchantPublishCommands[envelope.CommandType] {
		return nil
	}
	raw, _ := envelope.Payload["merchantId"].(string)
	if raw == "" {
		return nil
	}
	if s.Business == nil {
		result := command.Rejected(*envelope, "MERCHANT_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "market.merchant_unavailable", nil)
		return &result
	}
	name, ok := s.Business.MerchantPublishIdentity(ctx, raw, envelope.Actor.ID)
	if !ok {
		result := command.Rejected(*envelope, "MERCHANT_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "market.merchant_forbidden", nil)
		return &result
	}
	if envelope.AuthContext == nil {
		envelope.AuthContext = map[string]any{}
	}
	envelope.AuthContext[merchantAuthKeyID] = raw
	envelope.AuthContext[merchantAuthKeyName] = name
	return nil
}

// merchantAnnotation returns the verified merchant identity stamped by
// resolveMerchantPublish, or ("", "", false). Services call this instead
// of reading payload.merchantId.
func merchantAnnotation(envelope command.Envelope) (string, string, bool) {
	if envelope.AuthContext == nil {
		return "", "", false
	}
	id, _ := envelope.AuthContext[merchantAuthKeyID].(string)
	name, _ := envelope.AuthContext[merchantAuthKeyName].(string)
	if id == "" || name == "" {
		return "", "", false
	}
	return id, name, true
}
