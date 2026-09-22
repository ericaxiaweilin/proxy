package api

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// OPS-SCOPE-001: scope 地基的三条钉。
//
// 1. Completeness：门命令表（operatorCommandTypes）加一条，就必须在
//    requiredOperatorScope 里配 scope —— 否则新门命令默认"白名单内全过"，
//    scope 体系当场就有洞（之前 SAFETY/BENEFIT 整域漏网就是这么来的）。
// 2. Vocabulary：required 的 scope 必须出自 allOperatorScopes —— 杜绝手滑
//    写错 scope 名导致"要求了一个谁都没有的 scope"（fail-closed 变 fail-永远拒，
//    静默断运营）或"引用了不存在的域"。
// 3. Parity：白名单内 allowlisted=true 时，36 条门命令的放行结果必须与今天
//    （纯 IsOperator）逐条一致 —— 本 slice 零行为变更的证据。非 allowlisted
//    一律不过；非门命令不受本表影响。

func TestOperatorScopeCompleteness(t *testing.T) {
	known := make(map[OperatorScope]bool, len(allOperatorScopes))
	for _, scope := range allOperatorScopes {
		if known[scope] {
			t.Fatalf("duplicate scope in allOperatorScopes: %q", string(scope))
		}
		known[scope] = true
	}
	if len(allOperatorScopes) != 11 {
		t.Fatalf("operator scope vocabulary changed: got %d scopes %v, want 11 — changing the vocabulary is a deliberate commander decision, update this test and RequiredOperatorScope together", len(allOperatorScopes), allOperatorScopes)
	}
	for command := range operatorCommandTypes {
		scope, ok := RequiredOperatorScope(command)
		if !ok {
			t.Fatalf("gated command %q has no required operator scope — add it to requiredOperatorScope (OPS-SCOPE-001)", command)
		}
		if !known[scope] {
			t.Fatalf("gated command %q requires unknown scope %q — must be one of allOperatorScopes", command, string(scope))
		}
	}
	for command, scope := range requiredOperatorScope {
		if !operatorCommandTypes[command] {
			t.Fatalf("command %q has a required scope %q but is not in operatorCommandTypes — scope without a gate enforces nothing", command, string(scope))
		}
	}
}

func TestOperatorScopeParityWithStaticGate(t *testing.T) {
	full := ScopesForPrincipal(true)
	none := ScopesForPrincipal(false)
	if len(none) != 0 {
		t.Fatalf("non-allowlisted principal must hold zero scopes, got %v", none)
	}
	for command := range operatorCommandTypes {
		if !AuthorizeOperatorCommand(command, full) {
			t.Fatalf("allowlisted principal denied gated command %q — OPS-SCOPE-001 must not change current enforcement", command)
		}
		if AuthorizeOperatorCommand(command, none) {
			t.Fatalf("non-allowlisted principal authorized gated command %q", command)
		}
	}
}

func TestOperatorScopeLeavesOpenCommandsAlone(t *testing.T) {
	// 非门命令走各域自己的 actor 鉴权，scope 表不插手 —— 空 scope 也必须放行
	// 到下一层（这里只验本表不拦，不验各域鉴权本身）。
	open := []string{"CreatePost", "SendMessage", "ListFeedPosts", "JoinActivity", "GetProfile", "ListMyOrders", "StartConversation"}
	empty := map[OperatorScope]bool{}
	for _, command := range open {
		if _, gated := RequiredOperatorScope(command); gated {
			t.Fatalf("command %q unexpectedly requires an operator scope", command)
		}
		if !AuthorizeOperatorCommand(command, empty) {
			t.Fatalf("open command %q blocked by scope check with empty scopes", command)
		}
	}
}

// OPS-SCOPE-002: per-principal scope 配置的钉。
//
// 1. 解析：格式正确→精确集合；`*`=全集；未知 scope/坏条目→跳过+警告（往小
//    了给，不静默放大）；同一 id 后者为准；env 为空=零配置（=今天的行为）。
// 2. ScopesFor：配了→按配的来（含配成空集=全拒）；白名单内没配→全 scope；
//    没过 IsOperator→空；nil gate→空（fail-closed，与 IsOperator 一致）。
// 3. 端到端 parity：配了 scope 的白名单用户，超出 scope 的门命令被拦，
//    scope 内的照行 —— 在 AuthorizeOperatorCommand 层验证（dispatch 只做
//    同样的两次调用，已被 api 包现有门禁测试覆盖行为无变）。

func TestParsePrincipalScopes(t *testing.T) {
	parsed, warnings := ParsePrincipalScopes("op_alice:PAYMENTS,MARKETPLACE;op_bob:*")
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(parsed) != 2 {
		t.Fatalf("want 2 principals, got %v", parsed)
	}
	alice := parsed["op_alice"]
	if len(alice) != 2 || !alice[ScopePayments] || !alice[ScopeMarketplace] {
		t.Fatalf("op_alice scopes wrong: %v", alice)
	}
	if len(parsed["op_bob"]) != len(allOperatorScopes) {
		t.Fatalf("op_bob '*' should expand to all %d scopes, got %d", len(allOperatorScopes), len(parsed["op_bob"]))
	}

	// 未知 scope 名跳过+警告；坏条目跳过+警告；好条目不受影响。
	parsed, warnings = ParsePrincipalScopes("op_x:NOPE,PAYMENTS;broken-entry;op_y: ,MARKETPLACE ;:SAFETY")
	if len(warnings) != 3 {
		t.Fatalf("want 3 warnings (unknown scope, malformed, empty id), got %v", warnings)
	}
	if len(parsed["op_x"]) != 1 || !parsed["op_x"][ScopePayments] {
		t.Fatalf("unknown scope must be skipped, known kept: %v", parsed["op_x"])
	}
	if len(parsed["op_y"]) != 1 || !parsed["op_y"][ScopeMarketplace] {
		t.Fatalf("empty names skipped, known kept: %v", parsed["op_y"])
	}
	if _, ok := parsed[""]; ok {
		t.Fatalf("empty principal id must not produce an entry")
	}

	// 全是未知名 = 明确空集（全拒），不是"没配"。
	parsed, warnings = ParsePrincipalScopes("op_z:NOPE")
	if len(warnings) != 1 {
		t.Fatalf("want 1 warning, got %v", warnings)
	}
	if scopes, ok := parsed["op_z"]; !ok || len(scopes) != 0 {
		t.Fatalf("all-unknown must parse to an explicit empty set, got %v (ok=%v)", scopes, ok)
	}

	// 同一 id 后者为准；env 为空=零配置。
	parsed, _ = ParsePrincipalScopes("op_d:PAYMENTS;op_d:SAFETY")
	if len(parsed["op_d"]) != 1 || !parsed["op_d"][ScopeSafety] {
		t.Fatalf("duplicate id should be last-wins: %v", parsed["op_d"])
	}
	parsed, warnings = ParsePrincipalScopes("  ")
	if len(parsed) != 0 || len(warnings) != 0 {
		t.Fatalf("empty env must parse clean to zero config, got %v %v", parsed, warnings)
	}
}

func TestStaticGateScopesFor(t *testing.T) {
	opActor := command.Actor{Type: "USER", ID: "op_alice"}
	opPrincipal := command.Principal{Type: "INDIVIDUAL", ID: "op_alice"}
	otherPrincipal := command.Principal{Type: "INDIVIDUAL", ID: "op_stranger"}

	gate := NewStaticOperatorGate([]string{"op_alice"})
	scoped, _ := ParsePrincipalScopes("op_alice:PAYMENTS")
	gate.WithPrincipalScopes(scoped)

	got := gate.ScopesFor(opActor, opPrincipal, map[string]any{})
	if len(got) != 1 || !got[ScopePayments] {
		t.Fatalf("configured principal must hold exactly its scopes, got %v", got)
	}
	if AuthorizeOperatorCommand("RefundPaymentIntent", got) != true {
		t.Fatalf("PAYMENTS scope must authorize RefundPaymentIntent")
	}
	if AuthorizeOperatorCommand("CreateIncident", got) {
		t.Fatalf("PAYMENTS-only principal must not authorize SAFETY command CreateIncident")
	}

	// 白名单内但没配 scope 的 = 全 scope（向后兼容）。
	gate2 := NewStaticOperatorGate([]string{"op_alice", "op_plain"})
	gate2.WithPrincipalScopes(scoped)
	if got := gate2.ScopesFor(opActor, command.Principal{Type: "INDIVIDUAL", ID: "op_plain"}, map[string]any{}); len(got) != len(allOperatorScopes) {
		t.Fatalf("unconfigured allowlisted principal must hold full scopes, got %d", len(got))
	}

	// 没过 IsOperator 的一律空集；nil gate 也是空（fail-closed）。
	if got := gate.ScopesFor(opActor, otherPrincipal, map[string]any{}); len(got) != 0 {
		t.Fatalf("non-operator must hold zero scopes, got %v", got)
	}
	var nilGate *StaticOperatorGate
	if nilGate.ScopesFor(opActor, opPrincipal, map[string]any{}) == nil {
		t.Fatalf("nil gate ScopesFor must return an (empty) map, not nil — callers range over it")
	}
	if len(nilGate.ScopesFor(opActor, opPrincipal, map[string]any{})) != 0 {
		t.Fatalf("nil gate must hold zero scopes")
	}

	// role=OPERATOR 会话无 env 条目 = 全 scope（今天的行为；会话在 env 里
	// 不可寻址，收紧它们只能是静默断运营，故不做）。
	roleGate := NewStaticOperatorGate(nil)
	roleGate.WithPrincipalScopes(scoped)
	authCtx := map[string]any{"role": "OPERATOR"}
	if got := roleGate.ScopesFor(opActor, otherPrincipal, authCtx); len(got) != len(allOperatorScopes) {
		t.Fatalf("role=OPERATOR session without an entry must hold full scopes, got %d", len(got))
	}
}
