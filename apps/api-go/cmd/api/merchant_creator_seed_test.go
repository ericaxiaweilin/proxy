package main

import (
	"net/url"
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
		parsed, err := url.Parse(profile.photo)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			t.Fatalf("MERCHANT-CREATOR-LIVE-002: unusable photo for %s: %q", profile.agentID, profile.photo)
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
