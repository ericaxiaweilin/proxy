package supply

import (
	"testing"
	"time"
)

// MERCHANT-CREATOR-PROMO-001（门槛 + 调整原因）：
//   - 绑定可带门槛 minSpendVnd（0 = 无门槛）和调整原因 note，读回来原样在；
//   - 门槛低于面额（满 3 万减 5 万）拒；
//   - 报码时消费额不到门槛 → PROMO_BELOW_MIN_SPEND，并把门槛带回去让店员说清楚；够门槛照常减；
//   - 自动档的默认门槛，自动建绑定时照抄。
func TestPromoBenefitMinSpendAndNote(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_ms", "MinSpend", []string{"ZH"}, "hn", 1200000)
	claimAs(t, s, "agent_ms", "MAI50")
	until := time.Now().AddDate(0, 1, 0).Format("2006-01-02")

	if out, _ := promoAsMerchant(t, s, "BindPromoBenefit", map[string]any{
		"code": "MAI50", "faceValueVnd": 50000, "minSpendVnd": 30000, "scopeName": "全场饮品", "validUntil": until,
	}, "m_ms"); out == "ACCEPTED" {
		t.Fatal("a threshold below the face value must be rejected")
	}
	out, view := promoAsMerchant(t, s, "BindPromoBenefit", map[string]any{
		"code": "MAI50", "faceValueVnd": 50000, "minSpendVnd": 200000, "scopeName": "全场饮品", "validUntil": until,
		"note": "她粉丝偏年轻，设个门槛",
	}, "m_ms")
	if out != "ACCEPTED" {
		t.Fatalf("bind with threshold: %s", out)
	}
	b, _ := view["benefit"].(map[string]any)
	if b["minSpendVnd"] != float64(200000) || b["note"] != "她粉丝偏年轻，设个门槛" {
		t.Fatalf("benefit must carry threshold and note: %+v", b)
	}

	env := envelopeFor("QuotePromoCode", map[string]any{"code": "MAI50", "amountVnd": 150000, "firstVisit": true}, "")
	env.AuthContext = map[string]any{"merchantID": "m_ms"}
	r := s.Handle(env)
	if r.Error == nil || r.Error.ErrorCode != "PROMO_BELOW_MIN_SPEND" {
		t.Fatalf("below threshold must be PROMO_BELOW_MIN_SPEND: %+v", r)
	}
	if r.Error.SafeDetails["minSpendVnd"] != int64(200000) {
		t.Fatalf("rejection must tell the clerk the threshold: %+v", r.Error.SafeDetails)
	}
	out, view = promoAsMerchant(t, s, "QuotePromoCode", map[string]any{"code": "MAI50", "amountVnd": 260000, "firstVisit": true}, "m_ms")
	if out != "ACCEPTED" {
		t.Fatalf("at or above threshold must quote: %s", out)
	}
	if got, _ := view["benefit"].(map[string]any); got["minSpendVnd"] != float64(200000) || got["faceValueVnd"] != float64(50000) {
		t.Fatalf("quote result must show the terms used: %+v", got)
	}

	// 自动档：默认门槛照抄到自动建的绑定上。
	setupAgent(t, s, "agent_auto_ms", "AutoMs", []string{"ZH"}, "hn", 1200000)
	claimAs(t, s, "agent_auto_ms", "AUTO20")
	if out, _ := promoAsMerchant(t, s, "SetAutoPromoBenefit", map[string]any{
		"enabled": true, "faceValueVnd": 20000, "minSpendVnd": 10000, "scopeName": "全场", "validityDays": 30,
	}, "m_ms"); out == "ACCEPTED" {
		t.Fatal("auto threshold below face value must be rejected")
	}
	if out, _ := promoAsMerchant(t, s, "SetAutoPromoBenefit", map[string]any{
		"enabled": true, "faceValueVnd": 20000, "minSpendVnd": 100000, "scopeName": "全场", "validityDays": 30,
	}, "m_ms"); out != "ACCEPTED" {
		t.Fatalf("set auto with threshold: %s", out)
	}
	env = envelopeFor("QuotePromoCode", map[string]any{"code": "AUTO20", "amountVnd": 50000}, "")
	env.AuthContext = map[string]any{"merchantID": "m_ms"}
	if r := s.Handle(env); r.Error == nil || r.Error.ErrorCode != "PROMO_BELOW_MIN_SPEND" {
		t.Fatalf("auto-bound benefit must keep the default threshold: %+v", r)
	}
	saved, err := s.repository.GetPromoBenefit(t.Context(), "m_ms", "AUTO20")
	if err != nil || saved.MinSpendVND != 100000 || saved.Source != "AUTO" {
		t.Fatalf("auto-bound benefit: %+v err=%v", saved, err)
	}
}
