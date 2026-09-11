# PR: ACCOUNT-SWITCH-001 — 同设备账户切换（登出→换账户登录）修复

**分支**: `hermes/account-switch-test`（rebase 后起点 `dff1abe`，集成 HEAD 2026-09-11；原基线 `50d5cd8` + 47 笔 commander 提交后重放，备份分支 `backup/acct-switch-50d5cd8`）
**回归 ID**: `ACCOUNT-SWITCH-001`
**钉死测试**: `TestAccountSwitchSameDeviceLifecycle`（`apps/api-go/internal/platform/postgres/account_switch_integration_test.go`）

## 缺陷（真实复现，非推测）

用户场景：同一部手机，登出账户 A，登录账户 B —— **服务端永远拒绝 B**。

复现链（temp cluster 真实 PG，service 命令链）：
1. `BeginPasswordlessAuthentication(A)` → `VerifyLoginChallenge` → `CreateSession` = ACCEPTED
2. `RevokeSession(A)`（登出，与 auth-client.ts signOut 完全一致的 envelope）= ACCEPTED
3. `BeginPasswordlessAuthentication(B)`（同 deviceId）= **REJECTED `PASSWORDLESS_IDENTITY_UNAVAILABLE`**

原始错误（repo 层直调探针）：`device belongs to another user`。

## 根因

两层缺陷叠加：
- `revokeSession` 只置 session=REVOKED，**不释放 device_registrations 的占用**
- `upsertDevice` 的 owner 守卫是绝对的：`ON CONFLICT (id) DO UPDATE ... WHERE user_account_id = EXCLUDED.user_account_id` → 0 行 → 拒绝。**唯一能改 owner 的路径是升级已登录账户**（upgradingUserAccountID），登出后的换账户登录无路可走。
- memory repo 更糟：**新身份路径根本没有守卫**（直接覆盖 device 行），所以 service 层 8 个内存测试全绿掩盖了 PG 模式的必挂。

## 产品意图冲突（为什么这是 bug 不是设计）

- `native-app.tsx` 维护 per-device **last-sign-in 列表**（多账户 UI 明确存在，`continueAsLastSignIn`）
- `me.tsx` signOut → `RevokeSession` + 清 keychain → 然后用户在登录屏选另一个邮箱 = 天天用的路径
- PRD v1.6 只定义了 guest→注册 attach，未定义登出换账户——但 UI 已经开卖了

## 修复语义（takeover 设备绑定）

**占用者在"本设备"无 ACTIVE 会话 → 新账户静默接管（reassign）；占用者仍有 ACTIVE 会话 → 保持拒绝（单活跃账户/设备不变量不破）。**

改动文件：
1. `internal/platform/postgres/identity.go` — `EnsurePasswordlessIdentity`：upsertDevice 失败后查 `deviceHasNoActiveSession`，无活跃会话则 `reassignDevice`；新增 `deviceHasNoActiveSession` helper（复用现成 reassignDevice SQL）
2. `internal/identity/repository.go` — memory repo 新身份路径补上同语义守卫 + `deviceHasNoActiveSessionLocked`；两个 repo 从此同一语义，内存测试不再掩盖 PG 行为

## 验证（全部真实执行）

- `go build ./...` = OK（全仓）
- `go test ./internal/...` = **42 包全绿**（含 identity + platform/postgres 全量）
- 新测试 8 步全链：A 登录→B 被拒（安全不变量）→A 登出→**B 登录成功**→A session 保持 REVOKED→A 旧 token 死亡→B token 归属 B（PROFILE-READ-001 类防护）→**切回 A 成功**（last-sign-in 往返）
- 回归契约已注册 `ACCOUNT-SWITCH-001`（scripts/check-regression-contracts.sh）

## 边界与不做的事

- 不动 `MaxConcurrentSessions=2`（账户内并发上限，另一条不变量）
- 不做"多账户同设备并行 ACTIVE"（明确拒绝，测试 step 2 钉死）
- 不改 app 端（app 行为已正确：signOut 后 BeginPasswordless 不带 Authorization 头——新修复路径恰好接住）
- upgrade 路径（已登录态绑新邮箱到现有账户）语义保持不变
