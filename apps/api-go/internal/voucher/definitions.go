package voucher

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Voucher Definition — 商户券发行定义（VOUCHER-ISSUE-001，benefit 正本第 1 步）。
//
// merchant_id 只由服务端标注写入（见 merchantStamp），绝不从 payload 取：
// IssueVoucherDefinition 进了 merchantPublishCommands，api 层的
// resolveMerchantPublish 已用服务端会话身份验过该用户是该商户的
// OWNER/ADMIN（MerchantPublishIdentity），伪造的 payload.merchantId 到不了
// 这里（MERCHANT_FORBIDDEN），没带 merchantId 则根本没有标注。
// 后续第 2 步（采购 purchase / 实例 instance）从 definition 追溯来源。
type Definition struct {
	ID                   string `json:"definitionId"`
	MerchantID           string `json:"merchantId"`
	MerchantName         string `json:"merchantName"`
	StoreID              string `json:"storeId,omitempty"`
	Family               Family `json:"family"`
	FaceValueMinor       int    `json:"faceValueMinor"`
	Currency             string `json:"currency"`
	ScopeName            string `json:"scopeName"`
	ValidFrom            string `json:"validFrom"`
	ValidUntil           string `json:"validUntil"`
	PerPersonLimit       int    `json:"perPersonLimit"`
	MerchantUnitCostMinor int   `json:"merchantUnitCostMinor"`
	Status               string `json:"status"`
	Version              int    `json:"version"`
}

type issueDefinitionPayload struct {
	Family                Family `json:"family"`
	FaceValueMinor        int    `json:"faceValueMinor"`
	ScopeName             string `json:"scopeName"`
	ValidFrom             string `json:"validFrom"`
	ValidUntil            string `json:"validUntil"`
	PerPersonLimit        int    `json:"perPersonLimit"`
	MerchantUnitCostMinor int    `json:"merchantUnitCostMinor"`
	StoreID               string `json:"storeId"`
}

// merchantStamp reads the verified merchant annotation stamped by the api
// layer (resolveMerchantPublish). Canonical keys live in
// apps/api-go/internal/api/merchant_identity.go — this is a read-only
// mirror (api cannot be imported here: import cycle). Never read
// payload.merchantId here: it is client-controlled.
func merchantStamp(e command.Envelope) (string, string, bool) {
	if e.AuthContext == nil {
		return "", "", false
	}
	id, _ := e.AuthContext["merchantID"].(string)
	name, _ := e.AuthContext["merchantName"].(string)
	if id == "" || name == "" {
		return "", "", false
	}
	return id, name, true
}

func (s *Service) issueDefinition(ctx context.Context, e command.Envelope) command.Result {
	merchantID, merchantName, ok := merchantStamp(e)
	if !ok {
		// 无标注 = 没带 merchantId（resolveMerchantPublish 走了 PERSON 路径）
		// 或绕过 api 层直调 service。发行定义没有商户就没有意义，fail-closed。
		return reject(e, "VOUCHER_MERCHANT_REQUIRED", "voucher.merchant_required")
	}
	var p issueDefinitionPayload
	if !decode(e.Payload, &p) {
		return reject(e, "INVALID_DEFINITION", "voucher.invalid_definition")
	}
	p.ScopeName = strings.TrimSpace(p.ScopeName)
	if p.Family != Coffee && p.Family != Experience && p.Family != Activity {
		return reject(e, "INVALID_DEFINITION", "voucher.invalid_definition")
	}
	if p.FaceValueMinor <= 0 || p.ScopeName == "" {
		return reject(e, "INVALID_DEFINITION", "voucher.invalid_definition")
	}
	if p.PerPersonLimit < 1 || p.MerchantUnitCostMinor < 0 {
		return reject(e, "INVALID_DEFINITION", "voucher.invalid_definition")
	}
	if len(p.ValidFrom) != 10 || len(p.ValidUntil) != 10 || p.ValidUntil < p.ValidFrom {
		return reject(e, "INVALID_DEFINITION", "voucher.invalid_definition")
	}
	s.sequence++
	def := &Definition{
		ID:                    fmt.Sprintf("vd_%d_%d", s.clock().Unix(), s.sequence),
		MerchantID:            merchantID,
		MerchantName:          merchantName,
		StoreID:               strings.TrimSpace(p.StoreID),
		Family:                p.Family,
		FaceValueMinor:        p.FaceValueMinor,
		Currency:              "VND",
		ScopeName:             p.ScopeName,
		ValidFrom:             p.ValidFrom,
		ValidUntil:            p.ValidUntil,
		PerPersonLimit:        p.PerPersonLimit,
		MerchantUnitCostMinor: p.MerchantUnitCostMinor,
		Status:                "DRAFT",
		Version:               1,
	}
	if s.repo != nil {
		if err := s.repo.CreateDefinition(ctx, *def); err != nil {
			log.Printf("voucher storage: create definition %s: %v", def.ID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	}
	if s.definitions == nil {
		s.definitions = make(map[string]*Definition)
	}
	s.definitions[def.ID] = def
	return accepted(e, "VoucherDefinition", def.ID, def.Status, map[string]any{"definition": *def})
}
