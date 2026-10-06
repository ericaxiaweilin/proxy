package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// DISPATCH-LOOP-001：自动派单接到履约上。
//
// 邀约以**需求方本人**的身份发（Actor USER = 需求主人），所以走的是同一道 ORDER-SLOT-OWNER-001
// 档位主人校验和同一道现金门 —— 派单不是一条绕开规则的旁路。它能这样发，是因为需求方发布时
// 勾了 autoDispatch（「预算内由平台替我发邀约」）；AuthContext 里写明是受托发的，审计查得出来。
type fulfillmentOfferPort struct {
	svc *fulfillment.Service
}

func (f fulfillmentOfferPort) envelope(run dispatch.Run, commandType, key string, target command.Target, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      key,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: run.RequesterID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: run.RequesterID},
		Target:         target,
		IdempotencyKey: key,
		AuthContext:    map[string]any{"delegatedBy": "dispatch", "dispatchRunId": run.ID, "consent": "task.autoDispatch"},
		Purpose:        "auto_dispatch",
		CorrelationID:  run.ID,
		RequestedAt:    time.Now().UTC().Format(time.RFC3339),
		Payload:        payload,
	}
}

func (f fulfillmentOfferPort) Send(ctx context.Context, run dispatch.Run, c dispatch.Candidate, ttl time.Duration) (string, time.Time, string, error) {
	currency := c.Currency
	if currency == "" {
		currency = "VND"
	}
	key := fmt.Sprintf("dispatch_%s_%d_%s", run.ID, run.Cursor, c.AgentID)
	res := f.svc.HandleContext(ctx, f.envelope(run, "CreateSlotOffer", key, command.Target{Type: "Offer", ID: "new"}, map[string]any{
		"taskId": run.TaskID, "slotId": run.SlotID, "agentId": c.AgentID, "batchId": run.BatchID,
		"agreedCompensation": c.Price, "currency": currency, "ttlSeconds": int64(ttl / time.Second),
	}))
	if res.Outcome == "REJECTED" {
		if res.Error == nil {
			return "", time.Time{}, "REJECTED", nil
		}
		if res.Error.Retryability == "SAFE_RETRY" {
			return "", time.Time{}, "", errors.New(res.Error.ErrorCode)
		}
		return "", time.Time{}, res.Error.ErrorCode, nil
	}
	var out struct {
		OfferID   string `json:"offerId"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &out); err != nil || out.OfferID == "" {
		return "", time.Time{}, "", fmt.Errorf("slot offer accepted without an offer id: %q", res.OperationRef)
	}
	expiresAt, err := time.Parse(time.RFC3339, out.ExpiresAt)
	if err != nil {
		expiresAt = time.Now().Add(ttl)
	}
	return out.OfferID, expiresAt, "", nil
}

func (f fulfillmentOfferPort) Status(ctx context.Context, run dispatch.Run, offerID string) (string, error) {
	res := f.svc.HandleContext(ctx, f.envelope(run, "GetOffer", "dispatch_status_"+offerID+"_"+randomID(), command.Target{Type: "Offer", ID: offerID}, map[string]any{"offerId": offerID}))
	if res.Outcome == "REJECTED" {
		if res.Error != nil && res.Error.Retryability == "SAFE_RETRY" {
			return "", errors.New(res.Error.ErrorCode)
		}
		// 邀约找不到（被清掉了）：不再等它，按撤回处理、顺延下一位。
		return "CANCELLED", nil
	}
	if res.Aggregate == nil {
		return "", errors.New("offer read without aggregate state")
	}
	return res.Aggregate.State, nil
}

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func newDispatchEngine(store dispatch.Repository, fulfillmentService *fulfillment.Service) *dispatch.Engine {
	return &dispatch.Engine{
		Repo:   store,
		Offers: fulfillmentOfferPort{svc: fulfillmentService},
		NewID:  func() string { return "dr_" + randomID() },
	}
}

// dispatchTaskFromDraft 读刚发布的需求里派单要的那几样。预算只认「每档位固定价 + VND」：
// 按小时计价的预算跟服务者的单次标价不是同一个量，比不了就不替人做决定。
func dispatchTaskFromDraft(draft demand.TaskDraft) dispatch.Task {
	t := dispatch.Task{TaskID: draft.ID, RequesterID: draft.OwnerUserAccountID}
	t.MatchingMode, _ = draft.Changes["matchingMode"].(string)
	t.AutoDispatch, _ = draft.Changes["autoDispatch"].(bool)
	t.BudgetVND = fixedVNDBudget(draft.Changes)
	for _, s := range draft.Slots {
		if s.State == "" || s.State == "OPEN" {
			t.SlotIDs = append(t.SlotIDs, s.ID)
		}
	}
	return t
}

func fixedVNDBudget(changes map[string]any) int64 {
	b, ok := changes["budget"].(map[string]any)
	if !ok {
		return 0
	}
	currency, _ := b["currency"].(string)
	mode, _ := b["pricingMode"].(string)
	amount, _ := b["amountMinor"].(float64)
	if currency != "VND" || mode != "PER_SLOT_FIXED" || amount <= 0 {
		return 0
	}
	return int64(amount)
}

// startDispatchFromBatch 在候选批次建好之后为 FAST 需求建派单。批次结果里带着排好序的候选。
func startDispatchFromBatch(ctx context.Context, engine *dispatch.Engine, draft demand.TaskDraft, batchRef string) {
	if engine == nil {
		return
	}
	t := dispatchTaskFromDraft(draft)
	var batch struct {
		BatchID    string `json:"batchId"`
		Candidates []struct {
			AgentID        string `json:"agentId"`
			ReferencePrice int64  `json:"referencePrice"`
			Currency       string `json:"currency"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal([]byte(batchRef), &batch); err != nil {
		log.Printf("dispatch: unreadable batch for need=%s: %v", draft.ID, err)
		return
	}
	t.BatchID = batch.BatchID
	for _, c := range batch.Candidates {
		t.Candidates = append(t.Candidates, dispatch.Candidate{AgentID: c.AgentID, Price: c.ReferencePrice, Currency: c.Currency})
	}
	if ok, why := t.Eligible(); !ok {
		if t.MatchingMode == "FAST" {
			log.Printf("dispatch: FAST need=%s not auto-dispatched: %s", draft.ID, why)
		}
		return
	}
	runs, err := engine.Start(ctx, t)
	if err != nil {
		log.Printf("dispatch: start failed need=%s: %v", draft.ID, err)
		return
	}
	log.Printf("dispatch: started need=%s slots=%d candidates=%d budget=%d", draft.ID, len(runs), len(t.Candidates), t.BudgetVND)
}

// runDispatchLoop 每 10 秒推进一次。多实例同时跑由存储层的 SKIP LOCKED 保证不重复派。
func runDispatchLoop(ctx context.Context, engine *dispatch.Engine) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := engine.Tick(ctx); err != nil {
				log.Printf("dispatch tick failed after %d runs: %v", n, err)
			}
		}
	}
}
