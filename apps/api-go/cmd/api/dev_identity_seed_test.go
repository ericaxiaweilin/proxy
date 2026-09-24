package main

// 开发种子写库时必须落在迁移的 CHECK 取值范围内。
//
// 2026-09-23 的真实缺陷：seedPostgresIdentity 往 identity.login_identities 写
// channel='PHONE'，而 049 identity_login_channel_check 只认 EMAIL / SMS。049 比
// 这条 INSERT 晚三周上线，上线之后 simulated + Postgres 每次启动都倒在
// log.Fatalf("seed postgres identity: ...")，排在后面的 supply / home-rail /
// media 种子一个都跑不到。
//
// 这里刻意不去复制一份取值表：允许值直接从 049 的 SQL 里读出来，再比对种子实际
// 会写进去的值。复制一份常量只是把「两处会漂移」变成「三处会漂移」。

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

const migration049Path = "../../migrations/049_data_integrity_security.sql"

// loginChannelAllowListFromMigration 从 049 的 identity_login_channel_check 里
// 抽出 channel 的允许值。抽不出来就 Fatal —— 解析失败不能当成「没有约束」。
func loginChannelAllowListFromMigration(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(migration049Path)
	if err != nil {
		t.Fatalf("read %s: %v", migration049Path, err)
	}
	source := string(raw)
	if !strings.Contains(source, "identity_login_channel_check") {
		t.Fatalf("SEED-IDENTITY-CHANNEL-001: 049 no longer defines identity_login_channel_check; update this guard instead of deleting it")
	}
	// CHECK (channel IS NULL OR channel IN ('EMAIL','SMS')) NOT VALID
	match := regexp.MustCompile(`channel\s+IN\s*\(([^)]*)\)`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("SEED-IDENTITY-CHANNEL-001: could not parse the channel allow-list out of identity_login_channel_check in 049")
	}
	allowed := regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(match[1], -1)
	out := make([]string, 0, len(allowed))
	for _, m := range allowed {
		out = append(out, m[1])
	}
	// 反向自检：解析结果必须是真实取值，否则后面的比对会在空集合上「真空通过」。
	if len(out) < 2 || !containsString(out, "EMAIL") || !containsString(out, "SMS") {
		t.Fatalf("SEED-IDENTITY-CHANNEL-001: parsed allow-list %v out of 049 looks wrong; the comparison below would be vacuous", out)
	}
	return out
}

func containsString(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func TestDevSeedLoginIdentityChannelIsAllowed(t *testing.T) {
	allowed := loginChannelAllowListFromMigration(t)
	// 空串 => NULL，049 的 CHECK 明确允许（channel IS NULL OR ...）。
	if devLoginIdentityChannel != "" && !containsString(allowed, devLoginIdentityChannel) {
		t.Fatalf("SEED-IDENTITY-CHANNEL-001: the dev identity seed would write channel=%q, which 049 identity_login_channel_check rejects "+
			"(allowed: %v or NULL). A rejected row means log.Fatalf at boot and every later seed is skipped.",
			devLoginIdentityChannel, allowed)
	}
	if devLoginIdentityIdentifier != "" && strings.Contains(devLoginIdentityIdentifier, " ") {
		t.Fatalf("SEED-IDENTITY-CHANNEL-001: dev seed identifier %q must not contain spaces", devLoginIdentityIdentifier)
	}
}

// 值必须从变量走参数进 SQL。写回字面量就等于绕开上面那条比对 —— 这正是本缺陷的成因。
func TestDevSeedLoginIdentityChannelComesFromAVariable(t *testing.T) {
	raw, err := os.ReadFile("wire_seed.go")
	if err != nil {
		t.Fatalf("read wire_seed.go: %v", err)
	}
	source := string(raw)
	if !strings.Contains(source, "INSERT INTO identity.login_identities") {
		t.Fatal("SEED-IDENTITY-CHANNEL-001: wire_seed.go no longer seeds identity.login_identities; update this guard instead of deleting it")
	}
	if !strings.Contains(source, "NULLIF($3, '')") {
		t.Fatal("SEED-IDENTITY-CHANNEL-001: the login_identities seed no longer binds its channel through a parameter; " +
			"a hard-coded literal cannot be checked against 049's allow-list")
	}
}
