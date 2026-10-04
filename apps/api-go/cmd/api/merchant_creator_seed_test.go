package main

import (
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/mockidentity"
)

func TestMerchantCreatorLiveSeedHasFivePhotoReadyHanoiCreators(t *testing.T) {
	seen := map[string]bool{}
	count := 0
	for _, profile := range merchantCreatorSeedProfiles() {
		if seen[profile.agentID] {
			t.Fatalf("MERCHANT-CREATOR-LIVE-002: duplicate %s", profile.agentID)
		}
		seen[profile.agentID] = true
		if len(profile.areas) == 0 || profile.areas[0] != "hn" {
			continue
		}
		// IDENTITY-ID-001: 头像不再允许外链/字面量。候选头像必须是由同一 facet 键
		// 派生的账号媒体资产路径（账号 id 与资产 id 同源）——同一个人的头像只有
		// 一处事实源，首页与发布订单不会再各显示一张。
		suffix := strings.TrimPrefix(profile.agentID, "agent_")
		if got, want := creatorAvatarPath(profile.agentID), mockidentity.AvatarPathForFacetKey(suffix); got != want {
			t.Fatalf("IDENTITY-ID-001: avatar must derive from the shared identity mapping, got %q want %q", got, want)
		}
		if got, want := creatorAccountID(profile.agentID), mockidentity.AccountIDForFacetKey(suffix); got != want {
			t.Fatalf("IDENTITY-ID-001: account id must derive from the same facet key, got %q want %q", got, want)
		}
		count++
	}
	if count < 5 {
		t.Fatalf("MERCHANT-CREATOR-LIVE-002: want >=5 Hanoi creators, got %d", count)
	}
}

func TestMerchantCreatorAvailabilityRollsAcrossClientQuery(t *testing.T) {
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	start, end := merchantCreatorAvailability(now)
	queryStart := now.Add(24 * time.Hour)
	queryEnd := queryStart.Add(8 * time.Hour)
	if start.After(queryStart) || end.Before(queryEnd) {
		t.Fatalf("MERCHANT-CREATOR-LIVE-002: seed window %s..%s does not cover %s..%s", start, end, queryStart, queryEnd)
	}
	start2, end2 := merchantCreatorAvailability(now.Add(24 * time.Hour))
	if !start2.After(start) || !end2.After(end) {
		t.Fatal("MERCHANT-CREATOR-LIVE-002: availability did not roll with boot time")
	}
}

// MERCHANT-CREATOR-TAGS-001：种子垂类与社媒账号是模拟器里三标签的数据来源。
// 垂类只允许封闭三类进展示（RESTAURANT/CAFE/TOUR/SPORT），社媒 Linh 必须有
// public tiktok（原型 @linh_hanoi），其余人暂无。
func TestMerchantCreatorSeedTagsForMerchantCards(t *testing.T) {
	byAgent := map[string]merchantCreatorSeedService{}
	for _, svc := range merchantCreatorSeedServices() {
		byAgent[svc.agentID] = svc
	}
	allowed := map[string]bool{"RESTAURANT": true, "CAFE": true, "TOUR": true, "SPORT": true}
	for id, svc := range byAgent {
		for _, tag := range svc.verticals {
			if !allowed[tag] {
				t.Fatalf("seed vertical %q for %s is not displayable; keep it out of seed or extend the display list first", tag, id)
			}
		}
	}
	if got := byAgent["agent_linh"].verticals; len(got) != 1 || got[0] != "TOUR" {
		t.Fatalf("linh seed verticals = %v, want [TOUR]", got)
	}
	socials := merchantCreatorSeedSocials()
	if !strings.Contains(socials["agent_linh"], `"handle":"linh_hanoi"`) {
		t.Fatalf("linh seed socials must carry tiktok linh_hanoi, got %s", socials["agent_linh"])
	}
	// 商家页要求人人有粉丝量字段：6 个种子达人必须全有社媒账号。
	for _, id := range []string{"agent_linh", "agent_mai", "agent_an", "agent_thao", "agent_yen", "agent_minh"} {
		if socials[id] == "" {
			t.Fatalf("seed socials missing for %s: every seeded creator must carry one", id)
		}
	}
}
