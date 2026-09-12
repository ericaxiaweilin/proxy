package main

import (
	"strings"
	"testing"
	"time"
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
		if got, want := creatorAvatarPath(profile.agentID), "/v1/media/thumb/ma_creator_"+suffix+"_portrait_v1"; got != want {
			t.Fatalf("IDENTITY-ID-001: avatar must derive from the account asset, got %q want %q", got, want)
		}
		if got, want := creatorAccountID(profile.agentID), "user_mockcreator_"+suffix; got != want {
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
