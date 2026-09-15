package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// TestPrivacyExportSurvivesIPv6ZoneSuffix pins PRIVACY-IP-ZONE-001.
//
// The bug: on IPv6 link-local Wi-Fi the phone reaches the API as
// fe80::…%en0 (zone = server-side interface name). buildPrivacyCommandEnvelope
// stashes that verbatim into authContext.clientIp, and CreatePrivacyRequest
// casts it with NULLIF($12,'')::inet — which Postgres rejects outright.
// The whole export died with PRIVACY_REQUEST_WRITE_FAILED, so the privacy
// center's export button could never succeed on that network. Fail-closed
// for a cosmetic audit field.
//
// The fix lives in command.Envelope.AuthContextIP (strip the zone, keep the
// address). This test drives the real chain — service + postgres + schema —
// with the exact remote the device produced, and asserts both ACCEPTED and a
// zone-free stored IP.
func TestPrivacyExportSurvivesIPv6ZoneSuffix(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)
	svc := identity.NewWithRepository(repo)

	runID := itoa(time.Now().UnixNano())
	userID := "zone_a_" + runID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM privacy.privacy_request_events WHERE request_id IN (SELECT id FROM privacy.privacy_requests WHERE user_id = $1)`, userID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM privacy.privacy_requests WHERE user_id = $1`, userID)
	})

	e := command.Envelope{
		CommandID: "cmd_zone_export", CommandType: "RequestPrivacyExport", CommandVersion: 1,
		Actor:     command.Actor{Type: "USER", ID: userID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: userID},
		Target:    command.Target{Type: "PrivacyRequest", ID: userID},
		Payload:   map[string]any{"legalBasis": "PDP-91/2025/QH15-Art31"},
		// The exact remote shape the iPhone produced on v6 link-local Wi-Fi.
		AuthContext: map[string]any{"clientIp": "fe80::447:b115:8d1f:a7d9%en0", "userAgent": "Proxy/1.0"},
	}
	got := svc.Handle(e)
	if got.Outcome != "ACCEPTED" {
		t.Fatalf("zoned clientIp must not fail the export, got %#v", got)
	}

	var stored string
	if err := pool.QueryRow(ctx, `SELECT COALESCE(host(client_ip), '') FROM privacy.privacy_requests WHERE user_id = $1`, userID).Scan(&stored); err != nil {
		t.Fatalf("read back client_ip: %v", err)
	}
	if strings.Contains(stored, "%") {
		t.Fatalf("stored client_ip must not carry the zone suffix, got %q", stored)
	}
	if stored != "fe80::447:b115:8d1f:a7d9" {
		t.Fatalf("stored client_ip must keep the address, got %q", stored)
	}
}
