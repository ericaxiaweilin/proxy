package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-PUBLISH-001 dispatch-side tripwire: payload merchantId claims
// are verified against business membership in the api layer; services
// stamp ONLY the annotation. Forged or missing membership → 403, the
// write never reaches the service.

var merchantTestSeq atomic.Int64

func newMerchantTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	srv := NewServer(
		identity.New(nil),
		demand.New(nil, nil),
		citycompanion.New(),
		localnet.New(),
		localcontext.New(),
		conversation.New(),
		engagement.New(),
		fulfillment.New(),
		supply.New(),
		media.New(),
		contribution.New(),
	)
	srv.Authenticator = strictAuthenticator{
		validTokens: map[string]identity.AuthenticatedSession{
			"valid_access_001": {
				Actor:       command.Actor{Type: "USER", ID: "user_real_001"},
				Principal:   command.Principal{Type: "INDIVIDUAL", ID: "user_real_001"},
				SessionID:   "session_real_001",
				AuthContext: map[string]any{"sessionId": "session_real_001"},
			},
			"valid_access_002": {
				Actor:       command.Actor{Type: "USER", ID: "user_stranger_001"},
				Principal:   command.Principal{Type: "INDIVIDUAL", ID: "user_stranger_001"},
				SessionID:   "session_stranger_001",
				AuthContext: map[string]any{"sessionId": "session_stranger_001"},
			},
		},
	}
	bizSvc := business.New()
	srv.Business = bizSvc
	srv.Marketplace = marketplace.New()
	srv.Activity = activity.New()
	// user_real_001 开一家店（OWNER），enschap returned id.
	createEnv := command.Envelope{
		CommandID: "cmd_merchant_setup", CommandType: "CreateBusinessAccount", CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_real_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_real_001"},
		Target:         command.Target{Type: "Business", ID: "new"},
		IdempotencyKey: "idem_merchant_setup_001",
		AuthContext:    map[string]any{},
		Purpose:        "merchant_test_setup",
		CorrelationID:  "corr_merchant_setup",
		RequestedAt:    "2026-09-05T00:00:00Z",
		Payload:        map[string]any{"name": "木光咖啡"},
	}
	created := bizSvc.HandleContext(context.Background(), createEnv)
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("merchant test setup failed: %+v", created)
	}
	var body struct {
		BusinessID string `json:"businessId"`
	}
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil || body.BusinessID == "" {
		t.Fatalf("merchant test setup: no businessId: %v", err)
	}
	return srv, body.BusinessID
}

type merchantCommandResult struct {
	Outcome      string `json:"outcome"`
	OperationRef string `json:"operationRef"`
	Error        *struct {
		ErrorCode string `json:"errorCode"`
	} `json:"error"`
}

func postMerchantCommand(srv *Server, bearer, commandType string, payload map[string]any) (int, merchantCommandResult) {
	// 每次调用唯一幂等键：同一 server 实例内重复调用不能互相 replay。
	n := strconv.FormatInt(merchantTestSeq.Add(1), 10)
	env := apiEnvelope(commandType, payload, command.Target{Type: "Market", ID: "local"}, "idem_merchant_"+n)
	env.CommandID = "cmd_merchant_test_" + n
	rec := requestWithBearer(srv.Handler(), http.MethodPost, "/v1/commands/"+commandType, env, bearer)
	var decoded merchantCommandResult
	_ = json.Unmarshal(rec.Body.Bytes(), &decoded)
	return rec.Code, decoded
}

func validOpportunityPayload(bizID string) map[string]any {
	p := map[string]any{
		"title": "周末咖啡企划", "theme": "咖啡", "date": "周六", "time": "15:00",
		"location": "河内", "price": "200,000₫", "moneyFlow": "EARN",
		"skills": "咖啡", "lens": []string{"NEARBY"},
	}
	if bizID != "" {
		p["merchantId"] = bizID
	}
	return p
}

func TestMerchantPublishOpportunityStampsShop(t *testing.T) {
	srv, bizID := newMerchantTestServer(t)
	code, decoded := postMerchantCommand(srv, "valid_access_001", "PublishMarketOpportunity", validOpportunityPayload(bizID))
	if code != http.StatusOK || decoded.Outcome != "ACCEPTED" {
		t.Fatalf("owner publish as shop: expected 200 ACCEPTED, got %d %+v", code, decoded)
	}
	var parsed struct {
		Opportunity struct {
			Owner     string `json:"owner"`
			OwnerType string `json:"ownerType"`
		} `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(decoded.OperationRef), &parsed); err != nil {
		t.Fatalf("opportunity payload malformed: %v", err)
	}
	if parsed.Opportunity.Owner != "木光咖啡" || parsed.Opportunity.OwnerType != "BUSINESS" {
		t.Fatalf("shop stamp missing: %+v", parsed.Opportunity)
	}
}

func TestMerchantPublishForgedMembershipForbidden(t *testing.T) {
	srv, bizID := newMerchantTestServer(t)
	// stranger 不是该店成员 → 403，写不到 service。
	code, decoded := postMerchantCommand(srv, "valid_access_002", "PublishMarketOpportunity", validOpportunityPayload(bizID))
	if code != http.StatusForbidden || decoded.Error == nil || decoded.Error.ErrorCode != "MERCHANT_FORBIDDEN" {
		t.Fatalf("non-member merchant claim: expected 403 MERCHANT_FORBIDDEN, got %d %+v", code, decoded)
	}
	// 不存在的店 → 403。
	bad := validOpportunityPayload("biz_nope")
	code, decoded = postMerchantCommand(srv, "valid_access_001", "PublishMarketOpportunity", bad)
	if code != http.StatusForbidden || decoded.Error == nil || decoded.Error.ErrorCode != "MERCHANT_FORBIDDEN" {
		t.Fatalf("unknown shop claim: expected 403 MERCHANT_FORBIDDEN, got %d %+v", code, decoded)
	}
}

func TestMerchantPublishActivityStampsMerchant(t *testing.T) {
	srv, bizID := newMerchantTestServer(t)
	payload := map[string]any{
		"title": "周六咖啡品鉴", "time": "周六 15:00", "capacity": 6,
		"venueName": "木光咖啡", "venueIcon": "☕", "venueType": "CAFE",
		"realitySceneId": "bonsaidon", "desc": "品鉴", "consumptionTerm": "SPLIT",
		"merchantId": bizID,
	}
	code, decoded := postMerchantCommand(srv, "valid_access_001", "PublishActivity", payload)
	if code != http.StatusOK || decoded.Outcome != "ACCEPTED" {
		t.Fatalf("owner publish activity as shop: expected 200 ACCEPTED, got %d %+v", code, decoded)
	}
	var parsed struct {
		Activity struct {
			Origin       string `json:"origin"`
			MerchantName string `json:"merchantName"`
		} `json:"activity"`
	}
	if err := json.Unmarshal([]byte(decoded.OperationRef), &parsed); err != nil {
		t.Fatalf("activity payload malformed: %v", err)
	}
	if parsed.Activity.Origin != "MERCHANT" || parsed.Activity.MerchantName != "木光咖啡" {
		t.Fatalf("merchant activity stamp missing: %+v", parsed.Activity)
	}
}

func TestMerchantPublishWithoutMerchantStaysPersonal(t *testing.T) {
	srv, _ := newMerchantTestServer(t)
	code, decoded := postMerchantCommand(srv, "valid_access_001", "PublishMarketOpportunity", validOpportunityPayload(""))
	if code != http.StatusOK || decoded.Outcome != "ACCEPTED" {
		t.Fatalf("personal publish: expected 200 ACCEPTED, got %d %+v", code, decoded)
	}
	var parsed struct {
		Opportunity struct {
			Owner     string `json:"owner"`
			OwnerType string `json:"ownerType"`
		} `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(decoded.OperationRef), &parsed); err != nil {
		t.Fatalf("opportunity payload malformed: %v", err)
	}
	if parsed.Opportunity.OwnerType != "PERSON" {
		t.Fatalf("personal path must stay PERSON, got %+v", parsed.Opportunity)
	}
}
