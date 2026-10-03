package main

// DEPRECATION-01 / ARCH-01: the retired canonical screens must stay unreachable.
// These fixtures exist because the gate's green run on the current repo proves
// nothing on its own — a rule that cannot match is indistinguishable from a
// screen that is clean.

import (
	"strings"
	"testing"
)

const cleanMarket = `export function Market() {
  return <View>{rows.length > 0 ? OPPORTUNITY_LIST : EMPTY}</View>;
}
`

const cleanMe = `export function Me({ subPage }: Props) {
  if (subPage.route === "personalhub") {
    return <ProfileHub />;
  }
  return null;
}
`

func deprecatedFixtureFiles(market, me string) map[string]string {
	return map[string]string{
		"apps/mobile/src/surfaces/market.tsx":         market,
		"apps/mobile/src/surfaces/me.tsx":             me,
		"apps/mobile/src/surfaces/home-assistant.tsx": "export function HomeAssistant() {\n  return null;\n}\n",
		"apps/api-go/internal/experience/service.go":  "package experience\n",
	}
}

func TestDeprecatedRoutesGateAcceptsCleanScreens(t *testing.T) {
	root := fixtureRoot(t, deprecatedFixtureFiles(cleanMarket, cleanMe))
	if err := deprecatedRoutes(root, nil); err != nil {
		t.Fatalf("deprecated-routes gate rejected the clean tree: %v", err)
	}
}

// The EXPERIENCE tab rule is a same-line pattern (`EXPERIENCE.*Tab`), so the
// fixture has to be the shape the retired screen really rendered. A mutation that
// looked violated but stayed green is recorded here so it stays caught.
func TestDeprecatedRoutesGateRejectsExperienceTab(t *testing.T) {
	root := fixtureRoot(t, deprecatedFixtureFiles(`export function Market() {
  const EXPERIENCE_SECTION = <ExperienceTab items={rows} />;
  return <View>{rows.length > 0 ? OPPORTUNITY_LIST : EXPERIENCE_SECTION}</View>;
}
`, cleanMe))
	err := deprecatedRoutes(root, nil)
	if err == nil {
		t.Fatal("deprecated-routes gate passed while Market renders an ExperienceTab")
	}
	if !strings.Contains(err.Error(), "EXPERIENCE") {
		t.Fatalf("deprecated-routes gate failed for the wrong reason: %v", err)
	}
}

// The old Node script printed SKIP and exited 0 when the guarded screen was gone,
// so deleting the very file a rule protects looked like a pass.
func TestDeprecatedRoutesGateRejectsMissingScreen(t *testing.T) {
	files := deprecatedFixtureFiles(cleanMarket, cleanMe)
	delete(files, "apps/mobile/src/surfaces/home-assistant.tsx")
	err := deprecatedRoutes(fixtureRoot(t, files), nil)
	if err == nil {
		t.Fatal("deprecated-routes gate passed while a guarded screen file was missing")
	}
	if !strings.Contains(err.Error(), "cannot read") {
		t.Fatalf("unexpected failure: %v", err)
	}
}

// PROFILE-QR-002: the QR left the personal hub for good.
func TestDeprecatedRoutesGateRejectsQrInPersonalHub(t *testing.T) {
	root := fixtureRoot(t, deprecatedFixtureFiles(cleanMarket, `export function Me({ subPage }: Props) {
  if (subPage.route === "personalhub") {
    return <QrCard value={profileHandle} />;
  }
  return null;
}
`))
	err := deprecatedRoutes(root, nil)
	if err == nil {
		t.Fatal("deprecated-routes gate passed while the personal hub renders a QrCard")
	}
	if !strings.Contains(err.Error(), "QrCard") {
		t.Fatalf("unexpected failure: %v", err)
	}
}
