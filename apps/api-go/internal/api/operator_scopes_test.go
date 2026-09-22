package api

import "testing"

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
