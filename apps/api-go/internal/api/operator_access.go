package api

import (
	"log"
	"net/http"
	"sort"
)

// OPS-ACCESS-001（2026-10-04）：运营权限本身要看得见。
//
//	GET /v1/operator/access
//
// 「谁是运营、他能做什么」此前只存在于两个 env 变量里，而且其中一个
// （PROXY_OPERATOR_SCOPES）的解析器和测试都写好了、却从没被接上 —— 于是 12 个 scope 的
// 词汇表和全部门命令的 required scope 映射在运行时全是装饰，白名单里人人恒持全部
// scope。权限模型没有可观测面，就没人能回答「这个账号凭什么能做这件事」。
//
// 三件事一起给：词汇表（每个 scope 解锁哪些门命令，从 requiredOperatorScope 现算，
// 绝不另抄一份）、当前配置（谁在白名单、谁被收窄到哪几个 scope）、我自己生效的 scope。
// 外加审计计数与最近动作 —— 权限能拆分的前提是拆出去之后还能追责。
//
// 只读。授权仍然只能在 env 里改：让 web 控制台能铸运营权限就是一条自我提权路径，
// 得先有 MFA / JIT 才配（console README 里写的 OperatorAccessGrant 指的是那个）。
func (s *Server) operatorAccess(w http.ResponseWriter, r *http.Request) {
	byScope := commandsByScope()
	scopes := make([]map[string]any, 0, len(allOperatorScopes))
	for _, scope := range allOperatorScopes {
		scopes = append(scopes, map[string]any{
			"scope":       string(scope),
			"description": operatorScopeDescription[scope],
			"commands":    byScope[scope],
		})
	}

	// 当前配置。allowlist 与收窄表都来自 env，这里只是把它们摊开给运营看。
	principals := make([]map[string]any, 0)
	narrowed := map[string][]OperatorScope{}
	if gate, ok := s.Operator.(*StaticOperatorGate); ok && gate != nil {
		narrowed = gate.ConfiguredScopes()
		for _, id := range gate.AllowlistedPrincipals() {
			entry := map[string]any{
				"principalId": id,
				"source":      "env:PROXY_OPERATOR_PRINCIPALS",
			}
			if set, ok := narrowed[id]; ok {
				entry["narrowed"] = true
				entry["scopes"] = scopeNames(set)
			} else {
				// 没有条目 = 未收窄 = 持全部 scope（接 scope 配置之前的老行为）。
				// 这跟「配成空集」正好相反：那个是明确全拒。
				entry["narrowed"] = false
				entry["scopes"] = scopeNames(allOperatorScopes)
			}
			principals = append(principals, entry)
		}
	}
	sort.Slice(principals, func(i, j int) bool {
		return principals[i]["principalId"].(string) < principals[j]["principalId"].(string)
	})

	// 我自己。中间件已经验过会话与白名单，这里再取一次只为拿到 principal。
	var me map[string]any
	if raw, ok := bearerToken(r.Header.Get("Authorization")); ok {
		if auth, err := s.Authenticator.Authenticate(r.Context(), raw); err == nil {
			held := s.Operator.ScopesFor(auth.Actor, auth.Principal, auth.AuthContext)
			heldList := make([]OperatorScope, 0, len(held))
			for scope := range held {
				heldList = append(heldList, scope)
			}
			_, isNarrowed := narrowed[auth.Principal.ID]
			me = map[string]any{
				"principalId": auth.Principal.ID,
				"actorId":     auth.Actor.ID,
				"scopes":      scopeNames(heldList),
				"narrowed":    isNarrowed,
			}
		}
	}

	audit := map[string]any{"connected": false}
	if s.Audit != nil {
		recorded, writeFailed := s.Audit.Counts()
		audit = map[string]any{
			"connected":       s.Audit.Connected(),
			"recorded":        recorded,
			"writeFailed":     writeFailed,
			"writeFailedNote": "写不进审计的动作不会被回滚（动作已经发生），但会在这里计数 —— 缺口要看得见",
		}
		recent, err := s.Audit.Recent(r.Context(), 50)
		if err != nil {
			log.Printf("operator access: audit read failed: %v", err)
			audit["recentError"] = "audit_read_failed"
		} else {
			audit["recent"] = recent
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"scopes":     scopes,
		"principals": principals,
		"me":         me,
		"audit":      audit,
		"notes": []string{
			"授权只读：白名单与 scope 收窄都来自 env（PROXY_OPERATOR_PRINCIPALS / PROXY_OPERATOR_SCOPES），改完要重启 api。",
			"没有条目的白名单账号 = 持全部 scope（接 scope 配置之前的老行为）；配成空集 = 明确全拒。两者相反。",
			"带 role=OPERATOR 的会话也算运营，但它在 env 里不可寻址，所以恒持全部 scope —— 这是一个已知缺口，收紧它只能靠静默断运营，故没做。",
			"业务数据页（逐人明细、行为信号、引力状态）要 ANALYTICS；只有这一页不要 —— 被收窄的运营也得看得见自己有什么权限，否则权限模型只能靠猜。",
		},
	})
}

func scopeNames(scopes []OperatorScope) []string {
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		out = append(out, string(scope))
	}
	sort.Strings(out)
	return out
}
