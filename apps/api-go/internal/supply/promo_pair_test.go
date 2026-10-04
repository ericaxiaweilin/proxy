package supply

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// MERCHANT-CREATOR-PROMO-002：商家 × creator 专属码全链路 ——
// 发码（系统建议）→ 手动调整（留痕）→ 顾客领券（发券）→ 店员核销（门槛 / 本店 / 一券一次 /
// 新客由系统判定）→ 战绩（按新客排序 + 核销转化率）→ creator 看自己在各家店的码。

func asMerchant(s *Service, merchantID, commandType string, payload map[string]any) command.Result {
	env := envelopeFor(commandType, payload, "")
	env.AuthContext = map[string]any{"merchantID": merchantID}
	return s.Handle(env)
}

func asCustomer(s *Service, customerID, commandType string, payload map[string]any) command.Result {
	env := envelopeFor(commandType, payload, "")
	env.Actor = command.Actor{Type: "USER", ID: customerID}
	env.Principal = command.Principal{Type: "PERSON", ID: customerID}
	return s.Handle(env)
}

func bodyOf(t *testing.T, r command.Result) map[string]any {
	t.Helper()
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s %+v", r.Outcome, r.Error)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(r.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func errCode(r command.Result) string {
	if r.Error == nil {
		return ""
	}
	return r.Error.ErrorCode
}

type fakeStores map[string]MerchantStoreProfile

func (f fakeStores) MerchantStore(_ context.Context, merchantID string) (MerchantStoreProfile, error) {
	return f[merchantID], nil
}

func TestMerchantCreatorPromoPairCodes(t *testing.T) {
	s := New()
	// 商家登录就知道自己开的什么店：品类从门店资料读（店主填的越南语原文）。
	s.SetMerchantStoreLookup(fakeStores{
		"m_ws":  {Name: "Workshop", Category: "Món Âu / Bistro"},
		"m_pho": {Name: "Phở 10", Category: "Phở bò"},
	})
	ctx := t.Context()
	setupAgent(t, s, "agent_an", "An", []string{"VI"}, "hn", 900000)
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	claimAs(t, s, "agent_linh", "LINH88")

	// 系统建议的真实读数：An 自填 1.2w 粉丝、垂类含餐饮。
	profile, _ := s.repository.GetProfile(ctx, "agent_an")
	profile.Socials = []AgentSocial{{Platform: "tiktok", Handle: "an_hanoi", Visibility: "PUBLIC", FollowerCount: 12000}}
	_ = s.repository.UpdateProfile(ctx, profile)
	svc, _ := s.repository.GetService(ctx, "agent_an", "CITY_COMPANION")
	svc.VerticalTags = []string{"RESTAURANT"} // 库里存编码（展示时才翻成「餐饮」）
	_ = s.repository.UpdateService(ctx, svc)

	// 1. 发码：一对一个唯一码；creator 认领过全局码的用它做前缀。
	an := bodyOf(t, asMerchant(s, "m_ws", "IssueMerchantCreatorPromo", map[string]any{"agentId": "agent_an", "merchantName": "Workshop"}))["promo"].(map[string]any)
	if an["code"] != "AN-WORKSHOP" || an["mode"] != "SUGGESTED" {
		t.Fatalf("pair code / mode: %+v", an)
	}
	terms := an["terms"].(map[string]any)
	// 基准 8% + 中腰部 1% + 垂类覆盖 1% = 10%；客单价没数据按 50 万 ⇒ 满50万减5万。
	if terms["minSpendVnd"] != float64(500000) || terms["faceValueVnd"] != float64(50000) || terms["displayText"] != "满50万减5万" || terms["scope"] != PromoScopeCategory {
		t.Fatalf("suggested terms: %+v", terms)
	}
	again := bodyOf(t, asMerchant(s, "m_ws", "IssueMerchantCreatorPromo", map[string]any{"agentId": "agent_an", "merchantName": "Workshop"}))["promo"].(map[string]any)
	if again["code"] != "AN-WORKSHOP" {
		t.Fatalf("issuing twice must return the same code: %v", again["code"])
	}
	linh := bodyOf(t, asMerchant(s, "m_ws", "IssueMerchantCreatorPromo", map[string]any{"agentId": "agent_linh", "merchantName": "Workshop"}))["promo"].(map[string]any)
	if linh["code"] != "LINH88-WORKSHOP" {
		t.Fatalf("a creator's own code must prefix her pair codes: %v", linh["code"])
	}
	other := bodyOf(t, asMerchant(s, "m_pho", "IssueMerchantCreatorPromo", map[string]any{"agentId": "agent_an", "merchantName": "ignored"}))["promo"].(map[string]any)
	if other["code"] != "AN-PHO10" {
		t.Fatalf("the same creator at another shop gets another code: %v", other["code"])
	}

	// 2. 手动调整（留痕）；门槛低于面额拒。
	if r := asMerchant(s, "m_ws", "AdjustMerchantCreatorPromo", map[string]any{"code": "LINH88-WORKSHOP", "minSpendVnd": 30000, "faceValueVnd": 50000, "scope": PromoScopeAll}); errCode(r) != "INVALID_PROMO_THRESHOLD" {
		t.Fatalf("threshold below face value must be rejected: %+v", r.Error)
	}
	long := 0
	adjusted := bodyOf(t, asMerchant(s, "m_ws", "AdjustMerchantCreatorPromo", map[string]any{
		"code": "LINH88-WORKSHOP", "minSpendVnd": 0, "faceValueVnd": 50000, "scope": PromoScopeAll, "validityDays": long, "note": "她粉丝偏年轻，改无门槛",
	}))
	adj := adjusted["promo"].(map[string]any)
	if adj["mode"] != "MANUAL" || adj["terms"].(map[string]any)["validUntil"] != "" || adj["terms"].(map[string]any)["displayText"] != "无门槛减5万" {
		t.Fatalf("manual adjustment: %+v", adj)
	}
	if ch := adjusted["change"].(map[string]any); ch["note"] != "她粉丝偏年轻，改无门槛" || ch["before"].(map[string]any)["minSpendVnd"] == float64(0) {
		t.Fatalf("change log must keep before/after and the reason: %+v", ch)
	}
	if r := asMerchant(s, "m_pho", "AdjustMerchantCreatorPromo", map[string]any{"code": "LINH88-WORKSHOP", "faceValueVnd": 1, "scope": PromoScopeAll}); errCode(r) != "PROMO_NOT_FOUND" {
		t.Fatalf("another shop cannot adjust this code: %+v", r.Error)
	}

	// 3. 发券：每人每码一张。
	c1 := bodyOf(t, asCustomer(s, "cust_1", "ClaimPromoCoupon", map[string]any{"code": "an-workshop"}))["coupon"].(map[string]any)
	c1again := asCustomer(s, "cust_1", "ClaimPromoCoupon", map[string]any{"code": "AN-WORKSHOP"})
	if bodyOf(t, c1again)["coupon"].(map[string]any)["couponId"] != c1["couponId"] {
		t.Fatal("claiming twice must return the same coupon")
	}
	couponAn := c1["couponId"].(string)
	couponLinh := bodyOf(t, asCustomer(s, "cust_1", "ClaimPromoCoupon", map[string]any{"code": "LINH88-WORKSHOP"}))["coupon"].(map[string]any)["couponId"].(string)
	bodyOf(t, asCustomer(s, "cust_2", "ClaimPromoCoupon", map[string]any{"code": "AN-WORKSHOP"}))

	// 4. 核销。
	if r := asMerchant(s, "m_pho", "QuotePromoCode", map[string]any{"couponId": couponAn, "amountVnd": 600000}); errCode(r) != "PROMO_OTHER_MERCHANT" {
		t.Fatalf("a Workshop coupon cannot be redeemed at Phở 10: %+v", r.Error)
	}
	if r := asMerchant(s, "m_ws", "QuotePromoCode", map[string]any{"couponId": couponAn, "amountVnd": 300000}); errCode(r) != "PROMO_BELOW_MIN_SPEND" {
		t.Fatalf("below the threshold: %+v", r.Error)
	}
	q1 := bodyOf(t, asMerchant(s, "m_ws", "QuotePromoCode", map[string]any{"couponId": couponAn, "amountVnd": 600000}))["quote"].(map[string]any)
	if q1["firstVisit"] != true || q1["firstVisitSource"] != "SYSTEM" || q1["customerId"] != "cust_1" {
		t.Fatalf("first coupon redemption at this shop is a system-verified new customer: %+v", q1)
	}
	if r := asMerchant(s, "m_ws", "QuotePromoCode", map[string]any{"couponId": couponAn, "amountVnd": 600000}); errCode(r) != "COUPON_ALREADY_REDEEMED" {
		t.Fatalf("one coupon, one redemption: %+v", r.Error)
	}
	q2 := bodyOf(t, asMerchant(s, "m_ws", "QuotePromoCode", map[string]any{"couponId": couponLinh, "amountVnd": 200000, "firstVisit": true}))["quote"].(map[string]any)
	if q2["firstVisit"] != false {
		t.Fatalf("cust_1 already redeemed at this shop — not a new customer, whatever the clerk ticks: %+v", q2)
	}
	q3 := bodyOf(t, asMerchant(s, "m_ws", "QuotePromoCode", map[string]any{"code": "LINH88-WORKSHOP", "amountVnd": 150000, "firstVisit": true}))["quote"].(map[string]any)
	if q3["firstVisit"] != true || q3["firstVisitSource"] != "CLERK" {
		t.Fatalf("anonymous code redemption uses the clerk's tick: %+v", q3)
	}

	// 5. 战绩：按新客排序 + 整店合计 + 转化率（凭券核销 / 发券）。
	list := bodyOf(t, asMerchant(s, "m_ws", "ListMerchantCreatorPromos", map[string]any{}))
	totals := list["totals"].(map[string]any)
	if totals["issued"] != float64(3) || totals["redeemed"] != float64(3) || totals["couponRedeem"] != float64(2) || totals["newCustomers"] != float64(2) || totals["spendVnd"] != float64(950000) {
		t.Fatalf("totals: %+v", totals)
	}
	if list["conversionBp"] != float64(6666) {
		t.Fatalf("conversion = 2 coupon redemptions / 3 coupons: %v", list["conversionBp"])
	}
	promos := list["promos"].([]any)
	if len(promos) != 2 {
		t.Fatalf("Workshop has two pair codes: %d", len(promos))
	}
	first := promos[0].(map[string]any)
	if first["promo"].(map[string]any)["code"] != "AN-WORKSHOP" && first["promo"].(map[string]any)["code"] != "LINH88-WORKSHOP" {
		t.Fatalf("unexpected first: %+v", first)
	}
	for _, raw := range promos {
		v := raw.(map[string]any)
		if v["promo"].(map[string]any)["code"] == "LINH88-WORKSHOP" && v["lastChange"] == nil {
			t.Fatal("the manually adjusted code must show its last change")
		}
	}

	// 6. 查看依据：按当前数据重算，并带调整留痕。
	basis := bodyOf(t, asMerchant(s, "m_ws", "GetMerchantCreatorPromoBasis", map[string]any{"code": "AN-WORKSHOP"}))
	items := basis["suggestion"].(map[string]any)["basis"].([]any)
	if len(items) != 5 || items[0].(map[string]any)["available"] != true {
		t.Fatalf("basis items: %+v", items)
	}

	// 7. creator 只能看自己的码。
	mine := bodyOf(t, s.Handle(envelopeForPrincipal("ListMyMerchantPromos", map[string]any{"agentId": "agent_an"}, "", "agent_an")))
	if len(mine["promos"].([]any)) != 2 {
		t.Fatalf("An has codes at two shops: %+v", mine["promos"])
	}
	if r := s.Handle(envelopeForPrincipal("ListMyMerchantPromos", map[string]any{"agentId": "agent_an"}, "", "agent_linh")); r.Outcome == "ACCEPTED" {
		t.Fatal("Linh cannot list An's codes")
	}

	// 8. 顾客的券包：两张，都已核销。
	coupons := bodyOf(t, asCustomer(s, "cust_1", "ListMyPromoCoupons", map[string]any{}))["coupons"].([]any)
	if len(coupons) != 2 || coupons[0].(map[string]any)["redeemed"] != true || coupons[1].(map[string]any)["redeemed"] != true {
		t.Fatalf("cust_1 coupons: %+v", coupons)
	}
}

func TestSuggestPromoIsHonestAboutMissingData(t *testing.T) {
	now := time.Now()
	none := SuggestPromo(SuggestionInput{}, now)
	if none.PercentBP != 800 || none.MinSpendVND != 500000 || none.FaceValueVND != 40000 {
		t.Fatalf("no data ⇒ the plain baseline: %+v", none)
	}
	for _, b := range none.Basis {
		if b.Available || b.EffectBP != 0 {
			t.Fatalf("a dimension without data must say so and not move the number: %+v", b)
		}
	}
	rate := 0.4
	avg := 1500
	rich := SuggestPromo(SuggestionInput{Followers: 250000, VerticalMatch: boolPtr(true), RepurchaseRate: &rate, RepurchaseN: 20, CategoryAvgBP: &avg, CategoryN: 4, AvgTicketVND: 320000, Category: "餐饮"}, now)
	// 8 + 3 + 1 + 1 = 13%，和同品类 15% 对半 ⇒ 14%；门槛 30 万 ⇒ 面额 4.2 万 → 取整 4 万。
	if rich.PercentBP != 1400 || rich.MinSpendVND != 300000 || rich.FaceValueVND != 40000 {
		t.Fatalf("rich suggestion: %+v", rich)
	}
}

func boolPtr(b bool) *bool { return &b }

func TestVerticalCoversCategoryUsesStoredCodes(t *testing.T) {
	cases := []struct {
		tag, category string
		want          bool
	}{
		{"RESTAURANT", "餐饮", true}, {"CAFE", "餐饮", true}, {"CAFE", "咖啡", true}, {"RESTAURANT", "咖啡", true}, // 展示上餐厅、咖啡都并成「餐饮」
		{"TOUR", "旅游", true}, {"SPORT", "餐饮", false}, {"KTV", "餐饮", false}, {"餐饮", "餐饮", true},
	}
	for _, c := range cases {
		if got := verticalCoversCategory(c.tag, c.category); got != c.want {
			t.Errorf("verticalCoversCategory(%q, %q) = %v, want %v", c.tag, c.category, got, c.want)
		}
	}
}

func TestStoreCategoryGroupFromOwnerText(t *testing.T) {
	// 开发库里店主真填的品类原文。
	cases := map[string]string{
		"Cà phê": "咖啡", "Cà phê / Brunch": "咖啡", "Specialty coffee / Rang xay": "咖啡", "咖啡厅": "咖啡", "Trà / Cà phê": "咖啡",
		"Món Việt": "餐饮", "Hải sản": "餐饮", "Dimsum / Trung Hoa": "餐饮", "Buffet nướng / Nhật": "餐饮", "Bò bít tết / Nam Mỹ": "餐饮",
		"": "", "SPA": "SPA",
	}
	for raw, want := range cases {
		if got := StoreCategoryGroup(raw); got != want {
			t.Errorf("StoreCategoryGroup(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestPairPromoWithoutStoreCategoryCoversWholeStore(t *testing.T) {
	s := New() // 没接门店资料
	setupAgent(t, s, "agent_x", "Xuan", []string{"VI"}, "hn", 900000)
	promo := bodyOf(t, asMerchant(s, "m_x", "IssueMerchantCreatorPromo", map[string]any{"agentId": "agent_x", "merchantName": "Quan X"}))["promo"].(map[string]any)
	terms := promo["terms"].(map[string]any)
	if terms["scope"] != PromoScopeAll || promo["code"] != "XUAN-QUANX" {
		t.Fatalf("no store category ⇒ whole-store scope, name from the account: %+v", promo)
	}
	if r := asMerchant(s, "m_x", "AdjustMerchantCreatorPromo", map[string]any{"code": "XUAN-QUANX", "faceValueVnd": 30000, "scope": PromoScopeCategory}); errCode(r) != "STORE_CATEGORY_MISSING" {
		t.Fatalf("category scope needs a store category: %+v", r.Error)
	}
}

// 用户 2026-10-04：「不要让商家一个个给 creator 生成，而是系统自动生成的，商家唯一操作就是
// 选择下单或者调整系统自动的折扣值」—— 打开页面（列表）时，本店市场里在服务的 creator 自动有码。
func TestListAutoIssuesPairPromosForTheMarket(t *testing.T) {
	s := New()
	s.SetMerchantStoreLookup(fakeStores{"m_tb": {Name: "Three Beans", Category: "Cà phê"}})
	setupAgent(t, s, "agent_an", "An", []string{"VI"}, "hn", 900000)
	setupAgent(t, s, "agent_linh", "Linh", []string{"ZH"}, "hn", 1200000)
	setupAgent(t, s, "agent_minh", "Minh", []string{"VI"}, "hcm", 1100000)

	list := bodyOf(t, asMerchant(s, "m_tb", "ListMerchantCreatorPromos", map[string]any{"marketId": "hn"}))
	promos := list["promos"].([]any)
	codes := map[string]bool{}
	for _, raw := range promos {
		p := raw.(map[string]any)["promo"].(map[string]any)
		codes[p["code"].(string)] = true
		if p["mode"] != "SUGGESTED" || p["terms"].(map[string]any)["category"] != "咖啡" {
			t.Fatalf("auto-issued codes start from the suggestion and the store's own category: %+v", p)
		}
	}
	if len(codes) != 2 || !codes["AN-THREEBEANS"] || !codes["LINH-THREEBEANS"] {
		t.Fatalf("both Hanoi creators get a code, the HCMC one does not: %v", codes)
	}
	if list["storeCategory"] != "咖啡" {
		t.Fatalf("store category comes from the store profile: %v", list["storeCategory"])
	}

	// 商家调过的码，再打开不会被重置；也不会重复发。
	bodyOf(t, asMerchant(s, "m_tb", "AdjustMerchantCreatorPromo", map[string]any{"code": "AN-THREEBEANS", "minSpendVnd": 0, "faceValueVnd": 30000, "scope": PromoScopeAll}))
	again := bodyOf(t, asMerchant(s, "m_tb", "ListMerchantCreatorPromos", map[string]any{"marketId": "hn"}))["promos"].([]any)
	if len(again) != 2 {
		t.Fatalf("listing again must not issue duplicates: %d", len(again))
	}
	for _, raw := range again {
		p := raw.(map[string]any)["promo"].(map[string]any)
		if p["code"] == "AN-THREEBEANS" && p["mode"] != "MANUAL" {
			t.Fatalf("the merchant's adjustment must survive the next auto-issue pass: %+v", p)
		}
	}
	// 没给市场（老客户端）就只列已有的，不乱发。
	if n := len(bodyOf(t, asMerchant(s, "m_other", "ListMerchantCreatorPromos", map[string]any{}))["promos"].([]any)); n != 0 {
		t.Fatalf("no market ⇒ no auto-issue: %d", n)
	}
}
