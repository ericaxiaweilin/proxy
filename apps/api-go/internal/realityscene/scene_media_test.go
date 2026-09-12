package realityscene

import (
	"strings"
	"testing"
	"time"
)

// SCENE-MEDIA-001: scene detail must always carry viewable imagery.
// The mobile validator rejects details without heroImageUrl, menu
// imageUrls and human avatarUrls — a backend that drops them blanks
// the whole scene page. This test pins the contract per variant.
func TestSceneDetailAlwaysCarriesImagery(t *testing.T) {
	s := New()
	variants := []string{"morning", "sunlight", "afterwork", "weekend"}
	for _, variant := range variants {
		detail, found, err := s.GetDetail(t.Context(), "threebeans", variant, time.Date(2026, 9, 6, 15, 0, 0, 0, time.UTC))
		if err != nil || !found {
			t.Fatalf("%s: found=%v err=%v", variant, found, err)
		}
		if detail.HeroImageURL == "" {
			t.Fatalf("%s: heroImageUrl empty", variant)
		}
		if detail.MediaVersion <= 0 {
			t.Fatalf("%s: mediaVersion not positive", variant)
		}
		if len(detail.Menu) == 0 {
			t.Fatalf("%s: menu empty", variant)
		}
		for _, item := range detail.Menu {
			if item.ImageURL == "" {
				t.Fatalf("%s: menu item %s missing imageUrl", variant, item.ID)
			}
		}
		if len(detail.Humans) == 0 {
			t.Fatalf("%s: humans empty", variant)
		}
		for _, human := range detail.Humans {
			// IDENTITY-ID-001: 头像必须来自账号（"/" 开头的媒体路径），或为空表示该人
			// 暂无账号头像——客户端用首字母回落渲染。禁止外部 URL 字面量。
			if strings.HasPrefix(human.AvatarURL, "http") {
				t.Fatalf("%s: human %s must not carry an external avatar URL: %q", variant, human.ID, human.AvatarURL)
			}
			if human.AvatarURL != "" && !strings.HasPrefix(human.AvatarURL, "/") {
				t.Fatalf("%s: human %s avatar must be a server media path, got %q", variant, human.ID, human.AvatarURL)
			}
			if human.Name == "" {
				t.Fatalf("%s: human %s needs a name for the initial fallback", variant, human.ID)
			}
			if human.IsAI {
				t.Fatalf("%s: AI account leaked into humans: %s", variant, human.ID)
			}
		}
		if len(detail.Actions) != 3 {
			t.Fatalf("%s: want 3 actions, got %d", variant, len(detail.Actions))
		}
		if detail.TruthBoundary == "" {
			t.Fatalf("%s: truthBoundary empty", variant)
		}
	}
}
