package invite

import "testing"

func TestMaterialize(t *testing.T) {
	cases := []struct{
		src SourceContextType
		want MaterializedType
		fail bool
	}{
		{SourceProfile, MaterializedPlan, false},
		{SourceScene, MaterializedPlan, false},
		{SourceActivity, MaterializedParticipation, false},
		{SourceOpportunity, MaterializedOrderDraft, false},
		{SourceBusiness, MaterializedOrderDraft, false},
		{SourceAITwin, "", true},
	}
	for _, c := range cases {
		got, err := Materialize(Invite{SourceContextType: c.src})
		if c.fail && err==nil { t.Fatalf("expected fail %s", c.src)}
		if !c.fail && got!=c.want { t.Fatalf("src %s got %s want %s", c.src, got, c.want)}
	}
}

func TestMaterialChange(t *testing.T) {
	if !IsMaterialChange(map[string]any{"price":100}, map[string]any{"price":200}) { t.Fatal("should be material")}
	if IsMaterialChange(map[string]any{"price":100}, map[string]any{"price":100}) { t.Fatal("should not be material")}
	if NextTermsVersion(1,true)!=2 { t.Fatal("version bump")}
	if NextTermsVersion(1,false)!=1 { t.Fatal("version keep")}
}
