package supply

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// CREATOR-SOCIAL-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
// 也看不到关联的社媒账户」）：关联社媒的绑定 / 可见性。
//
// 三条线：形状校验（平台封闭、handle 字符集）、同平台换绑不叠加、
// 按看的人过滤（本人全见 / 商家见 public+merchants / 其他人只 public）。

func socialEnvelope(t *testing.T, kind, actor, agent string, payload map[string]any) command.Envelope {
	t.Helper()
	return command.Envelope{
		CommandID: kind + "_" + actor + "_" + agent, CommandType: kind, CommandVersion: 1,
		Actor:     command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "AgentProfile", ID: agent}, IdempotencyKey: kind + actor + agent,
		CorrelationID: "corr", RequestedAt: "2026-10-02T00:00:00Z", Payload: payload,
	}
}

func seedSocialAgent(t *testing.T, s *Service, agent string) {
	t.Helper()
	if err := s.repository.CreateProfile(t.Context(), AgentProfile{AgentID: agent, Name: "N", Status: "ACTIVE"}); err != nil {
		t.Fatal(err)
	}
}

func TestLinkAgentSocialValidation(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{"bad platform", map[string]any{"agentId": "a", "platform": "wechat", "handle": "x"}, "SOCIAL_PLATFORM_UNSUPPORTED"},
		{"empty handle", map[string]any{"agentId": "a", "platform": "tiktok", "handle": ""}, "SOCIAL_HANDLE_INVALID"},
		{"url as handle", map[string]any{"agentId": "a", "platform": "tiktok", "handle": "https://tiktok.com/@x"}, "SOCIAL_HANDLE_INVALID"},
		{"slash handle", map[string]any{"agentId": "a", "platform": "tiktok", "handle": "a/b"}, "SOCIAL_HANDLE_INVALID"},
		{"at handle", map[string]any{"agentId": "a", "platform": "tiktok", "handle": "@x"}, "SOCIAL_HANDLE_INVALID"},
		{"space handle", map[string]any{"agentId": "a", "platform": "tiktok", "handle": "a b"}, "SOCIAL_HANDLE_INVALID"},
		{"bad visibility", map[string]any{"agentId": "a", "platform": "tiktok", "handle": "x", "visibility": "friends"}, "SOCIAL_VISIBILITY_INVALID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := New()
			seedSocialAgent(t, s, "a")
			out := s.HandleContext(t.Context(), socialEnvelope(t, "LinkAgentSocial", "a", "a", tc.payload))
			if out.Outcome == "ACCEPTED" {
				t.Fatalf("must reject, got ACCEPTED")
			}
			if out.Error == nil || out.Error.ErrorCode != tc.want {
				t.Fatalf("want %s, got %+v", tc.want, out.Error)
			}
		})
	}
}

func TestLinkAgentSocialRequiresSelf(t *testing.T) {
	s := New()
	seedSocialAgent(t, s, "a")
	// b 想给 a 挂社媒 —— 门都没有（updateProfile 同一口径）。
	out := s.HandleContext(t.Context(), socialEnvelope(t, "LinkAgentSocial", "b", "a",
		map[string]any{"agentId": "a", "platform": "tiktok", "handle": "x"}))
	if out.Outcome == "ACCEPTED" || out.Error == nil || out.Error.ErrorCode != "AGENT_NOT_OWNED" {
		t.Fatalf("cross-agent link must be rejected, got %+v", out.Error)
	}
}

func TestLinkAgentSocialUpsertsByPlatform(t *testing.T) {
	s := New()
	seedSocialAgent(t, s, "a")
	link := func(handle, visibility string) {
		t.Helper()
		out := s.HandleContext(t.Context(), socialEnvelope(t, "LinkAgentSocial", "a", "a",
			map[string]any{"agentId": "a", "platform": "tiktok", "handle": handle, "visibility": visibility}))
		if out.Outcome != "ACCEPTED" {
			t.Fatalf("link: %+v", out.Error)
		}
	}
	link("first", "public")
	link("second", "private")
	p, err := s.repository.GetProfile(t.Context(), "a")
	if err != nil {
		t.Fatal(err)
	}
	// 同平台再绑 = 换绑，不是叠加。不然一个人能挂 5 个 TikTok。
	if len(p.Socials) != 1 {
		t.Fatalf("want 1 social (upsert), got %d: %+v", len(p.Socials), p.Socials)
	}
	if p.Socials[0].Handle != "second" || p.Socials[0].Visibility != "private" {
		t.Fatalf("upsert must replace, got %+v", p.Socials[0])
	}
}

func TestLinkAgentSocialDefaultsToMerchants(t *testing.T) {
	s := New()
	seedSocialAgent(t, s, "a")
	out := s.HandleContext(t.Context(), socialEnvelope(t, "LinkAgentSocial", "a", "a",
		map[string]any{"agentId": "a", "platform": "zalo", "handle": "x"}))
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("link: %+v", out.Error)
	}
	p, _ := s.repository.GetProfile(t.Context(), "a")
	if len(p.Socials) != 1 || p.Socials[0].Visibility != "merchants" {
		t.Fatalf("default visibility must be merchants, got %+v", p.Socials)
	}
}

func TestUnlinkAgentSocial(t *testing.T) {
	s := New()
	seedSocialAgent(t, s, "a")
	link := func(platform, handle string) {
		t.Helper()
		out := s.HandleContext(t.Context(), socialEnvelope(t, "LinkAgentSocial", "a", "a",
			map[string]any{"agentId": "a", "platform": platform, "handle": handle}))
		if out.Outcome != "ACCEPTED" {
			t.Fatalf("link %s: %+v", platform, out.Error)
		}
	}
	link("tiktok", "t1")
	link("zalo", "z1")
	out := s.HandleContext(t.Context(), socialEnvelope(t, "UnlinkAgentSocial", "a", "a",
		map[string]any{"agentId": "a", "platform": "tiktok"}))
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("unlink: %+v", out.Error)
	}
	p, _ := s.repository.GetProfile(t.Context(), "a")
	if len(p.Socials) != 1 || p.Socials[0].Platform != "zalo" {
		t.Fatalf("only tiktok should be gone, got %+v", p.Socials)
	}
	// 解不存在的也成功（幂等，不报错）。
	out = s.HandleContext(t.Context(), socialEnvelope(t, "UnlinkAgentSocial", "a", "a",
		map[string]any{"agentId": "a", "platform": "tiktok"}))
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("unlink missing must still succeed: %+v", out.Error)
	}
}

func TestSocialsVisibleToViewer(t *testing.T) {
	all := []AgentSocial{
		{Platform: "tiktok", Handle: "pub", Visibility: "public"},
		{Platform: "zalo", Handle: "mer", Visibility: "merchants"},
		{Platform: "instagram", Handle: "priv", Visibility: "private"},
		{Platform: "facebook", Handle: "unknown-visibility", Visibility: "weird"},
	}
	// 本人全见。
	if got := socialsVisibleToViewer(all, true, false); len(got) != 3 {
		t.Fatalf("self must see all 3 known, got %+v", got)
	}
	// 商家见 public + merchants。
	got := socialsVisibleToViewer(all, false, true)
	if len(got) != 2 || got[0].Handle != "pub" || got[1].Handle != "mer" {
		t.Fatalf("merchant must see public+merchants, got %+v", got)
	}
	// 路人只见 public。
	got = socialsVisibleToViewer(all, false, false)
	if len(got) != 1 || got[0].Handle != "pub" {
		t.Fatalf("stranger must see only public, got %+v", got)
	}
	// 未知 visibility 谁都看不见（宁可不显示，不猜）。
	if got := socialsVisibleToViewer(all, true, true); len(got) != 3 {
		t.Fatalf("unknown visibility must be hidden from everyone, got %+v", got)
	}
}
