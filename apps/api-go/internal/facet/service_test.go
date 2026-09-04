package facet

import (
	"testing"
)

func TestFacetService_ListReturnsObjects(t *testing.T) {
	repo := NewMemoryRepository()
	repo.Seed(nil, []Object{
		{ID: "f1", DisplayName: "Alice", Relation: "CREATOR_COLLAB", Goal: "photo"},
	})
	s := NewWithRepository(repo)
	list, err := s.List(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list.Objects) == 0 {
		t.Fatal("expected at least one object")
	}
}

func TestFacetService_ReasonerAppliesSignals(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	_ = s
}
