package voucher

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Voucher Purchase + Instance — 平台采购与可追溯券实例（VOUCHER-PURCHASE-001，
// benefit 正本第 2 步）。
//
// 采购是平台侧动作（operator 门在 api 层，见 operatorCommandTypes），
// 服务侧只做：定义必须存在且未退役、金额服务端算（客户端传的 total 一律
// 无视）、确认即原子铸券（状态翻转与实例落库同一事务，CAS 守 ORDERED）。
// 追溯链 instance → purchase → (merchant, contract, invoice, MST) 见 109 迁移。
const maxPurchaseQuantity = 10000

type Purchase struct {
	ID              string `json:"purchaseId"`
	DefinitionID    string `json:"definitionId"`
	MerchantID      string `json:"merchantId"`
	Quantity        int    `json:"quantity"`
	UnitCostMinor   int    `json:"unitCostMinor"`
	TotalMinor      int    `json:"totalMinor"`
	Currency        string `json:"currency"`
	ContractRef     string `json:"contractRef,omitempty"`
	InvoiceRef      string `json:"invoiceRef,omitempty"`
	TaxCodeSnapshot string `json:"taxCodeSnapshot,omitempty"`
	Status          string `json:"status"`
	OrderedBy       string `json:"orderedBy"`
	OrderedAt       string `json:"orderedAt"`
	ConfirmedAt     string `json:"confirmedAt,omitempty"`
	Version         int    `json:"version"`
}

type Instance struct {
	ID          string `json:"instanceId"`
	PurchaseID  string `json:"purchaseId"`
	DefinitionID string `json:"definitionId"`
	MerchantID  string `json:"merchantId"`
	Code        string `json:"code"`
	Status      string `json:"status"`
}

// ErrPurchaseNotOrderable reports a confirm CAS miss: the purchase is not
// ORDERED (already CONFIRMED, CANCELLED, or a DRAFT row somebody seeded
// by hand). The service maps it to PURCHASE_NOT_ORDERABLE.
var ErrPurchaseNotOrderable = errors.New("purchase is not orderable")

type orderPurchasePayload struct {
	DefinitionID          string `json:"definitionId"`
	Quantity              int    `json:"quantity"`
	UnitCostMinor         int    `json:"unitCostMinor"`
	ContractRef           string `json:"contractRef"`
	InvoiceRef            string `json:"invoiceRef"`
	TaxCodeSnapshot       string `json:"taxCodeSnapshot"`
	TotalMinor            int    `json:"totalMinor"` // 客户端自带 total 直接无视，服务端重算
}

type confirmPurchasePayload struct {
	PurchaseID string `json:"purchaseId"`
}

func (s *Service) definitionWithContext(ctx context.Context, id string) (*Definition, bool, error) {
	if d, ok := s.definitions[id]; ok {
		return d, true, nil
	}
	if s.repo == nil {
		return nil, false, nil
	}
	d, ok, err := s.repo.GetDefinition(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if ok {
		if s.definitions == nil {
			s.definitions = make(map[string]*Definition)
		}
		s.definitions[id] = d
	}
	return d, ok, nil
}

func (s *Service) orderPurchase(ctx context.Context, e command.Envelope) command.Result {
	var p orderPurchasePayload
	if !decode(e.Payload, &p) || p.DefinitionID == "" {
		return reject(e, "INVALID_PURCHASE", "voucher.invalid_purchase")
	}
	def, ok, err := s.definitionWithContext(ctx, p.DefinitionID)
	if err != nil {
		log.Printf("voucher storage: get definition %s: %v", p.DefinitionID, err)
		return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
	}
	if !ok {
		return reject(e, "DEFINITION_NOT_FOUND", "voucher.definition_not_found")
	}
	if def.Status == "RETIRED" {
		return reject(e, "DEFINITION_RETIRED", "voucher.definition_retired")
	}
	if p.Quantity < 1 || p.Quantity > maxPurchaseQuantity || p.UnitCostMinor < 0 {
		return reject(e, "INVALID_PURCHASE", "voucher.invalid_purchase")
	}
	// total 永远服务端算：客户端传的 TotalMinor 只进日志，不进库。
	// 109 迁移的 CHECK(total = quantity * unit_cost) 是第二道锁。
	total := p.Quantity * p.UnitCostMinor
	now := s.clock()
	s.sequence++
	purchase := &Purchase{
		ID:              fmt.Sprintf("vp_%d_%d", now.Unix(), s.sequence),
		DefinitionID:    def.ID,
		MerchantID:      def.MerchantID,
		Quantity:        p.Quantity,
		UnitCostMinor:   p.UnitCostMinor,
		TotalMinor:      total,
		Currency:        "VND",
		ContractRef:     strings.TrimSpace(p.ContractRef),
		InvoiceRef:      strings.TrimSpace(p.InvoiceRef),
		TaxCodeSnapshot: strings.TrimSpace(p.TaxCodeSnapshot),
		Status:          "ORDERED",
		OrderedBy:       e.Actor.ID,
		OrderedAt:       now.Format(time.RFC3339),
		Version:         1,
	}
	if s.repo != nil {
		if err := s.repo.CreatePurchase(ctx, *purchase); err != nil {
			log.Printf("voucher storage: create purchase %s: %v", purchase.ID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	}
	if s.purchases == nil {
		s.purchases = make(map[string]*Purchase)
	}
	s.purchases[purchase.ID] = purchase
	return accepted(e, "VoucherPurchase", purchase.ID, purchase.Status, map[string]any{"purchase": *purchase})
}

func (s *Service) purchaseWithContext(ctx context.Context, id string) (*Purchase, bool, error) {
	if p, ok := s.purchases[id]; ok {
		return p, true, nil
	}
	if s.repo == nil {
		return nil, false, nil
	}
	p, ok, err := s.repo.GetPurchase(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if ok {
		if s.purchases == nil {
			s.purchases = make(map[string]*Purchase)
		}
		s.purchases[id] = p
	}
	return p, ok, nil
}

func (s *Service) confirmPurchase(ctx context.Context, e command.Envelope) command.Result {
	var p confirmPurchasePayload
	if !decode(e.Payload, &p) || p.PurchaseID == "" {
		return reject(e, "INVALID_PURCHASE_REF", "voucher.invalid_purchase_ref")
	}
	purchase, ok, err := s.purchaseWithContext(ctx, p.PurchaseID)
	if err != nil {
		log.Printf("voucher storage: get purchase %s: %v", p.PurchaseID, err)
		return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
	}
	if !ok {
		return reject(e, "PURCHASE_NOT_FOUND", "voucher.purchase_not_found")
	}
	if purchase.Status != "ORDERED" {
		return reject(e, "PURCHASE_NOT_ORDERABLE", "voucher.purchase_not_orderable")
	}
	now := s.clock()
	instances := make([]Instance, 0, purchase.Quantity)
	for i := 0; i < purchase.Quantity; i++ {
		s.sequence++
		instances = append(instances, Instance{
			ID:           fmt.Sprintf("vi_%d_%d", now.Unix(), s.sequence),
			PurchaseID:   purchase.ID,
			DefinitionID: purchase.DefinitionID,
			MerchantID:   purchase.MerchantID,
			Code:         fmt.Sprintf("VC%08d", s.sequence),
			Status:       "MINTED",
		})
	}
	if s.repo != nil {
		if err := s.repo.ConfirmPurchaseWithMint(ctx, purchase.ID, instances); err != nil {
			if errors.Is(err, ErrPurchaseNotOrderable) {
				return reject(e, "PURCHASE_NOT_ORDERABLE", "voucher.purchase_not_orderable")
			}
			log.Printf("voucher storage: confirm purchase %s: %v", purchase.ID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	}
	purchase.Status, purchase.Version = "CONFIRMED", purchase.Version+1
	confirmedAt := now.Format(time.RFC3339)
	purchase.ConfirmedAt = confirmedAt
	if s.instances == nil {
		s.instances = make(map[string]*Instance)
	}
	for i := range instances {
		cp := instances[i]
		s.instances[cp.ID] = &cp
	}
	return accepted(e, "VoucherPurchase", purchase.ID, purchase.Status, map[string]any{
		"purchase":   *purchase,
		"minted":     len(instances),
		"confirmedAt": confirmedAt,
	})
}
