package postgres

import (
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/supply"
)

// PROFILE-JSONB-EMPTY-ARRAY-NULL-001
//
// 新建一个「什么都没关联」的 Creator 是主路径，不是边界情况。它原来在写侧编成
// json.Marshal(nil 切片) = "null"，写进 JSONB 后 jsonb_typeof='null'，撞上 migration
// 157 的 agent_profiles_socials_ck（只认 'array'）—— 集成测试
// TestSellerRealNameAttestationRoundTrip 报 SQLSTATE 23514，也就是说线上每一次
// 「创建 agent profile」都会失败。读侧早就 COALESCE(socials,'[]') 兜住了，写侧没有。
//
// 这个测试不需要数据库：它直接钉住编码器的输出形状，所以 CI / 本机 / 门禁都能跑。
func TestEncodeProfileJSONEmptySlicesEncodeAsArrays(t *testing.T) {
	photos, languages, areas, socials, err := encodeProfileJSON(supply.AgentProfile{
		AgentID:   "agent-empty",
		Name:      "没关联任何东西的 Creator",
		Status:    "DRAFT",
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("encodeProfileJSON: %v", err)
	}
	for name, encoded := range map[string][]byte{
		"photos":       photos,
		"languages":    languages,
		"serviceareas": areas,
		"socials":      socials,
	} {
		if string(encoded) != "[]" {
			t.Errorf("%s = %q, want \"[]\" —— JSONB 里 'null' 的 jsonb_typeof 是 'null'，会违反 array CHECK", name, encoded)
		}
	}
}

// 显式空切片（[]T{}）和 nil 必须编成同一个形状：调用方有没有做 nil 归一化不应该
// 改变落库结果。
func TestEncodeProfileJSONExplicitEmptyMatchesNil(t *testing.T) {
	fromNil, _, _, _, err := encodeProfileJSON(supply.AgentProfile{})
	if err != nil {
		t.Fatalf("encodeProfileJSON: %v", err)
	}
	empty := supply.AgentProfile{Photos: []string{}, Languages: []string{}, ServiceAreas: []string{}, Socials: []supply.AgentSocial{}}
	fromEmpty, _, _, _, err := encodeProfileJSON(empty)
	if err != nil {
		t.Fatalf("encodeProfileJSON: %v", err)
	}
	if string(fromNil) != string(fromEmpty) {
		t.Errorf("nil 编成 %q 而 []T{} 编成 %q —— 空集合的落库形状不应该取决于调用方是否做了 nil 归一化", fromNil, fromEmpty)
	}
}

// 非空内容不能被归一化逻辑误伤（只兜 null，不兜有元素的数组）。
func TestEncodeProfileJSONKeepsNonEmptyArrays(t *testing.T) {
	_, _, _, socials, err := encodeProfileJSON(supply.AgentProfile{
		Socials: []supply.AgentSocial{{Platform: "zalo", Handle: "thanhhuyen", Visibility: "merchants"}},
	})
	if err != nil {
		t.Fatalf("encodeProfileJSON: %v", err)
	}
	if string(socials) == "[]" {
		t.Fatalf("有一条关联社媒的 profile 被编成空数组 —— 社媒会被静默丢掉")
	}
	if len(socials) < 3 || socials[0] != '[' || socials[len(socials)-1] != ']' {
		t.Fatalf("socials 不是 JSON 数组: %q", socials)
	}
}
