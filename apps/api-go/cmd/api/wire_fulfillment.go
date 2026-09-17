package main

// 履约 related：批量创建器与跨域适配器。

import (
	"context"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/jurisdiction"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/scene"
	"github.com/proxy-app/proxy-api/internal/supply"
	"log"
	"strings"
	"time"
)

func newSupplyBatchCreator(supplyService *supply.Service) demand.BatchCreator {
	return &demand.SupplyBatchCreator{
		CreateFunc: func(ctx context.Context, draft demand.TaskDraft) error {
			startAt, _ := draft.Changes["startAt"].(string)
			endAt, _ := draft.Changes["endAt"].(string)
			if startAt == "" {
				return nil
			}
			durationH := 8
			if s, err := time.Parse(time.RFC3339, startAt); err == nil {
				if e, err2 := time.Parse(time.RFC3339, endAt); err2 == nil {
					h := int(e.Sub(s).Hours())
					if h > 0 && h <= 24 {
						durationH = h
					}
				}
			}
			marketID := "hn"
			if loc, ok := draft.Changes["location"].(map[string]any); ok {
				if label, ok := loc["label"].(string); ok && (label == "HCM" || label == "hcm" || label == "胡志明") {
					marketID = "hcm"
				}
			}
			// languages / capabilities from mustRequirements + slotGroups (dynamic, not hard-coded)
			languagesSet := map[string]bool{}
			capabilitiesSet := map[string]bool{}
			collectLangCap := func(s string) {
				ls := strings.ToLower(s)
				if strings.Contains(ls, "zh") || strings.Contains(ls, "中文") || strings.Contains(ls, "chinese") {
					languagesSet["ZH"] = true
				} else if strings.Contains(ls, "vi") || strings.Contains(ls, "越南") {
					languagesSet["VI"] = true
				} else if strings.Contains(ls, "en") || strings.Contains(ls, "英语") || strings.Contains(ls, "english") {
					languagesSet["EN"] = true
				} else if ls != "" {
					// treat as capability code (upper)
					capabilitiesSet[strings.ToUpper(strings.TrimSpace(s))] = true
				}
			}
			if reqs, ok := draft.Changes["mustRequirements"].([]any); ok {
				for _, r := range reqs {
					if s, ok := r.(string); ok {
						collectLangCap(s)
					}
				}
			}
			if groups, ok := draft.Changes["slotGroups"].([]any); ok {
				for _, g := range groups {
					if gm, ok := g.(map[string]any); ok {
						if role, ok := gm["roleId"].(string); ok {
							collectLangCap(role)
						}
					}
				}
			}
			var languages []string
			for k := range languagesSet {
				languages = append(languages, k)
			}
			var capabilities []string
			for k := range capabilitiesSet {
				capabilities = append(capabilities, k)
			}
			payload := map[string]any{
				"needId":    draft.ID,
				"marketId":  marketID,
				"startAt":   startAt,
				"durationH": durationH,
			}
			if len(languages) > 0 {
				payload["languages"] = languages
			}
			if len(capabilities) > 0 {
				payload["capabilities"] = capabilities
			}
			env := command.Envelope{
				CommandID:      "batch_" + draft.ID,
				CommandType:    "CreateCandidateBatch",
				CommandVersion: 1,
				Actor:          command.Actor{Type: "SYSTEM", ID: "system_batch"},
				Principal:      command.Principal{Type: "SYSTEM", ID: "system_batch"},
				Target:         command.Target{Type: "CandidateBatch", ID: draft.ID},
				IdempotencyKey: "batch_" + draft.ID,
				AuthContext:    map[string]any{"system": true},
				Purpose:        "auto_batch",
				CorrelationID:  "batch_" + draft.ID,
				RequestedAt:    time.Now().UTC().Format(time.RFC3339),
				Payload:        payload,
			}
			result := supplyService.HandleContext(ctx, env)
			if result.Outcome == "REJECTED" {
				log.Printf("auto batch: rejected need=%s err=%v", draft.ID, result.Error)
				return nil
			}
			log.Printf("auto batch: created for need=%s market=%s duration=%d", draft.ID, marketID, durationH)
			return nil
		},
	}
}

// bootEnvWarnings returns a list of human-readable warnings when the
// current process is missing env that production deployments are
// expected to set. We never fatal out: an in-memory dev environment
// is still useful. But the warnings appear in `journalctl` so an SRE
// triaging a misconfigured prod box sees them on the first lines of
// the log. Implementation lives in internal/bootenv so it can be
// unit-tested without touching the process environment.

// wireIdentityEmailResolver 把 identity repo 暴露给 SMTP challenge provider,
// 这样 Request 拿 LoginIdentityID 就能找到对应的 email identifier 发邮件。
// resolver 必须是 idempotent + 并发安全 (多 goroutine 同时触发 challenge).
// 不注册此 resolver 会让 SMTP 走 fail-closed 路径, EMAIL challenge 返
// LOGIN_PROVIDER_NOT_CONFIGURED — 因此 PG 模式启动时必须调用。
type jurisdictionAdapter struct {
	svc *jurisdiction.Service
}

// marketplaceFulfillmentAdapter bridges marketplace.OrderCreator to
// fulfillment.TransactionalRepository. It composes a marketplace
// OrderRecord into a fulfillment.Order snapshot before delegating to
// CreateOrder. ServiceSKU defaults to CITY_COMPANION (matches
// AcceptSlotOffer) until bilateral negotiation fields (duration,
// startTime, meetingContext) are recorded via amendments.
type marketplaceFulfillmentAdapter struct {
	repo fulfillment.TransactionalRepository
}

type sceneFulfillmentAdapter struct {
	repo fulfillment.TransactionalRepository
}

func (a sceneFulfillmentAdapter) EnsureInvitationOrder(ctx context.Context, record scene.InvitationOrderRecord) error {
	now := time.Now().UTC()
	return a.repo.EnsureOrder(ctx, fulfillment.Order{ID: record.ID, RequesterID: record.RequesterID, AgentID: record.AgentID, NeedID: record.SceneID, Lifecycle: "CONFIRMED", Version: 1, Snapshot: fulfillment.OrderSnapshot{Requester: record.RequesterID, Agent: record.AgentID, ServiceSKU: record.ServiceSKU, NeedVersion: record.SceneID, StartTime: record.StartTime, MeetingContext: record.MeetingContext, AgreedCompensation: record.AgreedCompensation, Currency: record.Currency, IncludedScope: record.IncludedScope, SettlementMode: "DIRECT_SETTLEMENT"}, CreatedAt: now, UpdatedAt: now})
}

func (a marketplaceFulfillmentAdapter) EnsureOrder(ctx context.Context, record marketplace.OrderRecord) error {
	now := time.Now().UTC()
	snapshot := fulfillment.OrderSnapshot{
		Requester:          record.RequesterID,
		Agent:              record.AgentID,
		ServiceSKU:         "CITY_COMPANION",
		NeedVersion:        record.NeedID,
		AgreedCompensation: 0, // TBD until CreateOffer replaces this
		Currency:           "VND",
		SettlementMode:     "DIRECT_SETTLEMENT",
	}
	return a.repo.EnsureOrder(ctx, fulfillment.Order{
		ID:          record.ID,
		RequesterID: record.RequesterID,
		AgentID:     record.AgentID,
		NeedID:      record.NeedID,
		Lifecycle:   "CONFIRMED",
		Version:     1,
		Snapshot:    snapshot,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
}

func (a jurisdictionAdapter) Resolve(ctx context.Context, userID string) (fulfillment.JurisdictionResolution, error) {
	row, err := a.svc.Resolve(ctx, userID)
	if err != nil {
		return fulfillment.JurisdictionResolution{}, err
	}
	return fulfillment.JurisdictionResolution{
		Wire:   row.Jurisdiction.String(),
		Source: row.Source,
	}, nil
}
