package business

import (
	"encoding/json"
	"testing"
)

// MENU-HOT-001（2026-10-02，用户给原型「给商家菜单 某些打hot标」）：
//
// HOT 是商家亲手标的，不是从销量算的 —— 订单只记到店不记单品，
// 全仓没有"某道菜卖多少"的数据。用店级销量给单品颁 HOT 等于编造归因。
// 默认 false；开/关都走显式命令（SetProductHot 只改标记，不碰其它字段）。
func TestSetProductHotToggle(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Hot Shop"}))
	var accountBody map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &accountBody); err != nil {
		t.Fatalf("decode account payload: %v", err)
	}
	businessID, _ := accountBody["businessId"].(string)
	stored := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "S", "address": "Hanoi",
	}))
	var storeBody map[string]any
	if err := json.Unmarshal([]byte(stored.OperationRef), &storeBody); err != nil {
		t.Fatalf("decode store payload: %v", err)
	}
	storeID, _ := storeBody["storeId"].(string)

	made := service.Handle(businessEnvelope("owner", "CreateStoreProduct", "new", map[string]any{
		"storeId": storeID, "name": "Ca Phe", "priceMinor": 29000,
	}))
	if made.Outcome != "ACCEPTED" {
		t.Fatalf("create: %+v", made.Error)
	}
	var madeBody map[string]any
	if err := json.Unmarshal([]byte(made.OperationRef), &madeBody); err != nil {
		t.Fatal(err)
	}
	productID, _ := madeBody["productId"].(string)

	// 默认不是 HOT。
	listed := service.Handle(businessEnvelope("owner", "ListStoreProducts", "new", map[string]any{"storeId": storeID}))
	var listBody map[string]any
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatal(err)
	}
	items, _ := listBody["products"].([]any)
	if len(items) != 1 {
		t.Fatalf("want 1 product, got %d", len(items))
	}
	if hot, _ := items[0].(map[string]any)["isHot"].(bool); hot {
		t.Fatal("new product must not be HOT by default")
	}

	// 打标。
	marked := service.Handle(businessEnvelope("owner", "SetProductHot", "new", map[string]any{
		"storeId": storeID, "productId": productID, "isHot": true,
	}))
	if marked.Outcome != "ACCEPTED" {
		t.Fatalf("mark hot: %+v", marked.Error)
	}

	// 摘标，只改标记。
	unmarked := service.Handle(businessEnvelope("owner", "SetProductHot", "new", map[string]any{
		"storeId": storeID, "productId": productID, "isHot": false,
	}))
	if unmarked.Outcome != "ACCEPTED" {
		t.Fatalf("unmark hot: %+v", unmarked.Error)
	}

	// 外人打不了。
	intruder := service.Handle(businessEnvelope("intruder", "SetProductHot", "new", map[string]any{
		"storeId": storeID, "productId": productID, "isHot": true,
	}))
	if intruder.Outcome != "REJECTED" {
		t.Fatalf("intruder hot toggle was not denied: %+v", intruder)
	}
}
