package demand

import "github.com/proxy-app/proxy-api/internal/command"

// CatalogAdmissionGate — 真实准入闸：校验 catalogVersion / policySnapshot 完整性
// 替代 nil→PENDING 的 fail-closed stub，使 closed-beta 能在正确 payload 下直接 ACCEPT
func CatalogAdmissionGate(draft *TaskDraft, _ command.Envelope) GateDecision {
	if draft == nil {
		return GateDecision{Status: "REJECT", ErrorCode: "ADMISSION_INVALID_DRAFT", MessageKey: "demand.admission_invalid_draft"}
	}
	cv, _ := draft.Changes["catalogVersion"].(string)
	if cv == "" {
		return GateDecision{Status: "REJECT", ErrorCode: "ADMISSION_CATALOG_MISSING", MessageKey: "demand.admission_catalog_missing"}
	}
	// 仅允许已发布 catalog 版本（测试与 Prod 共用）
	allowed := map[string]bool{"CATALOG_V1": true, "CATALOG_V5": true, "v1": true}
	if !allowed[cv] {
		return GateDecision{Status: "REJECT", ErrorCode: "ADMISSION_CATALOG_UNKNOWN", MessageKey: "demand.admission_catalog_unknown"}
	}
	ps, _ := draft.Changes["policySnapshot"].(map[string]any)
	if ps == nil || len(ps) == 0 {
		return GateDecision{Status: "REJECT", ErrorCode: "ADMISSION_POLICY_MISSING", MessageKey: "demand.admission_policy_missing"}
	}
	return GateDecision{Status: "ALLOW"}
}

// FundingGate — 真实资金闸：校验 budget 金额/币种
func FundingGate(draft *TaskDraft, _ command.Envelope) GateDecision {
	if draft == nil {
		return GateDecision{Status: "REJECT", ErrorCode: "FUNDING_INVALID_DRAFT", MessageKey: "demand.funding_invalid_draft"}
	}
	budget, _ := draft.Changes["budget"].(map[string]any)
	if budget == nil {
		return GateDecision{Status: "REJECT", ErrorCode: "FUNDING_BUDGET_MISSING", MessageKey: "demand.funding_budget_missing"}
	}
	// amountMinor 或 amount 均可，>0 即可
	var amount float64
	if v, ok := budget["amountMinor"]; ok {
		if n, ok := v.(float64); ok { amount = n }
	}
	if amount == 0 {
		if v, ok := budget["amount"]; ok {
			if n, ok := v.(float64); ok { amount = n }
		}
	}
	if amount <= 0 {
		return GateDecision{Status: "REJECT", ErrorCode: "FUNDING_AMOUNT_INVALID", MessageKey: "demand.funding_amount_invalid"}
	}
	currency, _ := budget["currency"].(string)
	if currency != "VND" && currency != "USD" {
		return GateDecision{Status: "REJECT", ErrorCode: "FUNDING_CURRENCY_INVALID", MessageKey: "demand.funding_currency_invalid"}
	}
	return GateDecision{Status: "ALLOW"}
}
