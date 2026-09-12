package marketplace

import (
	"encoding/json"
	"testing"
)

// OPP-TARGETED-001: 定向邀约（选人 → 向 TA 发出邀约）。发布带
// targetUserId 时：owner 和目标人在 List 里能看到，第三方看不到；
// 只有目标人能 Apply（旁路拿 id 打命令也拒）；发布者不能定向给自己。
// 不带 targetUserId = 经典公开卡，行为与之前完全一致。
func TestTargetedOpportunityVisibilityAndApply(t *testing.T) {
	s := New()
	s.SeedDefaults()

	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "日落咖啡 · 湖边", "theme": "日落咖啡", "date": "周六", "time": "17:30–19:30", "location": "河内 · 西湖",
		"price": "250,000₫", "moneyFlow": "EARN", "skills": "日落 · 咖啡 · 湖边", "lens": []string{"NEARBY"},
		"targetUserId": "linh",
	}))
	if published.Outcome != "ACCEPTED" {
		t.Fatalf("targeted publish: %+v", published)
	}
	var publishBody struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &publishBody); err != nil {
		t.Fatal(err)
	}
	if publishBody.Opportunity.TargetAccountID != "linh" {
		t.Fatalf("targetAccountID not snapshotted: %+v", publishBody.Opportunity)
	}
	oppID := publishBody.Opportunity.ID

	// 1. 目标人可见。
	linhList := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "linh", nil))
	var linhBody struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(linhList.OperationRef), &linhBody); err != nil {
		t.Fatal(err)
	}
	if !containsOpportunity(linhBody.Opportunities, oppID) {
		t.Fatalf("target cannot see her directed invitation")
	}

	// 2. 第三方不可见。
	otherList := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "stranger", nil))
	var otherBody struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(otherList.OperationRef), &otherBody); err != nil {
		t.Fatal(err)
	}
	if containsOpportunity(otherBody.Opportunities, oppID) {
		t.Fatalf("a stranger saw a directed invitation — visibility leak")
	}

	// 3. owner 自己可见（要能跟进报名名单）。
	ownerList := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "owner", nil))
	var ownerBody struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(ownerList.OperationRef), &ownerBody); err != nil {
		t.Fatal(err)
	}
	if !containsOpportunity(ownerBody.Opportunities, oppID) {
		t.Fatalf("owner cannot see own directed invitation")
	}

	// 4. 目标人可以 Apply。
	applied := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "linh", map[string]any{
		"opportunityId": oppID, "quote": "250,000₫", "scope": "日落 · 咖啡",
	}))
	if applied.Outcome != "ACCEPTED" {
		t.Fatalf("target apply: %+v", applied)
	}

	// 5. 旁路：第三方拿 opportunityId 直接打 Apply 命令 → 拒。
	bypass := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "stranger", map[string]any{
		"opportunityId": oppID, "quote": "250,000₫", "scope": "旁路",
	}))
	if bypass.Outcome != "REJECTED" || bypass.Error == nil || bypass.Error.ErrorCode != "APPLICATION_NOT_INVITED" {
		t.Fatalf("stranger bypass apply must be REJECTED (APPLICATION_NOT_INVITED): %+v", bypass)
	}

	// 6. 不能定向给自己。
	selfTarget := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "自邀", "theme": "自邀", "date": "周六", "time": "10:00", "location": "河内",
		"price": "100,000₫", "moneyFlow": "EARN", "skills": "x", "lens": []string{"NEARBY"},
		"targetUserId": "owner",
	}))
	if selfTarget.Outcome != "REJECTED" {
		t.Fatalf("self-targeted publish must be rejected: %+v", selfTarget)
	}
}

// 不带 targetUserId 的公开卡行为不变（回归护栏）：任何人可见、任何人可报名。
func TestPublicOpportunityUnchangedBesideTargeted(t *testing.T) {
	s := New()
	s.SeedDefaults()

	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "公开喝咖啡", "theme": "喝咖啡", "date": "周六", "time": "15:00–17:00", "location": "河内",
		"price": "200,000₫", "moneyFlow": "EARN", "skills": "咖啡", "lens": []string{"NEARBY"},
	}))
	if published.Outcome != "ACCEPTED" {
		t.Fatalf("public publish: %+v", published)
	}
	var body struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Opportunity.TargetAccountID != "" {
		t.Fatalf("public card must not carry targetAccountId: %+v", body.Opportunity)
	}
	for _, viewer := range []string{"linh", "stranger", "owner"} {
		listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", viewer, nil))
		var listBody struct {
			Opportunities []Opportunity `json:"opportunities"`
		}
		if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
			t.Fatal(err)
		}
		if !containsOpportunity(listBody.Opportunities, body.Opportunity.ID) {
			t.Fatalf("public card invisible to %s — visibility regression", viewer)
		}
	}
}

func containsOpportunity(items []Opportunity, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}
