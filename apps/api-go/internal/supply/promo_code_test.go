package supply

import (
	"encoding/json"
	"testing"
	"time"
)

// MERCHANT-CREATOR-PROMO-001：专属营销码全链路 —— creator 认领 → 商家绑定优惠 →
// 店员报码 → 双方看统计。鉴权三边各守一边：码只能本人认领，绑定/报码只能商家。

func claimAs(t *testing.T, s *Service, agentID, code string) map[string]any {
	t.Helper()
	r := s.Handle(envelopeForPrincipal("ClaimPromoCode", map[string]any{
		"agentId": agentID, "code": code,
	}, "", agentID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("claim %s: %s (%+v)", code, r.Outcome, r.Error)
	}
	var view struct {
		PromoCode map[string]any `json:"promoCode"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return view.PromoCode
}

func promoAsMerchant(t *testing.T, s *Service, commandType string, payload map[string]any, merchantID string) (string, map[string]any) {
	t.Helper()
	env := envelopeFor(commandType, payload, "")
	env.AuthContext = map[string]any{"merchantID": merchantID}
	r := s.Handle(env)
	if r.Outcome != "ACCEPTED" {
		return r.Outcome, nil
	}
	var view map[string]any
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return r.Outcome, view
}

func TestPromoCodeClaimBindQuoteLifecycle(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_promo", "Promo", []string{"ZH"}, "hn", 1200000)

	// creator 认领：大小写归一（linh88 == LINH88），一人一个。
	claimed := claimAs(t, s, "agent_promo", "linh88")
	if claimed["code"] != "LINH88" {
		t.Fatalf("code must normalize to LINH88, got %v", claimed["code"])
	}
	// 脏码直接拒。
	r := s.Handle(envelopeForPrincipal("ClaimPromoCode", map[string]any{
		"agentId": "agent_promo", "code": "hi!",
	}, "", "agent_promo"))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("malformed code must be rejected")
	}
	// 第二个码直接拒（先停旧的）。
	r = s.Handle(envelopeForPrincipal("ClaimPromoCode", map[string]any{
		"agentId": "agent_promo", "code": "LINH99",
	}, "", "agent_promo"))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("second active code must be rejected")
	}
	// 别人抢注同一个码直接拒。
	setupAgent(t, s, "agent_rival", "Rival", []string{"ZH"}, "hn", 1200000)
	r = s.Handle(envelopeForPrincipal("ClaimPromoCode", map[string]any{
		"agentId": "agent_rival", "code": "LINH88",
	}, "", "agent_rival"))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("taken code must be rejected")
	}

	// 商家绑定优惠：没人认领的码绑不上。
	if outcome, _ := promoAsMerchant(t, s, "BindPromoBenefit", map[string]any{
		"code": "NOBODY", "faceValueVnd": 50000, "scopeName": "全场", "validUntil": "2099-01-01",
	}, "merchant_1"); outcome == "ACCEPTED" {
		t.Fatal("binding unknown code must be rejected")
	}
	validUntil := time.Now().Add(30 * 24 * time.Hour).Format("2006-01-02")
	if outcome, view := promoAsMerchant(t, s, "BindPromoBenefit", map[string]any{
		"code": "LINH88", "faceValueVnd": 50000, "scopeName": "全场饮品", "validUntil": validUntil,
	}, "merchant_1"); outcome != "ACCEPTED" {
		t.Fatalf("bind: %s (%+v)", outcome, view)
	} else if benefit, _ := view["benefit"].(map[string]any); benefit["faceValueVnd"] != float64(50000) {
		t.Fatalf("benefit must carry face value, got %v", view["benefit"])
	}
	// 同一家重复绑直接拒。
	if outcome, _ := promoAsMerchant(t, s, "BindPromoBenefit", map[string]any{
		"code": "LINH88", "faceValueVnd": 30000, "scopeName": "全场", "validUntil": validUntil,
	}, "merchant_1"); outcome == "ACCEPTED" {
		t.Fatal("duplicate binding must be rejected")
	}

	// 店员报码：金额 + 新客勾。返回优惠 terms（店员按这个减钱）。
	if outcome, view := promoAsMerchant(t, s, "QuotePromoCode", map[string]any{
		"code": "linh88", "amountVnd": 200000, "firstVisit": true,
	}, "merchant_1"); outcome != "ACCEPTED" {
		t.Fatalf("quote: %s (%+v)", outcome, view)
	} else {
		quote, _ := view["quote"].(map[string]any)
		if quote["agentId"] != "agent_promo" || quote["discountVnd"] != float64(50000) || quote["firstVisit"] != true {
			t.Fatalf("quote must attribute agent + snapshot discount + firstVisit, got %v", quote)
		}
		benefit, _ := view["benefit"].(map[string]any)
		if benefit["faceValueVnd"] != float64(50000) || benefit["scopeName"] != "全场饮品" {
			t.Fatalf("quote must return benefit terms, got %v", benefit)
		}
	}
	// 60 秒内连报同一码算重手，直接拒。
	if outcome, _ := promoAsMerchant(t, s, "QuotePromoCode", map[string]any{
		"code": "LINH88", "amountVnd": 100000,
	}, "merchant_1"); outcome == "ACCEPTED" {
		t.Fatal("double-tap quote must be rejected")
	}
	// 没绑定的店报码直接拒（码存在， binding 是别家的）。
	if outcome, _ := promoAsMerchant(t, s, "QuotePromoCode", map[string]any{
		"code": "LINH88", "amountVnd": 100000,
	}, "merchant_other"); outcome == "ACCEPTED" {
		t.Fatal("quoting at unbound merchant must be rejected")
	}

	// 统计：商家看合计 + 按码拆；creator 看自己的。
	if outcome, view := promoAsMerchant(t, s, "GetPromoStats", map[string]any{"role": "merchant"}, "merchant_1"); outcome != "ACCEPTED" {
		t.Fatalf("merchant stats: %s", outcome)
	} else {
		stats, _ := view["stats"].(map[string]any)
		if stats["quotes"] != float64(1) || stats["firstVisits"] != float64(1) || stats["attributedVnd"] != float64(200000) {
			t.Fatalf("merchant stats must be 1 quote / 1 firstVisit / 200000, got %v", stats)
		}
		byCode, _ := stats["byCode"].(map[string]any)
		if linh, _ := byCode["LINH88"].(map[string]any); linh["quotes"] != float64(1) {
			t.Fatalf("per-code stats must carry LINH88, got %v", byCode)
		}
	}
	r = s.Handle(envelopeForPrincipal("GetPromoStats", map[string]any{"role": "mine"}, "", "agent_promo"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("agent stats: %s (%+v)", r.Outcome, r.Error)
	}
	var agentView struct {
		Stats map[string]any `json:"stats"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &agentView)
	if agentView.Stats["quotes"] != float64(1) {
		t.Fatalf("agent must see her 1 quote, got %v", agentView.Stats)
	}
	// creator 看我的码。
	r = s.Handle(envelopeForPrincipal("ListPromoAssets", map[string]any{"role": "my"}, "", "agent_promo"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list my codes: %s (%+v)", r.Outcome, r.Error)
	}
}
