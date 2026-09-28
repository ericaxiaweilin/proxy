package business

import (
	"context"
	"encoding/json"
	"testing"
)

// ORDER-STORE-STATS-AUTHZ-001：店铺经营统计（含顾客 id）只给该店商户的有效成员看。
func TestStoreMemberAccess(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)
	store := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{"businessId": businessID, "name": "West Lake", "address": "Tay Ho"}))
	var storeBody map[string]any
	_ = json.Unmarshal([]byte(store.OperationRef), &storeBody)
	storeID := storeBody["storeId"].(string)

	ctx := context.Background()
	for userID, want := range map[string]bool{"owner": true, "stranger": false, "": false} {
		got, err := service.StoreMemberAccess(ctx, storeID, userID)
		if err != nil || got != want {
			t.Fatalf("StoreMemberAccess(%q) = %v, %v; want %v", userID, got, err, want)
		}
	}
	if got, err := service.StoreMemberAccess(ctx, "store_missing", "owner"); err != nil || got {
		t.Fatalf("unknown store must be (false, nil), got %v %v", got, err)
	}
}
