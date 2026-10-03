package business

import (
	"encoding/json"
	"strings"
	"testing"
)

func readStringV2(raw, key string) string {
	var body map[string]any
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		return ""
	}
	s, _ := body[key].(string)
	return s
}

// STORE-EDIT-V2-001（2026-10-03，用户给原型「编辑店铺资料 - 增强版」）：
//
// 原型新增两个后端没有的东西：店铺公告（100 字内）和店铺社媒（店官网链接）。
// 公告超长整单拒（不静默截）；社媒键封闭、值必须是 https（http 明文和非 URL 拒）。
func TestUpsertStoreLinesAnnouncementAndSocials(t *testing.T) {
	service := New()
	made := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "S"}))
	businessID := readStringV2(made.OperationRef, "businessId")
	stored := service.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "S", "address": "Hanoi",
	}))
	storeID := readStringV2(stored.OperationRef, "storeId")

	base := map[string]any{
		"storeId": storeID, "description": "d", "hoursJson": "{}",
		"announcement": "本周五下午茶买一送一！",
		"socials":      map[string]any{"zalo": "https://zalo.me/123", "tiktok": "https://tiktok.com/@x"},
	}

	// 公告 101 字拒收（原型 maxlength=100）。
	tooLong := map[string]any{}
	for k, v := range base {
		tooLong[k] = v
	}
	tooLong["announcement"] = strings.Repeat("告", 101)
	if out := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", tooLong)); out.Outcome == "ACCEPTED" {
		t.Fatal("101-char announcement must be rejected")
	}
	// 100 字整通过（边界）。
edge := map[string]any{}
	for k, v := range base {
		edge[k] = v
	}
	edge["announcement"] = strings.Repeat("告", 100)
	if out := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", edge)); out.Outcome != "ACCEPTED" {
		t.Fatalf("100-char announcement must pass: %+v", out.Error)
	}

	// 未知平台拒收（不静默丢）。
	weird := map[string]any{}
	for k, v := range base {
		weird[k] = v
	}
	weird["socials"] = map[string]any{"wechat": "https://x.com/y"}
	if out := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", weird)); out.Outcome == "ACCEPTED" {
		t.Fatal("unknown social platform must be rejected")
	}
	// http 明文拒收。
	plain := map[string]any{}
	for k, v := range base {
		plain[k] = v
	}
	plain["socials"] = map[string]any{"zalo": "http://zalo.me/123"}
	if out := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", plain)); out.Outcome == "ACCEPTED" {
		t.Fatal("plain http social URL must be rejected")
	}
	// 非 URL 拒收。
	notURL := map[string]any{}
	for k, v := range base {
		notURL[k] = v
	}
	notURL["socials"] = map[string]any{"zalo": "not a url"}
	if out := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", notURL)); out.Outcome == "ACCEPTED" {
		t.Fatal("non-URL social value must be rejected")
	}

	// 正常落库且读得回来。
	ok := service.Handle(businessEnvelope("owner", "UpsertStoreLines", "new", base))
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("valid upsert: %+v", ok.Error)
	}
	got := service.Handle(businessEnvelope("owner", "GetStoreLines", "new", map[string]any{"storeId": storeID}))
	if got.Outcome != "ACCEPTED" {
		t.Fatalf("get: %+v", got.Error)
	}
}
