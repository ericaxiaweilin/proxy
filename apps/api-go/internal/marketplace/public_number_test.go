package marketplace

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// PUBLIC-NO-001：需求 / 邀约发布成功页的编号以前是客户端随机生成的 PX-N / PX-O，
// 服务端不认识、查不到。现在由服务端在发布时分配全数字编号（与订单共用一个序列，
// 一个号只指向一样东西），发布结果和列表里都带着它。
func TestPublishedOpportunityHasServerNumber(t *testing.T) {
	s := New()
	numbers := map[string]bool{}
	for _, target := range []string{"", "invitee"} {
		payload := map[string]any{"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖", "price": "2,000,000₫", "skills": "中文"}
		if target != "" {
			payload["targetUserId"] = target
		}
		published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", payload))
		var body struct {
			Opportunity Opportunity `json:"opportunity"`
		}
		if err := json.Unmarshal([]byte(published.OperationRef), &body); err != nil || published.Outcome != "ACCEPTED" {
			t.Fatalf("publish: %+v", published)
		}
		if !ordernumber.Valid(body.Opportunity.Number) || numbers[body.Opportunity.Number] {
			t.Fatalf("each published opportunity needs its own all-digit number, got %q", body.Opportunity.Number)
		}
		numbers[body.Opportunity.Number] = true
	}
	listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "owner", nil))
	var list struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	_ = json.Unmarshal([]byte(listed.OperationRef), &list)
	found := 0
	for _, o := range list.Opportunities {
		if numbers[o.Number] {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("list must carry the numbers of both published opportunities, found %d", found)
	}
}
