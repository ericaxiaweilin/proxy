package business

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// StoreProduct is one priced item on a store's menu / price list
// (R36.x MENU-001). Products hang under a store; writes require a
// BUSINESS_WRITE_REQUIRED role on the owning business. There is no
// hard delete: delisting is SetProductAvailability{available:false},
// so order history never dangles.
type StoreProduct struct {
	ID             string    `json:"id"`
	StoreID        string    `json:"storeId"`
	BusinessID     string    `json:"businessId"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	PriceMinor     int64     `json:"priceMinor"`
	Currency       string    `json:"currency"`
	PhotoAssetPath string    `json:"photoAssetPath"`
	Available      bool      `json:"available"`
	SortOrder      int       `json:"sortOrder"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (s *Service) resolveProductBusiness(ctx context.Context, storeID string) (string, bool) {
	store, err := s.repo.GetStore(ctx, storeID)
	if err != nil || store.ID == "" {
		return "", false
	}
	return store.BusinessID, true
}

func (s *Service) createProduct(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID        string `json:"storeId"`
		Name           string `json:"name"`
		Description    string `json:"description"`
		PriceMinor     int64  `json:"priceMinor"`
		PhotoAssetPath string `json:"photoAssetPath"`
		SortOrder      int    `json:"sortOrder"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" || strings.TrimSpace(p.Name) == "" || p.PriceMinor < 0 {
		return command.Rejected(e, "INVALID_PRODUCT", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_product", nil)
	}
	businessID, ok := s.resolveProductBusiness(ctx, p.StoreID)
	if !ok {
		return command.Rejected(e, "STORE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	now := s.clock.Now().UTC()
	product := StoreProduct{
		ID:             newID("prod_"),
		StoreID:        p.StoreID,
		BusinessID:     businessID,
		Name:           strings.TrimSpace(p.Name),
		Description:    p.Description,
		PriceMinor:     p.PriceMinor,
		Currency:       "VND",
		PhotoAssetPath: p.PhotoAssetPath,
		Available:      true,
		SortOrder:      p.SortOrder,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.repo.CreateProduct(ctx, product); err != nil {
		return command.Rejected(e, "PRODUCT_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.product_create_failed", nil)
	}
	ev := event.New("StoreProductCreated", "StoreProduct", product.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "StoreProduct", product.ID, 1, "ACTIVE", map[string]any{"productId": product.ID, "product": product}, []event.DomainEvent{ev})
}

func (s *Service) updateProduct(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		ProductID      string `json:"productId"`
		StoreID        string `json:"storeId"`
		Name           string `json:"name"`
		Description    string `json:"description"`
		PriceMinor     int64  `json:"priceMinor"`
		PhotoAssetPath string `json:"photoAssetPath"`
		SortOrder      int    `json:"sortOrder"`
	}
	if !decode(e.Payload, &p) || p.ProductID == "" || p.StoreID == "" || strings.TrimSpace(p.Name) == "" || p.PriceMinor < 0 {
		return command.Rejected(e, "INVALID_PRODUCT", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_product", nil)
	}
	businessID, ok := s.resolveProductBusiness(ctx, p.StoreID)
	if !ok {
		return command.Rejected(e, "STORE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	existing, err := s.repo.GetProduct(ctx, p.ProductID)
	if err != nil || existing.StoreID != p.StoreID {
		return command.Rejected(e, "PRODUCT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.product_not_found", nil)
	}
	now := s.clock.Now().UTC()
	updated := StoreProduct{
		ID:             existing.ID,
		StoreID:        p.StoreID,
		BusinessID:     businessID,
		Name:           strings.TrimSpace(p.Name),
		Description:    p.Description,
		PriceMinor:     p.PriceMinor,
		Currency:       "VND",
		PhotoAssetPath: p.PhotoAssetPath,
		Available:      existing.Available,
		SortOrder:      p.SortOrder,
		CreatedAt:      existing.CreatedAt,
		UpdatedAt:      now,
	}
	if err := s.repo.UpdateProduct(ctx, updated); err != nil {
		return command.Rejected(e, "PRODUCT_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.product_update_failed", nil)
	}
	ev := event.New("StoreProductUpdated", "StoreProduct", updated.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "StoreProduct", updated.ID, 1, "ACTIVE", map[string]any{"productId": updated.ID, "product": updated}, []event.DomainEvent{ev})
}

func (s *Service) listProducts(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID string `json:"storeId"`
	}
	if !decode(e.Payload, &p) || p.StoreID == "" {
		p.StoreID = e.Target.ID
		if p.StoreID == "" {
			return command.Rejected(e, "INVALID_LIST", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_list", nil)
		}
	}
	businessID, ok := s.resolveProductBusiness(ctx, p.StoreID)
	if !ok {
		return command.Rejected(e, "STORE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR", "VIEWER") {
		return command.Rejected(e, "BUSINESS_MEMBER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.member_required", nil)
	}
	products, err := s.repo.ListProducts(ctx, p.StoreID)
	if err != nil {
		return command.Rejected(e, "PRODUCT_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "business.product_list_failed", nil)
	}
	if products == nil {
		products = []StoreProduct{}
	}
	return acceptedWithPayload(e, "StoreProductList", p.StoreID, 1, "LISTED", map[string]any{"products": products}, nil)
}

func (s *Service) setProductAvailability(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		ProductID string `json:"productId"`
		StoreID   string `json:"storeId"`
		Available bool   `json:"available"`
	}
	if !decode(e.Payload, &p) || p.ProductID == "" || p.StoreID == "" {
		return command.Rejected(e, "INVALID_PRODUCT", "VALIDATION", "AFTER_USER_ACTION", "business.invalid_product", nil)
	}
	businessID, ok := s.resolveProductBusiness(ctx, p.StoreID)
	if !ok {
		return command.Rejected(e, "STORE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.store_not_found", nil)
	}
	if !s.hasRole(ctx, businessID, e.Actor.ID, "OWNER", "ADMIN", "OPERATOR") {
		return command.Rejected(e, "BUSINESS_WRITE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "business.write_required", nil)
	}
	existing, err := s.repo.GetProduct(ctx, p.ProductID)
	if err != nil || existing.StoreID != p.StoreID {
		return command.Rejected(e, "PRODUCT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "business.product_not_found", nil)
	}
	now := s.clock.Now().UTC()
	updated := existing
	updated.Available = p.Available
	updated.UpdatedAt = now
	if err := s.repo.UpdateProduct(ctx, updated); err != nil {
		return command.Rejected(e, "PRODUCT_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "business.product_update_failed", nil)
	}
	ev := event.New("StoreProductAvailabilityChanged", "StoreProduct", updated.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "StoreProduct", updated.ID, 1, "ACTIVE", map[string]any{"productId": updated.ID, "product": updated}, []event.DomainEvent{ev})
}

// Memory product storage. The products map is keyed by product ID;
// listings filter by store and sort by (sortOrder, createdAt) so the
// wire order is deterministic without a database.
func (r *MemoryRepository) CreateProduct(_ context.Context, p StoreProduct) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.products == nil {
		r.products = make(map[string]StoreProduct)
	}
	r.products[p.ID] = p
	return nil
}

func (r *MemoryRepository) GetProduct(_ context.Context, productID string) (StoreProduct, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.products[productID]
	if !ok {
		return StoreProduct{}, errors.New("product not found")
	}
	return p, nil
}

func (r *MemoryRepository) UpdateProduct(_ context.Context, p StoreProduct) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.products == nil {
		r.products = make(map[string]StoreProduct)
	}
	if _, ok := r.products[p.ID]; !ok {
		return errors.New("product not found")
	}
	r.products[p.ID] = p
	return nil
}

func (r *MemoryRepository) ListProducts(_ context.Context, storeID string) ([]StoreProduct, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []StoreProduct{}
	for _, p := range r.products {
		if p.StoreID == storeID {
			result = append(result, p)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].SortOrder != result[j].SortOrder {
			return result[i].SortOrder < result[j].SortOrder
		}
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})
	return result, nil
}
