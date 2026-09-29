package numberlookup

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/marketplace"
)

// 各域的 Finder 适配。Entity 里只放客服处理工单需要的事实（账号 id、状态、条款、
// 时间）；聊天内容、证件、联系方式一概不放。

// OrderSource 由 *fulfillment.Service 实现。
type OrderSource interface {
	FindOrderByNumber(ctx context.Context, orderNo string) (fulfillment.Order, []fulfillment.AuditEntry, error)
}

// ActivitySource 由 *activity.Service 实现。
type ActivitySource interface {
	FindParticipationByNumber(ctx context.Context, orderNo string) (activity.Participation, activity.Activity, error)
	FindActivityByCode(ctx context.Context, code string) (activity.Activity, error)
}

// OpportunitySource 由 *marketplace.Service 实现。
type OpportunitySource interface {
	FindOpportunityByNumber(ctx context.Context, number string) (marketplace.Opportunity, error)
}

type finderFunc func(ctx context.Context, number string) (Match, bool, error)

func (f finderFunc) Find(ctx context.Context, number string) (Match, bool, error) {
	return f(ctx, number)
}

// OrderFinder：履约订单编号。
func OrderFinder(source OrderSource) Finder {
	return finderFunc(func(ctx context.Context, number string) (Match, bool, error) {
		order, trail, err := source.FindOrderByNumber(ctx, number)
		switch {
		case errors.Is(err, fulfillment.ErrOrderNotFound):
			return Match{}, false, nil
		case errors.Is(err, fulfillment.ErrNumberLookupUnsupported):
			return Match{}, false, ErrUnsupported
		case err != nil:
			return Match{}, false, err
		}
		entity := map[string]any{
			"orderId":            order.ID,
			"orderNo":            order.OrderNo,
			"lifecycle":          order.Lifecycle,
			"version":            order.Version,
			"requesterId":        order.RequesterID,
			"agentId":            order.AgentID,
			"needId":             order.NeedID,
			"serviceSku":         order.Snapshot.ServiceSKU,
			"startTime":          order.Snapshot.StartTime,
			"duration":           order.Snapshot.Duration,
			"meetingContext":     order.Snapshot.MeetingContext,
			"agreedCompensation": order.Snapshot.AgreedCompensation,
			"currency":           order.Snapshot.Currency,
			"settlementMode":     order.Snapshot.SettlementMode,
			"createdAt":          iso(order.CreatedAt),
			"updatedAt":          iso(order.UpdatedAt),
			"outcomeRecorded":    order.Outcome != nil,
			"amendments":         amendmentSummary(order.Amendments),
		}
		if order.StoreID != "" {
			entity["storeId"] = order.StoreID
		}
		if order.PolicyDecisionID != "" {
			entity["policyDecisionId"] = order.PolicyDecisionID
		}
		if order.Settlement != nil {
			entity["settlement"] = map[string]any{
				"agreedAmount":   order.Settlement.AgreedAmount,
				"payerConfirmed": order.Settlement.PayerConfirmed,
				"payeeConfirmed": order.Settlement.PayeeConfirmed,
			}
		}
		audit := make([]map[string]any, 0, len(trail))
		for _, row := range trail {
			audit = append(audit, toMap(row))
		}
		return Match{Kind: KindOrder, EntityID: order.ID, State: order.Lifecycle, Entity: entity, Audit: audit}, true, nil
	})
}

func amendmentSummary(amendments []fulfillment.Amendment) map[string]any {
	pending := false
	for _, amendment := range amendments {
		if amendment.Status == fulfillment.AmendmentProposed {
			pending = true
		}
	}
	return map[string]any{"total": len(amendments), "pendingProposal": pending}
}

// ParticipationFinder：活动报名订单编号（For You 确认下单产生的编号）。
func ParticipationFinder(source ActivitySource) Finder {
	return finderFunc(func(ctx context.Context, number string) (Match, bool, error) {
		participation, item, err := source.FindParticipationByNumber(ctx, number)
		switch {
		case errors.Is(err, activity.ErrNotJoined), errors.Is(err, activity.ErrActivityNotFound):
			return Match{}, false, nil
		case errors.Is(err, activity.ErrNumberLookupUnsupported):
			return Match{}, false, ErrUnsupported
		case err != nil:
			return Match{}, false, err
		}
		entity := map[string]any{
			"orderNo":    participation.OrderNo,
			"activityId": participation.ActivityID,
			"userId":     participation.UserID,
			"state":      string(participation.State),
			"activity":   activityEntity(item),
		}
		return Match{Kind: KindActivityParticipation, EntityID: participation.ActivityID + "/" + participation.UserID, State: string(participation.State), Entity: entity}, true, nil
	})
}

// ActivityFinder：活动编号（活动发布成功页展示的号）。
func ActivityFinder(source ActivitySource) Finder {
	return finderFunc(func(ctx context.Context, number string) (Match, bool, error) {
		item, err := source.FindActivityByCode(ctx, number)
		switch {
		case errors.Is(err, activity.ErrActivityNotFound):
			return Match{}, false, nil
		case errors.Is(err, activity.ErrNumberLookupUnsupported):
			return Match{}, false, ErrUnsupported
		case err != nil:
			return Match{}, false, err
		}
		return Match{Kind: KindActivity, EntityID: item.ID, State: item.Status, Entity: activityEntity(item)}, true, nil
	})
}

func activityEntity(item activity.Activity) map[string]any {
	return map[string]any{
		"activityId": item.ID,
		"code":       item.Code,
		"title":      item.Title,
		"origin":     item.Origin,
		"ownerId":    item.OwnerID,
		"status":     item.Status,
		"time":       item.Time,
		"venueName":  item.VenueName,
		"capacity":   item.Capacity,
		"joined":     item.Joined,
	}
}

// OpportunityFinder：需求 / 邀约编号（发布成功页展示的号）。
func OpportunityFinder(source OpportunitySource) Finder {
	return finderFunc(func(ctx context.Context, number string) (Match, bool, error) {
		item, err := source.FindOpportunityByNumber(ctx, number)
		switch {
		case errors.Is(err, marketplace.ErrOpportunityNotFound):
			return Match{}, false, nil
		case errors.Is(err, marketplace.ErrNumberLookupUnsupported):
			return Match{}, false, ErrUnsupported
		case err != nil:
			return Match{}, false, err
		}
		shape := "PUBLIC"
		if item.TargetAccountID != "" {
			shape = "INVITE" // 定向邀约：只对被邀的人和发布者可见
		}
		entity := map[string]any{
			"opportunityId": item.ID,
			"number":        item.Number,
			"shape":         shape,
			"title":         item.Title,
			"ownerId":       item.OwnerID,
			"responses":     item.Responses,
			"date":          item.Date,
			"time":          item.Time,
			"location":      item.Location,
			"price":         item.Price,
			"moneyFlow":     item.MoneyFlow,
		}
		if item.TargetAccountID != "" {
			entity["targetAccountId"] = item.TargetAccountID
		}
		return Match{Kind: KindOpportunity, EntityID: item.ID, State: shape, Entity: entity}, true, nil
	})
}

func iso(at time.Time) string {
	if at.IsZero() {
		return ""
	}
	return at.UTC().Format(time.RFC3339)
}

func toMap(value any) map[string]any {
	raw, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}
