package runtime

import "testing"

func TestBudget(t *testing.T) {
	b := Budget{MaxSchemaPayloadBytes: 100, MaxDeltaPayloadBytes: 500, MaxNodes: 2, MaxImages: 1}
	schema := UISchema{
		SchemaVersion: "ui_schema_v3",
		Root: UISchemaNode{Type: "stack", Children: []UISchemaNode{
			{Type: "image"}, {Type: "image"},
		}},
	}
	if err := b.CheckSchema(schema); err == nil {
		t.Fatal("expected budget exceeded")
	}
	delta := SurfaceDelta{SurfaceID: "home", BaseVersion: 1, NewVersion: 2, DeltaID: "d", Operations: []DeltaOperation{{Op: "insert", Node: "x"}}}
	// payload small — pass
	if err := b.CheckDelta(delta); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	// oversized delta
	b2 := Budget{MaxDeltaPayloadBytes: 10, MaxNodes: 80, MaxImages: 12, MaxSchemaPayloadBytes: 16384}
	if err := b2.CheckDelta(delta); err == nil {
		t.Fatal("expected delta budget exceeded")
	}
}
