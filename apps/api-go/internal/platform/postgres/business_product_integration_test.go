package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/business"
)

// PRODUCT-001 PG half: store menu items persist in PostgreSQL.
// Create/List/Update/Availability round-trip through the real
// BusinessRepository; all rows are run-scoped and cleaned up.
func TestStoreProductPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewBusinessRepository(pool)
	svc := business.NewWithRepository(repo)

	run := time.Now().UnixNano()
	owner := "user_biz_pg_prod_owner_" + itoa(run)
	seedBusinessUsersPG(t, pool, []string{owner})
	t.Cleanup(func() { cleanupBusinessUsersPG(t, pool, []string{owner}) })

	account := svc.HandleContext(ctx, bizEnvelope("CreateBusinessAccount", map[string]any{
		"name": "Menu House",
	}, owner))
	if account.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessAccount: %+v", account.Error)
	}
	var accountBody map[string]any
	if err := json.Unmarshal([]byte(account.OperationRef), &accountBody); err != nil {
		t.Fatalf("decode account: %v", err)
	}
	businessID, _ := accountBody["businessId"].(string)

	stored := svc.HandleContext(ctx, bizEnvelope("CreateBusinessStore", map[string]any{
		"businessId": businessID, "name": "Main", "address": "",
	}, owner))
	var storeBody map[string]any
	if err := json.Unmarshal([]byte(stored.OperationRef), &storeBody); err != nil {
		t.Fatalf("decode store: %v", err)
	}
	storeID, _ := storeBody["storeId"].(string)

	made := svc.HandleContext(ctx, bizEnvelope("CreateStoreProduct", map[string]any{
		"storeId": storeID, "name": "Pho Bo", "priceMinor": 65000,
	}, owner))
	if made.Outcome != "ACCEPTED" {
		t.Fatalf("CreateStoreProduct: %+v", made.Error)
	}
	var madeBody map[string]any
	if err := json.Unmarshal([]byte(made.OperationRef), &madeBody); err != nil {
		t.Fatalf("decode product: %v", err)
	}
	productID, _ := madeBody["productId"].(string)
	if productID == "" {
		t.Fatal("missing productId")
	}

	listed := svc.HandleContext(ctx, bizEnvelope("ListStoreProducts", map[string]any{
		"storeId": storeID,
	}, owner))
	var listBody map[string]any
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	items, ok := listBody["products"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected 1 persisted product, got: %v", listBody["products"])
	}

	toggled := svc.HandleContext(ctx, bizEnvelope("SetProductAvailability", map[string]any{
		"productId": productID, "storeId": storeID, "available": false,
	}, owner))
	if toggled.Outcome != "ACCEPTED" {
		t.Fatalf("SetProductAvailability: %+v", toggled.Error)
	}
	got, err := repo.GetProduct(ctx, productID)
	if err != nil || got.Available || got.PriceMinor != 65000 || got.Name != "Pho Bo" {
		t.Fatalf("persisted product mismatch: %+v err=%v", got, err)
	}
}
