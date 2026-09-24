package supply

import (
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-SELLER-001（写侧）— 实名核验必须有受控写入口。
//
// 读侧（seller_identity_compliance_test.go）钉的是「已核验才准撮合」。这一组
// 钉的是「已核验这个状态从哪来」。在此之前全仓没有一处 INSERT
// supply.seller_real_name_verifications，于是：
//   - verified_by 可以是任意字符串（084 要求「具名运营人员」）；
//   - expires_at 可以留空，而读侧把 NULL 当永不过期（084 要求「必须重新核」）；
//   - 证件号哈希可以是任意字面量，没有任何东西保证它是哈希。
//
// 四条不变量：明文不落库、VERIFIED 必有有效期、重新核能成功（旧记录让位）、
// 否决必须真的生效（否则「运营看过并否决」和「没人看过」长得一模一样）。

const testAttestationNumber = "001199012345"

// attestOperatorEnvelope 用运营 principal 发起核验。核验记录必须有归属人 ——
// 084 的原话是「由具名运营人员人工核过」。
func attestOperatorEnvelope(payload map[string]any) command.Envelope {
	return envelopeForPrincipal("AttestSellerRealName", payload, "", "ops_001")
}

// seedAgentForAttestation 建一个存在的 agent —— 核验只能挂在真实存在的卖家上。
func seedAgentForAttestation(t *testing.T, s *Service, agentID string) {
	t.Helper()
	r := s.Handle(envelopeForPrincipal("CreateAgentProfile", map[string]any{
		"agentId": agentID, "name": "Attest " + agentID,
		"photos": []string{"https://cdn.proxy.test/creators/" + agentID + ".jpg"},
		"languages": []string{"VI"}, "serviceAreas": []string{"hn"},
	}, "", agentID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create profile %s: %s (%+v)", agentID, r.Outcome, r.Error)
	}
}

func newAttestationService() (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	return NewWithRepository(repo), repo
}

func approvePayload(agentID string) map[string]any {
	return map[string]any{
		"agentId": agentID, "legalName": "Nguyen Thi Test", "idType": "CCCD",
		"idNumber": testAttestationNumber, "taxCode": "0101234567", "decision": "APPROVE",
	}
}

// 证件号明文绝不落库：库里只该有哈希，而且必须是那个号的哈希。
func TestAttestSellerRealNameStoresHashNotTheNumber(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_hash")

	r := s.Handle(attestOperatorEnvelope(approvePayload("agent_attest_hash")))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("attest: %s (%+v)", r.Outcome, r.Error)
	}

	records := repo.SellerRealNameVerifications("agent_attest_hash")
	if len(records) != 1 {
		t.Fatalf("want exactly 1 verification record, got %d", len(records))
	}
	got := records[0].IDNumberHash
	if got == testAttestationNumber {
		t.Fatal("the raw id number was stored verbatim — PDP 91/2025 forbids keeping the document number in the clear")
	}
	if want := HashIDNumber(testAttestationNumber); got != want {
		t.Fatalf("stored hash = %q, want sha256 of the number %q", got, want)
	}
	if strings.Contains(got, "sha256:") {
		t.Fatal("stored hash carries a 'sha256:' prefix — store the bare hex digest so the column means one thing")
	}
	// 命令响应里也不能带明文（响应会进日志/客户端）。
	if strings.Contains(r.OperationRef, testAttestationNumber) {
		t.Fatal("the command result leaked the raw id number")
	}
	for _, ref := range r.EventRefs {
		if strings.Contains(ref, testAttestationNumber) {
			t.Fatal("an event ref leaked the raw id number")
		}
	}
}

// 「必须重新核」只有在有效期真实存在时才成立。
func TestAttestSellerRealNameVerifiedCarriesAnExpiry(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_expiry")

	r := s.Handle(attestOperatorEnvelope(approvePayload("agent_attest_expiry")))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("attest: %s (%+v)", r.Outcome, r.Error)
	}

	record := repo.SellerRealNameVerifications("agent_attest_expiry")[0]
	if record.Status != SellerRealNameStatusVerified {
		t.Fatalf("status = %q, want VERIFIED", record.Status)
	}
	if record.ExpiresAt == nil {
		t.Fatal("a VERIFIED record with no expiry is the hole this command exists to close: the reader treats NULL as never-expiring")
	}
	// 12 个月（±2 天容差，避免测试跨越时钟边界时抖动）。
	wantMonths := SellerRealNameAttestationValidityMonths
	lower := record.VerifiedAt.AddDate(0, wantMonths, 0).Add(-48 * time.Hour)
	upper := record.VerifiedAt.AddDate(0, wantMonths, 0).Add(48 * time.Hour)
	if record.ExpiresAt.Before(lower) || record.ExpiresAt.After(upper) {
		t.Fatalf("expiry = %v, want about %d months after %v", record.ExpiresAt, wantMonths, record.VerifiedAt)
	}
}

// 重新核必须能成功：旧 VERIFIED 让位，且同一 agent 只留一条 VERIFIED
// （084 的 uq_seller_realname_verified_agent 就是这个意思）。
func TestAttestSellerRealNameSupersedesThePriorVerification(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_twice")

	if r := s.Handle(attestOperatorEnvelope(approvePayload("agent_attest_twice"))); r.Outcome != "ACCEPTED" {
		t.Fatalf("first attest: %s (%+v)", r.Outcome, r.Error)
	}
	second := approvePayload("agent_attest_twice")
	second["legalName"] = "Nguyen Thi Renamed"
	second["idNumber"] = "001199099999"
	if r := s.Handle(attestOperatorEnvelope(second)); r.Outcome != "ACCEPTED" {
		t.Fatalf("re-attest must succeed (that is what '必须重新核' means): %s (%+v)", r.Outcome, r.Error)
	}

	records := repo.SellerRealNameVerifications("agent_attest_twice")
	if len(records) != 2 {
		t.Fatalf("want 2 records (history kept), got %d", len(records))
	}
	if records[0].Status != "EXPIRED" {
		t.Fatalf("the superseded record must be EXPIRED, got %q", records[0].Status)
	}
	verified := 0
	for _, record := range records {
		if record.Status == SellerRealNameStatusVerified {
			verified++
		}
	}
	if verified != 1 {
		t.Fatalf("want exactly 1 VERIFIED record per agent, got %d", verified)
	}
	if records[1].IDNumberHash != HashIDNumber("001199099999") {
		t.Fatal("the newest record must carry the newest evidence")
	}
}

// 否决必须真的生效：否则「运营看过并否决」和「没人看过」在库里长得一模一样，
// 而读侧会把残留的旧 VERIFIED 当成仍然有效。
func TestAttestSellerRealNameRejectionSupersedesThePriorVerification(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_reject")

	if r := s.Handle(attestOperatorEnvelope(approvePayload("agent_attest_reject"))); r.Outcome != "ACCEPTED" {
		t.Fatalf("approve: %s (%+v)", r.Outcome, r.Error)
	}
	reject := approvePayload("agent_attest_reject")
	reject["decision"] = "REJECT"
	if r := s.Handle(attestOperatorEnvelope(reject)); r.Outcome != "ACCEPTED" {
		t.Fatalf("reject: %s (%+v)", r.Outcome, r.Error)
	}

	records := repo.SellerRealNameVerifications("agent_attest_reject")
	for _, record := range records {
		if record.Status == SellerRealNameStatusVerified {
			t.Fatal("a rejection left a VERIFIED record standing — the rejection would then have no effect on eligibility")
		}
	}
	last := records[len(records)-1]
	if last.Status != SellerRealNameStatusRejected {
		t.Fatalf("last record status = %q, want REJECTED", last.Status)
	}
	if last.ExpiresAt != nil {
		t.Fatal("a REJECTED record must not carry an expiry — an expiry implies something was granted")
	}
}

// 打错 agent id 不该等于预先放行：否则之后任何用这个 id 建号的卖家会直接
// 继承这条核验（读侧只按 agent_id 匹配）。
func TestAttestSellerRealNameRejectsUnknownAgent(t *testing.T) {
	s, repo := newAttestationService()
	// 故意不建 profile
	r := s.Handle(attestOperatorEnvelope(approvePayload("agent_typo_here")))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("attesting to a non-existent agent must be refused — a typo would pre-authorise whoever registers that id later")
	}
	if r.Error == nil || r.Error.ErrorCode != "SELLER_REAL_NAME_AGENT_UNKNOWN" {
		t.Fatalf("want SELLER_REAL_NAME_AGENT_UNKNOWN, got %+v", r.Error)
	}
	if len(repo.SellerRealNameVerifications("agent_typo_here")) != 0 {
		t.Fatal("no record may be written for an unknown agent")
	}
}

func TestAttestSellerRealNameRejectsUnsupportedIDType(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_idtype")

	payload := approvePayload("agent_attest_idtype")
	payload["idType"] = "DRIVER_LICENCE" // 084 只认 CCCD / VNEID / PASSPORT
	r := s.Handle(attestOperatorEnvelope(payload))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("an id type outside 084's CHECK must be refused at the service, not surfaced as a DB constraint error")
	}
	if r.Error == nil || r.Error.ErrorCode != "SELLER_REAL_NAME_ID_TYPE_UNSUPPORTED" {
		t.Fatalf("want SELLER_REAL_NAME_ID_TYPE_UNSUPPORTED, got %+v", r.Error)
	}
	if len(repo.SellerRealNameVerifications("agent_attest_idtype")) != 0 {
		t.Fatal("nothing may be written when the id type is unsupported")
	}
}

func TestAttestSellerRealNameRejectsIncompleteInput(t *testing.T) {
	s, _ := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_incomplete")

	for _, missing := range []string{"legalName", "idNumber", "agentId"} {
		payload := approvePayload("agent_attest_incomplete")
		payload[missing] = ""
		r := s.Handle(attestOperatorEnvelope(payload))
		if r.Outcome == "ACCEPTED" {
			t.Fatalf("missing %s must be refused", missing)
		}
		if r.Error == nil || r.Error.ErrorCode != "SELLER_REAL_NAME_ATTESTATION_INCOMPLETE" {
			t.Fatalf("missing %s: want SELLER_REAL_NAME_ATTESTATION_INCOMPLETE, got %+v", missing, r.Error)
		}
	}
}

func TestAttestSellerRealNameRejectsInvalidDecision(t *testing.T) {
	s, _ := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_decision")

	payload := approvePayload("agent_attest_decision")
	payload["decision"] = "MAYBE"
	r := s.Handle(attestOperatorEnvelope(payload))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("a decision outside APPROVE/REJECT must be refused")
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_SELLER_REAL_NAME_DECISION" {
		t.Fatalf("want INVALID_SELLER_REAL_NAME_DECISION, got %+v", r.Error)
	}
}

// 没有归属人的核验记录无法回答「谁放的」—— 084 的「具名运营人员」要求它。
func TestAttestSellerRealNameRequiresANamedOperator(t *testing.T) {
	s, repo := newAttestationService()
	seedAgentForAttestation(t, s, "agent_attest_anonymous")

	r := s.Handle(envelopeForPrincipal("AttestSellerRealName", approvePayload("agent_attest_anonymous"), "", ""))
	if r.Outcome == "ACCEPTED" {
		t.Fatal("an attestation with no operator principal must be refused, not recorded as an anonymous verification")
	}
	if r.Error == nil || r.Error.ErrorCode != "SELLER_REAL_NAME_ATTESTOR_REQUIRED" {
		t.Fatalf("want SELLER_REAL_NAME_ATTESTOR_REQUIRED, got %+v", r.Error)
	}
	if len(repo.SellerRealNameVerifications("agent_attest_anonymous")) != 0 {
		t.Fatal("nothing may be written without a named attestor")
	}
}

// 内存实现必须与 DB CHECK（迁移 118）同一条规则，否则单测会在生产路径上骗人
// —— COMP-REPORT-005 的 dispositions_outcome_check 就是这么漏过去的。
func TestMemoryRepositoryRefusesVerifiedWithoutExpiry(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Now().UTC()
	err := repo.AttestSellerRealName(nil, SellerRealNameVerification{
		ID: "srn_no_expiry", AgentID: "agent_x", LegalName: "No Expiry", IDType: "CCCD",
		IDNumberHash: HashIDNumber("1"), Status: SellerRealNameStatusVerified,
		Method: SellerRealNameMethodOperatorAttestation, VerifiedBy: "ops_001",
		VerifiedAt: now, CreatedAt: now, UpdatedAt: now,
	})
	if err == nil {
		t.Fatal("a VERIFIED record without an expiry must be refused by the repository too — the DB CHECK is not the only place this invariant lives")
	}
	if len(repo.SellerRealNameVerifications("agent_x")) != 0 {
		t.Fatal("the refused record must not be stored")
	}
}

func TestMemoryRepositoryRefusesUnnamedAttestor(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Now().UTC()
	expiry := now.AddDate(1, 0, 0)
	err := repo.AttestSellerRealName(nil, SellerRealNameVerification{
		ID: "srn_no_attestor", AgentID: "agent_y", LegalName: "No Attestor", IDType: "CCCD",
		IDNumberHash: HashIDNumber("1"), Status: SellerRealNameStatusVerified,
		Method: SellerRealNameMethodOperatorAttestation, VerifiedBy: "",
		VerifiedAt: now, ExpiresAt: &expiry, CreatedAt: now, UpdatedAt: now,
	})
	if err == nil {
		t.Fatal("a record with a blank verified_by must be refused — it cannot answer who attested")
	}
}

func TestHashIDNumberIsStableAndTrimmed(t *testing.T) {
	first := HashIDNumber(testAttestationNumber)
	if first != HashIDNumber("  "+testAttestationNumber+"  ") {
		t.Fatal("hashing must trim surrounding whitespace, otherwise the same document hashes two ways")
	}
	if first != HashIDNumber(testAttestationNumber) {
		t.Fatal("hashing must be deterministic — the same document has to match across records")
	}
	if len(first) != 64 {
		t.Fatalf("want a 64-char hex sha256 digest, got %d chars (%q)", len(first), first)
	}
	if first == HashIDNumber("001199012346") {
		t.Fatal("two different documents hashed to the same value")
	}
}

func TestAttestSellerRealNameIsSupported(t *testing.T) {
	if !New().Supports("AttestSellerRealName") {
		t.Fatal("AttestSellerRealName must be a supported supply command — otherwise the handler is unreachable and the write path does not exist")
	}
}
