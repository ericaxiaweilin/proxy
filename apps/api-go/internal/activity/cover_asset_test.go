package activity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// ACTIVITY-COVER-001（2026-10-01，用户「做活动 商家活动吧 活动图片资产」）
//
// 活动封面此前是一个**没有写入者**的字段：Activity.CoverImageURL 在 R17.x 就预留了，
// wire 上两个客户端 surface 都在读它，但全仓没有任何一处会设置它 —— 于是每张活动的
// 封面都是空的。
//
// 现在封面走媒体管线的**资产 id**：商家先上传拿到 mediaAssetId，发布时带上来，
// 客户端据此拼 `/v1/media/thumb/<id>`。收 id 不收 URL —— 服务端存 URL 就等于接受
// "客户端指定渲染哪张图"，那是任意外部地址。
func TestIsValidCoverAssetID(t *testing.T) {
	for _, ok := range []string{"ma_abc123", "mv_feed_1x", "MA-1.2_3", "abc"} {
		if !isValidCoverAssetID(ok) {
			t.Fatalf("%q should be a valid cover asset id", ok)
		}
	}
	// 空 = 没传封面，走另一条分支，不是"非法"。
	if isValidCoverAssetID("") {
		t.Fatal("empty must not be reported valid — absence is handled separately")
	}
	for _, bad := range []string{
		"ma/../../etc/passwd",   // 能被拼成别的路径
		"https://evil.example/x.jpg", // 能被拼成任意外部地址
		"ma abc", "ma?a=b", "ma#frag", "ma\x00",
	} {
		if isValidCoverAssetID(bad) {
			t.Fatalf("%q must be rejected", bad)
		}
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "a"
	}
	if isValidCoverAssetID(long) {
		t.Fatal("over-long id must be rejected")
	}
}

func publishCoverActivity(t *testing.T, s *Service, payload map[string]any) (command.Result, Activity) {
	t.Helper()
	e := activityEnvelope("PublishActivity", "owner_1", "new")
	base := map[string]any{
		"title": "封面测试", "time": "周六 15:00–17:00", "capacity": 6,
		"venueName": "木光咖啡", "venueIcon": "☕", "venueType": "CAFE",
		"realitySceneId": "scene_muguang", "desc": "封面", "consumptionTerm": "SPLIT",
	}
	for k, v := range payload {
		base[k] = v
	}
	e.Payload = base
	out := s.HandleContext(t.Context(), e)
	var body struct {
		Activity Activity `json:"activity"`
	}
	if out.Outcome == "ACCEPTED" {
		if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
			t.Fatal(err)
		}
	}
	return out, body.Activity
}

// 封面是**可选**的：不传也必须能发布 —— 否则"没配图"会变成"发不出活动"。
func TestPublishAcceptsActivityWithoutCover(t *testing.T) {
	s := New()
	out, activity := publishCoverActivity(t, s, nil)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("activity without a cover must still publish: %+v", out)
	}
	if activity.CoverMediaAssetID != "" {
		t.Fatalf("no cover was sent, so none must be recorded, got %q", activity.CoverMediaAssetID)
	}
}

// 传了就必须落在活动上，否则商家传了图、别人那边还是空的。
func TestPublishStoresCoverMediaAssetID(t *testing.T) {
	s := New()
	out, activity := publishCoverActivity(t, s, map[string]any{"coverMediaAssetId": "ma_cover_1"})
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("publish failed: %+v", out)
	}
	if activity.CoverMediaAssetID != "ma_cover_1" {
		t.Fatalf("cover asset id must survive publish, got %q", activity.CoverMediaAssetID)
	}
}

// 形状不对的必须拒：这个值会被拼成 URL。
func TestPublishRejectsUnsafeCoverAssetID(t *testing.T) {
	for _, bad := range []string{"https://evil.example/x.jpg", "ma/../secret"} {
		s := New()
		out, _ := publishCoverActivity(t, s, map[string]any{"coverMediaAssetId": bad})
		if out.Outcome == "ACCEPTED" {
			t.Fatalf("cover asset id %q must be rejected", bad)
		}
		if out.Error == nil || out.Error.ErrorCode != "ACTIVITY_COVER_INVALID" {
			t.Fatalf("want ACTIVITY_COVER_INVALID, got %+v", out.Error)
		}
	}
}

// 票券是**历史记录**（票面快照是判重与展示的事实源，HOME-FORYOU-ORDER-007）。
// 商家传了封面、但快照没抄那个活字段的话，票上仍然是空的 —— 而且活动后来换封面
// 会改写已经发出去的票。这里钉住：快照抄的是 coverMediaAssetId。
func TestOrderSnapshotCarriesCoverMediaAssetID(t *testing.T) {
	s := New()
	out, activity := publishCoverActivity(t, s, map[string]any{"coverMediaAssetId": "ma_cover_1"})
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("publish failed: %+v", out)
	}
	joined := activityEnvelope("JoinActivity", "user_b", activity.ID)
	if got := s.HandleContext(t.Context(), joined); got.Outcome != "ACCEPTED" {
		t.Fatalf("join failed: %+v", got)
	}
	snap := s.joinSnapshot(t.Context(), activity.ID, "user_b")
	if snap == nil {
		t.Fatal("join snapshot must exist and carry the activity")
	}
	if snap.Activity.CoverMediaAssetID != "ma_cover_1" {
		t.Fatalf("ticket snapshot must carry the cover asset id (it is a historical record), got %q", snap.Activity.CoverMediaAssetID)
	}
}
