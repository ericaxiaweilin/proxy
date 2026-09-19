package business

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func businessEnvelope(actorID, commandType, targetID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_" + commandType + "_" + actorID,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "PERSON", ID: "principal_" + actorID},
		Target:         command.Target{Type: "BusinessAccount", ID: targetID},
		IdempotencyKey: "idem_" + commandType + "_" + actorID,
		AuthContext:    map[string]any{"sessionId": "session_" + actorID},
		Purpose:        "business_test",
		CorrelationID:  "corr_" + commandType,
		RequestedAt:    "2026-08-25T00:00:00Z",
		Payload:        payload,
	}
}

func TestBusinessOwnershipAndMemberAuthorization(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	if created.Outcome != "ACCEPTED" || created.OperationRef == "" {
		t.Fatalf("create failed: %+v", created)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil {
		t.Fatalf("decode create payload: %v", err)
	}
	businessID, _ := body["businessId"].(string)
	if businessID == "" {
		t.Fatal("create payload missing businessId")
	}

	denied := service.Handle(businessEnvelope("intruder", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "Fake Store", "address": "Hanoi",
	}))
	if denied.Outcome != "REJECTED" || denied.Error == nil || denied.Error.ErrorCode != "BUSINESS_WRITE_REQUIRED" {
		t.Fatalf("intruder store write was not denied: %+v", denied)
	}

	added := service.Handle(businessEnvelope("owner", "AddBusinessMember", businessID, map[string]any{
		"businessId": businessID, "userId": "operator", "role": "OPERATOR",
	}))
	if added.Outcome != "ACCEPTED" {
		t.Fatalf("owner add member failed: %+v", added)
	}
	store := service.Handle(businessEnvelope("operator", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "West Lake", "address": "Tay Ho",
	}))
	if store.Outcome != "ACCEPTED" || store.OperationRef == "" {
		t.Fatalf("operator store create failed: %+v", store)
	}
	financeDenied := service.Handle(businessEnvelope("operator", "SpendSummary", businessID, map[string]any{"businessId": businessID}))
	if financeDenied.Outcome != "REJECTED" || financeDenied.Error == nil || financeDenied.Error.ErrorCode != "BUSINESS_FINANCE_REQUIRED" {
		t.Fatalf("operator finance read was not denied: %+v", financeDenied)
	}
}

func TestListMyBusinessAccountsIsActorScoped(t *testing.T) {
	service := New()
	service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Owner Store"}))
	ownerList := service.Handle(businessEnvelope("owner", "ListMyBusinessAccounts", "mine", map[string]any{}))
	intruderList := service.Handle(businessEnvelope("intruder", "ListMyBusinessAccounts", "mine", map[string]any{}))
	if ownerList.Outcome != "ACCEPTED" || intruderList.Outcome != "ACCEPTED" {
		t.Fatalf("list failed: owner=%+v intruder=%+v", ownerList, intruderList)
	}
	if ownerList.OperationRef == intruderList.OperationRef {
		t.Fatalf("actor-scoped account lists unexpectedly match: %s", ownerList.OperationRef)
	}
}

// R18.x: STORE-PHOTO-001 tripwire
// Merchant 'album' was hardcoded '48 张' in merchant-me-r21.tsx; closes
// the gap by giving every store a real photo list backed by the
// repository, with uploader-only delete and asset_path prefix guard.
func TestStoreAlbumRoundTrip(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("create failed: %+v", created)
	}
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)
	store := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "West Lake", "address": "Tay Ho",
	}))
	if store.Outcome != "ACCEPTED" {
		t.Fatalf("store create failed: %+v", store)
	}
	var storeBody map[string]any
	_ = json.Unmarshal([]byte(store.OperationRef), &storeBody)
	storeID := storeBody["storeId"].(string)

	rejected := service.Handle(businessEnvelope("owner", "AddStorePhoto", storeID, map[string]any{
		"storeId": storeID, "assetPath": "https://attacker.example.com/x.jpg", "caption": "evil",
	}))
	if rejected.Outcome != "REJECTED" || rejected.Error == nil || rejected.Error.ErrorCode != "INVALID_ASSET_PATH" {
		t.Fatalf("external URL was not rejected: %+v", rejected)
	}

	added := service.Handle(businessEnvelope("owner", "AddStorePhoto", storeID, map[string]any{
		"storeId": storeID, "assetPath": "store/westlake-1.jpg", "caption": "front", "sortOrder": 1,
	}))
	if added.Outcome != "ACCEPTED" {
		t.Fatalf("photo add failed: %+v", added)
	}
	var photoBody map[string]any
	_ = json.Unmarshal([]byte(added.OperationRef), &photoBody)
	photoID := photoBody["photo"].(map[string]any)["id"].(string)

	listed := service.Handle(businessEnvelope("owner", "ListStorePhotos", storeID, map[string]any{"storeId": storeID}))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("photo list failed: %+v", listed)
	}
	var listBody map[string]any
	_ = json.Unmarshal([]byte(listed.OperationRef), &listBody)
	count := int(listBody["count"].(float64))
	if count != 1 {
		t.Fatalf("expected 1 photo, got %d", count)
	}

	intruderDelete := service.Handle(businessEnvelope("intruder", "DeleteStorePhoto", storeID, map[string]any{
		"storeId": storeID, "photoId": photoID,
	}))
	if intruderDelete.Outcome != "REJECTED" || intruderDelete.Error == nil {
		t.Fatalf("non-member delete was not rejected: %+v", intruderDelete)
	}
	if intruderDelete.Error.ErrorCode != "BUSINESS_WRITE_REQUIRED" && intruderDelete.Error.ErrorCode != "BUSINESS_MEMBER_REQUIRED" && intruderDelete.Error.ErrorCode != "STORE_PHOTO_DELETE_DENIED" {
		t.Fatalf("non-member delete code mismatch: got %s want BUSINESS_WRITE_REQUIRED or related", intruderDelete.Error.ErrorCode)
	}
	ownerDelete := service.Handle(businessEnvelope("owner", "DeleteStorePhoto", storeID, map[string]any{
		"storeId": storeID, "photoId": photoID,
	}))
	if ownerDelete.Outcome != "ACCEPTED" {
		t.Fatalf("owner delete failed: %+v", ownerDelete)
	}
	listed2 := service.Handle(businessEnvelope("owner", "ListStorePhotos", storeID, map[string]any{"storeId": storeID}))
	_ = json.Unmarshal([]byte(listed2.OperationRef), &listBody)
	if int(listBody["count"].(float64)) != 0 {
		t.Fatalf("expected 0 photos after delete, got %v", listBody["count"])
	}
}

// R18.x: STORE-LINES-001 tripwire
// '店铺信息' tile in me.tsx > merchantstorefront was a non-clickable View.
// The real flow is: owner uploads LogoAssetPath + description + hours
// via UpsertStoreLines; everyone in the business reads via GetStoreLines.
func TestStoreLinesUpsertAndRead(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)
	store := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "West Lake", "address": "Tay Ho",
	}))
	var storeBody map[string]any
	_ = json.Unmarshal([]byte(store.OperationRef), &storeBody)
	storeID := storeBody["storeId"].(string)

	upsert := service.Handle(businessEnvelope("owner", "UpsertStoreLines", storeID, map[string]any{
		"storeId":       storeID,
		"logoAssetPath": "assets/bonsaidon-logo.png",
		"description":   "海鲜自助 · 河内",
		"hoursJson":     "{\"mon\":\"10-22\"}",
		"contactPhone":  "+84 24 0000 1111",
		"contactEmail":  "hi@bonsaidon.vn",
	}))
	if upsert.Outcome != "ACCEPTED" {
		t.Fatalf("lines upsert failed: %+v", upsert)
	}
	read := service.Handle(businessEnvelope("owner", "GetStoreLines", storeID, map[string]any{"storeId": storeID}))
	if read.Outcome != "ACCEPTED" {
		t.Fatalf("lines read failed: %+v", read)
	}
	var readBody map[string]any
	_ = json.Unmarshal([]byte(read.OperationRef), &readBody)
	lines := readBody["lines"].(map[string]any)
	if lines["logoAssetPath"] != "assets/bonsaidon-logo.png" {
		t.Fatalf("lines.logoAssetPath mismatch: %v", lines["logoAssetPath"])
	}

	badLogo := service.Handle(businessEnvelope("owner", "UpsertStoreLines", storeID, map[string]any{
		"storeId":       storeID,
		"logoAssetPath": "https://evil.example.com/logo.png",
		"description":   "x",
	}))
	if badLogo.Outcome != "REJECTED" || badLogo.Error == nil || badLogo.Error.ErrorCode != "INVALID_ASSET_PATH" {
		t.Fatalf("external logo URL was not rejected: %+v", badLogo)
	}
}

// R18.x: MERCHANT-DIRECTORY-001 tripwire
// 'Creator 经营' in merchant-me-r21.tsx was hardcoded Linh / Khoa / Bao.
// The real flow is: admin upserts a member_directory row (with display
// name); owner lists it; non-member is rejected.
func TestMemberDirectoryUpsertAndList(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)

	added := service.Handle(businessEnvelope("owner", "AddBusinessMember", businessID, map[string]any{
		"businessId": businessID, "userId": "creator-linh", "role": "OPERATOR",
	}))
	if added.Outcome != "ACCEPTED" {
		t.Fatalf("add member failed: %+v", added)
	}
	upserted := service.Handle(businessEnvelope("owner", "UpsertMemberDirectory", businessID, map[string]any{
		"businessId": businessID, "userId": "creator-linh", "displayName": "Linh", "role": "OPERATOR", "status": "ACTIVE",
	}))
	if upserted.Outcome != "ACCEPTED" {
		t.Fatalf("directory upsert failed: %+v", upserted)
	}
	listed := service.Handle(businessEnvelope("owner", "ListMemberDirectory", businessID, map[string]any{"businessId": businessID}))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("directory list failed: %+v", listed)
	}
	var listBody map[string]any
	_ = json.Unmarshal([]byte(listed.OperationRef), &listBody)
	members := listBody["members"].([]any)
	if len(members) < 2 {
		t.Fatalf("expected at least 2 members (owner + creator-linh), got %d", len(members))
	}
	foundLinh := false
	for _, m := range members {
		entry := m.(map[string]any)
		if entry["userId"] == "creator-linh" && entry["displayName"] == "Linh" {
			foundLinh = true
		}
	}
	if !foundLinh {
		t.Fatalf("expected displayName 'Linh' in directory, got %+v", listBody["members"])
	}
}

// R18.x: MERCHANT-SPEND-DAILY-001 tripwire
// 'sales' / 'ops' / 'proxy' pages in merchant-me-r21.tsx were 100%
// hardcoded (12.6tr VND, 148 订单, 85K 客单, etc). The real flow is
// any actor with write role upserts a spend_daily row, OWNER/ADMIN
// lists the rolling window; without any data the page renders empty
// rather than the bogus '12.6tr' fallback.
func TestSpendDailyUpsertAndList(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)

	// 日期必须相对「现在」取：ListSpendDaily 是 sinceDays 滚动窗口，
	// 写死 bucketDate 会在过几天后被滚出窗口，导致这条 tripwire 变成定时炸弹
	// （2026-09-12 起 totalOrders 恒为 0，全仓库 g2 红）。
	bucketDate := time.Now().UTC().Format("2006-01-02")
	upsert := service.Handle(businessEnvelope("owner", "UpsertSpendDaily", businessID, map[string]any{
		"businessId":             businessID,
		"bucketDate":             bucketDate,
		"orderCount":             18,
		"grossMinor":             12_600_000_000,
		"newCustomerCount":       4,
		"returningCustomerCount": 14,
	}))
	if upsert.Outcome != "ACCEPTED" {
		t.Fatalf("spend daily upsert failed: %+v", upsert)
	}
	listed := service.Handle(businessEnvelope("owner", "ListSpendDaily", businessID, map[string]any{
		"businessId": businessID, "sinceDays": 7,
	}))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("spend daily list failed: %+v", listed)
	}
	var listBody map[string]any
	_ = json.Unmarshal([]byte(listed.OperationRef), &listBody)
	if int(listBody["totalOrders"].(float64)) != 18 {
		t.Fatalf("totalOrders mismatch: %v", listBody["totalOrders"])
	}
	if int(listBody["totalGrossMinor"].(float64)) != 12_600_000_000 {
		t.Fatalf("totalGrossMinor mismatch: %v", listBody["totalGrossMinor"])
	}
	empty := service.Handle(businessEnvelope("intruder", "ListSpendDaily", "biz_unknown", map[string]any{
		"businessId": "biz_unknown", "sinceDays": 7,
	}))
	if empty.Outcome != "REJECTED" || empty.Error == nil || empty.Error.ErrorCode != "BUSINESS_FINANCE_REQUIRED" {
		t.Fatalf("non-existent business should fail role check: %+v", empty)
	}
}

func TestMerchantOperatingHomeDoesNotInventDemandOrForecast(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "木光咖啡"}))
	var createdBody map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &createdBody)
	businessID := createdBody["businessId"].(string)
	service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{"businessId": businessID, "name": "西湖店", "address": "Tây Hồ"}))
	// 同 TestSpendDailyUpsertAndList：bucketDate 必须相对「现在」取。
	// GetMerchantOperatingHome 走的是 ListSpendDaily(ctx, id, 7) 的 7 天
	// 滚动窗口，写死日期过几天就被滚出窗口 → OrderCount 恒为 0 → 全仓库
	// g2 红。2026-09-13 这条测试就是这样炸的。
	today := time.Now().UTC().Format("2006-01-02")
	service.Handle(businessEnvelope("owner", "UpsertSpendDaily", businessID, map[string]any{
		"businessId": businessID, "bucketDate": today, "orderCount": 3,
		"grossMinor": 450000000, "newCustomerCount": 1, "returningCustomerCount": 2,
	}))

	result := service.Handle(businessEnvelope("owner", "GetMerchantOperatingHome", businessID, map[string]any{"businessId": businessID}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("operating home failed: %+v", result)
	}
	var body struct {
		Home OperatingHome `json:"home"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Home.Outcome.OrderCount != 3 || body.Home.Outcome.GrossMinor != 450000000 {
		t.Fatalf("real outcome not projected: %+v", body.Home.Outcome)
	}
	if body.Home.Balance.State != "INSUFFICIENT_SIGNAL" || body.Home.Balance.Confidence != 0 {
		t.Fatalf("demand must remain unknown: %+v", body.Home.Balance)
	}
	if body.Home.Forecast.Status != "UNAVAILABLE" || body.Home.Forecast.Version != 0 {
		t.Fatalf("forecast must not be invented: %+v", body.Home.Forecast)
	}
	if body.Home.Decision.Kind != "NO_ACTION" {
		t.Fatalf("low-confidence decision must be NO_ACTION: %+v", body.Home.Decision)
	}
}

// MERCHANT-PUBLISH-001: 只有 ACTIVE 账号的 OWNER/ADMIN 能以店名义发布。
func TestMerchantPublishIdentity(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "木光咖啡"}))
	var body map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	bizID, _ := body["businessId"].(string)
	if bizID == "" {
		t.Fatal("no businessId")
	}
	ctx := context.Background()
	if name, ok := service.MerchantPublishIdentity(ctx, bizID, "owner"); !ok || name != "木光咖啡" {
		t.Fatalf("owner must publish as shop, got %q %v", name, ok)
	}
	if _, ok := service.MerchantPublishIdentity(ctx, bizID, "stranger"); ok {
		t.Fatal("non-member must not publish as shop")
	}
	if _, ok := service.MerchantPublishIdentity(ctx, "biz_nope", "owner"); ok {
		t.Fatal("unknown shop must not publish")
	}
	if _, ok := service.MerchantPublishIdentity(ctx, "", "owner"); ok {
		t.Fatal("empty shop must not publish")
	}
	// OPERATOR 成员不能以店名义发布（仅 OWNER/ADMIN）。
	added := service.Handle(businessEnvelope("owner", "AddBusinessMember", bizID, map[string]any{
		"businessId": bizID, "userId": "operator", "role": "OPERATOR",
	}))
	if added.Outcome != "ACCEPTED" {
		t.Fatalf("add member: %+v", added)
	}
	if _, ok := service.MerchantPublishIdentity(ctx, bizID, "operator"); ok {
		t.Fatal("OPERATOR must not publish as shop")
	}
}

// STORE-AMENITIES-001: 门店设施属性商家自填（网速/吸烟/空调/插座/噪音/座位）。
// 空=没填；封闭词表外的值整单拒绝（不静默丢字段）；空调 16..30 度，0=没填。
func TestStoreLinesAmenitiesRoundTrip(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	var body map[string]any
	_ = json.Unmarshal([]byte(created.OperationRef), &body)
	businessID := body["businessId"].(string)
	store := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "West Lake", "address": "Tay Ho",
	}))
	var storeBody map[string]any
	_ = json.Unmarshal([]byte(store.OperationRef), &storeBody)
	storeID := storeBody["storeId"].(string)

	upsert := service.Handle(businessEnvelope("owner", "UpsertStoreLines", storeID, map[string]any{
		"storeId": storeID, "wifi": "a", "smoking": "none", "acTempC": 24,
		"power": "FULL", "quiet": "quiet", "seating": "sofa",
	}))
	if upsert.Outcome != "ACCEPTED" {
		t.Fatalf("amenities upsert failed: %+v", upsert)
	}
	read := service.Handle(businessEnvelope("owner", "GetStoreLines", storeID, map[string]any{"storeId": storeID}))
	var readBody map[string]any
	_ = json.Unmarshal([]byte(read.OperationRef), &readBody)
	lines := readBody["lines"].(map[string]any)
	// 大小写归一（商家填小写也认），值原样落库。
	if lines["wifi"] != "A" || lines["smoking"] != "NONE" || lines["power"] != "FULL" ||
		lines["quiet"] != "QUIET" || lines["seating"] != "SOFA" {
		t.Fatalf("amenities mismatch: %v", lines)
	}
	if lines["acTempC"] != float64(24) {
		t.Fatalf("acTempC mismatch: %v", lines["acTempC"])
	}

	bad := []map[string]any{
		{"storeId": storeID, "wifi": "Z"},
		{"storeId": storeID, "smoking": "随便"},
		{"storeId": storeID, "acTempC": 40},
		{"storeId": storeID, "power": "时有时无"},
	}
	for i, payload := range bad {
		result := service.Handle(businessEnvelope("owner", "UpsertStoreLines", storeID, payload))
		if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "INVALID_STORE_AMENITIES" {
			t.Fatalf("case %d: want INVALID_STORE_AMENITIES, got %+v", i, result)
		}
	}
}
