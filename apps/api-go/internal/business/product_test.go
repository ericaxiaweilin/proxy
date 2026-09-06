package business

import (
	"encoding/json"
	"testing"
)

// PRODUCT-001: store menu items are full CRUD under role guard.
// Create/List/Update/Availability-toggle round-trip on the memory
// repository; intruders are rejected; empty listings are [] not null.
func TestStoreProductCrudRoundTrip(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Three Beans"}))
	var accountBody map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &accountBody); err != nil {
		t.Fatalf("decode account payload: %v", err)
	}
	businessID, _ := accountBody["businessId"].(string)
	stored := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "Cau Giay", "address": "Hanoi",
	}))
	var storeBody map[string]any
	if err := json.Unmarshal([]byte(stored.OperationRef), &storeBody); err != nil {
		t.Fatalf("decode store payload: %v", storeBody)
	}
	storeID, _ := storeBody["storeId"].(string)

	intruder := service.Handle(businessEnvelope("intruder", "CreateStoreProduct", "new", map[string]any{
		"storeId": storeID, "name": "Ca Phe Sua", "priceMinor": 29000,
	}))
	if intruder.Outcome != "REJECTED" || intruder.Error == nil || intruder.Error.ErrorCode != "BUSINESS_WRITE_REQUIRED" {
		t.Fatalf("intruder product write was not denied: %+v", intruder)
	}

	badPrice := service.Handle(businessEnvelope("owner", "CreateStoreProduct", "new", map[string]any{
		"storeId": storeID, "name": "Ca Phe Sua", "priceMinor": -1,
	}))
	if badPrice.Outcome != "REJECTED" {
		t.Fatalf("negative price was not rejected: %+v", badPrice)
	}

	made := service.Handle(businessEnvelope("owner", "CreateStoreProduct", "new", map[string]any{
		"storeId": storeID, "name": "Ca Phe Sua", "description": "condensed milk", "priceMinor": 29000,
	}))
	if made.Outcome != "ACCEPTED" || made.OperationRef == "" {
		t.Fatalf("product create failed: %+v", made)
	}
	var madeBody map[string]any
	if err := json.Unmarshal([]byte(made.OperationRef), &madeBody); err != nil {
		t.Fatalf("decode product payload: %v", err)
	}
	productID, _ := madeBody["productId"].(string)
	if productID == "" {
		t.Fatal("product payload missing productId")
	}

	listed := service.Handle(businessEnvelope("owner", "ListStoreProducts", storeID, map[string]any{"storeId": storeID}))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("product list failed: %+v", listed)
	}
	var listBody map[string]any
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatalf("decode list payload: %v", err)
	}
	items, ok := listBody["products"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected 1 product, got: %v", listBody["products"])
	}

	renamed := service.Handle(businessEnvelope("owner", "UpdateStoreProduct", productID, map[string]any{
		"productId": productID, "storeId": storeID, "name": "Ca Phe Sua Da", "priceMinor": 32000,
	}))
	if renamed.Outcome != "ACCEPTED" {
		t.Fatalf("product update failed: %+v", renamed)
	}

	hidden := service.Handle(businessEnvelope("owner", "SetProductAvailability", productID, map[string]any{
		"productId": productID, "storeId": storeID, "available": false,
	}))
	if hidden.Outcome != "ACCEPTED" {
		t.Fatalf("availability toggle failed: %+v", hidden)
	}
	var hiddenBody map[string]any
	if err := json.Unmarshal([]byte(hidden.OperationRef), &hiddenBody); err != nil {
		t.Fatalf("decode toggle payload: %v", err)
	}
	if prod, ok := hiddenBody["product"].(map[string]any); !ok || prod["available"] != false {
		t.Fatalf("toggle did not persist available=false: %v", hiddenBody["product"])
	}
	if prod, ok := hiddenBody["product"].(map[string]any); !ok || prod["name"] != "Ca Phe Sua Da" {
		t.Fatalf("update did not persist rename: %v", hiddenBody["product"])
	}
}

func TestStoreProductListEmptyIsArray(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Empty"}))
	var accountBody map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &accountBody); err != nil {
		t.Fatalf("decode account payload: %v", err)
	}
	businessID, _ := accountBody["businessId"].(string)
	stored := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "S", "address": "",
	}))
	var storeBody map[string]any
	if err := json.Unmarshal([]byte(stored.OperationRef), &storeBody); err != nil {
		t.Fatalf("decode store payload: %v", err)
	}
	storeID, _ := storeBody["storeId"].(string)
	listed := service.Handle(businessEnvelope("owner", "ListStoreProducts", storeID, map[string]any{"storeId": storeID}))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("empty list failed: %+v", listed)
	}
	var listBody map[string]any
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatalf("decode list payload: %v", err)
	}
	// Empty wire collections are [], never null.
	products, ok := listBody["products"].([]any)
	if !ok || products == nil || len(products) != 0 {
		t.Fatalf("empty product list must be [], got: %v", listBody["products"])
	}
}
